import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { test } from "node:test"
import { writeSupportTerraformSettings } from "@aerpp/config/auto-settings"
import {
  decodeManualConfig,
  encodeManualConfig,
} from "@aerpp/config/manual-config"
import { initializeEnvironment } from "@aerpp/config/workspace"
import { serviceCredential } from "../../packages/config/test-support/credentials.mjs"
import { generateWebCompose } from "./generate-compose.mjs"

const PROJECTS = { test: "synthetic-test", production: "synthetic-production" }
// biome-ignore lint/suspicious/noTemplateCurlyInString: Test literal Compose interpolation syntax inside secrets.
const SECRET = "synthetic-$VALUE-${OTHER}-'quotes'-\\slash\nnewline-1234567890"
const read = (directory, file) => {
  const value = JSON.parse(readFileSync(join(directory, file), "utf8"))
  return file === "config.json" ? decodeManualConfig(value) : value
}
const write = (directory, file, value) =>
  writeFileSync(
    join(directory, file),
    JSON.stringify(file === "config.json" ? encodeManualConfig(value) : value),
  )

function fixture(name, directory) {
  initializeEnvironment(name, directory, PROJECTS)
  const config = read(directory, "config.json")
  const project = PROJECTS[name]
  writeSupportTerraformSettings(
    directory,
    { name, project },
    {
      version: 1,
      project,
      region: "asia-northeast1",
      repository: `projects/${project}/locations/asia-northeast1/repositories/aerpp-support`,
      runtimeServiceAccount: `support-runtime@${project}.iam.gserviceaccount.com`,
      schedulerServiceAccount: `support-scheduler@${project}.iam.gserviceaccount.com`,
      gmailSecretIds: {
        clientSecret: "SUPPORT_GMAIL_CLIENT_SECRET",
        refreshToken: "SUPPORT_GMAIL_REFRESH_TOKEN",
      },
      serviceEndpoint: {
        name: "aerpp-support",
        projectNumber: "123456789000",
        baseUrl: "https://aerpp-support-123456789000.asia-northeast1.run.app",
      },
    },
  )
  config.support.gmail.sender = "sender@example.invalid"
  config.support.contactEmail = "support@example.invalid"
  config.support.access.expiresAt = "2099-01-01T00:00:00Z"
  config.support.access.backendStopsAt = "2099-12-31T00:00:00Z"
  config.web.DEBUG_PAGES_ENABLED = "false"
  config.logging.GCP_LOGGING_LOCATION = "asia-northeast1"
  config.logging.GCP_LOGGING_NAMESPACE = name
  write(directory, "config.json", config)
  write(directory, "secret.json", {
    SUPPORT_WEB_API_CREDENTIAL: `synthetic.${"a".repeat(43)}`,
    IDENTIFIER_HASH_SECRET: SECRET,
    SESSION_SEAL_PASSWORD: SECRET,
    LOGGING_SERVICE_ACCOUNT_JSON: serviceCredential(project, "logging"),
  })
  // Infra must not depend on admin or Functions readiness.
}

for (const name of ["test", "production"]) {
  test(`generates isolated ${name} Web/logging settings without admin or Functions secrets`, () => {
    const workspace = mkdtempSync(join(tmpdir(), "aerpp-infra-"))
    const directory = join(workspace, "config", "test")
    mkdirSync(directory, { recursive: true })
    try {
      fixture(name, directory)
      generateWebCompose(
        name,
        `synthetic-web:${name}`,
        directory,
        PROJECTS,
        directory,
      )
      const manifest = read(directory, "compose.json")
      assert.equal(manifest.name, `aerpp-${name}`)
      const web = manifest.services["app-aerpp"]
      const logging = manifest.services["fluent-bit"]
      assert.equal(
        web.environment.IDENTIFIER_HASH_SECRET,
        SECRET.replaceAll("$", () => "$$"),
      )
      assert.equal(
        web.environment.SUPPORT_API_BASE_URL,
        "https://aerpp-support-123456789000.asia-northeast1.run.app",
      )
      assert.equal(
        web.environment.SUPPORT_RECEPTION_EXPIRES_AT,
        "2099-01-01T00:00:00Z",
      )
      assert.equal(logging.environment.GCP_PROJECT_ID, PROJECTS[name])
      assert.equal(logging.environment.GCP_LOGGING_NAMESPACE, name)
      assert.equal(web.environment.NEXTAUTH_SECRET, undefined)
      assert.equal(
        logging.volumes[0].source,
        resolve(directory, "../../generated/test/credentials/logging.json"),
      )
      assert.equal(
        statSync(join(directory, "compose.json")).mode & 0o777,
        0o600,
      )
      assert.throws(() =>
        generateWebCompose(name, "", directory, PROJECTS, directory),
      )
      const secrets = read(directory, "secret.json")
      secrets.LOGGING_SERVICE_ACCOUNT_JSON = serviceCredential(
        "wrong-project",
        "logging",
      )
      write(directory, "secret.json", secrets)
      assert.throws(
        () =>
          generateWebCompose(
            name,
            "synthetic-web:tag",
            directory,
            PROJECTS,
            directory,
          ),
        /selected project/,
      )
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })
}

test("Compose renders literal secrets and selected runtime settings", (t) => {
  if (spawnSync("docker", ["compose", "version"]).status !== 0) {
    t.skip("Docker Compose is not installed")
    return
  }
  const workspace = mkdtempSync(join(tmpdir(), "aerpp-infra-"))
  const directory = join(workspace, "config", "test")
  mkdirSync(directory, { recursive: true })
  try {
    fixture("test", directory)
    generateWebCompose(
      "test",
      "synthetic-web:test",
      directory,
      PROJECTS,
      directory,
    )
    const result = spawnSync(
      "docker",
      [
        "compose",
        "--env-file",
        "/dev/null",
        "-f",
        resolve("infra/compose.yaml"),
        "-f",
        join(directory, "compose.json"),
        "config",
        "--format",
        "json",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          VALUE: "host-must-not-replace",
          OTHER: "host-must-not-replace",
        },
      },
    )
    assert.equal(result.status, 0, result.stderr)
    const services = JSON.parse(result.stdout).services
    // Compose config escapes dollar signs again when serializing the model.
    assert.equal(
      services["app-aerpp"].environment.IDENTIFIER_HASH_SECRET,
      SECRET.replaceAll("$", () => "$$"),
    )
    assert.equal(services["app-aerpp"].image, "synthetic-web:test")
    assert.ok(
      services["app-aerpp"].volumes.some(
        (volume) =>
          volume.type === "volume" &&
          volume.source === "web-session-coordination" &&
          volume.target === "/tmp/aerpp-coordination",
      ),
      "Web authority must survive container replacement",
    )
    assert.equal(services["app-aerpp"].env_file, undefined)
    assert.equal(services["fluent-bit"].env_file, undefined)
    assert.equal(services["fluent-bit"].ports.length, 1)
    assert.deepEqual(
      services["fluent-bit"].ports.map(
        ({ host_ip, target, published, protocol }) => ({
          host_ip,
          target,
          published,
          protocol,
        }),
      ),
      [
        {
          host_ip: "127.0.0.1",
          target: 24224,
          published: "24224",
          protocol: "tcp",
        },
      ],
    )
    for (const service of ["app-aerpp", "caddy"])
      assert.equal(
        services[service].logging.options["fluentd-address"],
        "127.0.0.1:24224",
      )
    assert.ok(
      services["fluent-bit"].volumes.some(
        (v) =>
          v.source ===
          resolve(directory, "../../generated/test/credentials/logging.json"),
      ),
    )
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})
