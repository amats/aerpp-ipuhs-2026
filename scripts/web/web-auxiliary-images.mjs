import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { ROOT } from "@aerpp/config/workspace"
import { parse } from "yaml"
import { run } from "../shared/delivery.mjs"

const CONFIG_FILES = [
  "compose.yaml",
  "Caddyfile",
  "fluent-bit.conf",
  "parsers.conf",
]
const AUXILIARY_IMAGES = [
  { service: "caddy", reference: "caddy:latest" },
  { service: "fluent-bit", reference: "fluent/fluent-bit:latest" },
]

export function auxiliaryConfigFingerprint(directory = resolve(ROOT, "infra")) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        CONFIG_FILES.map((file) => [
          file,
          readFileSync(resolve(directory, file), "utf8"),
        ]),
      ),
    )
    .digest("hex")
}

export function assertAuxiliaryImages(
  evidence,
  platform,
  directory = resolve(ROOT, "infra"),
) {
  assert.equal(
    evidence?.configSha256,
    auxiliaryConfigFingerprint(directory),
    "Auxiliary configuration changed; rebuild and check the Web image",
  )
  assert.equal(
    evidence?.images?.length,
    AUXILIARY_IMAGES.length,
    "Rebuild with checked auxiliary images",
  )
  assert.equal(evidence?.localProxyCheck, true)
  assert.equal(evidence?.loggingForwardCheck, true)
  for (const expected of AUXILIARY_IMAGES) {
    const image = evidence.images.find(
      (item) => item.service === expected.service,
    )
    assert.equal(image?.reference, expected.reference)
    assert.equal(image?.platform, platform)
    assert.match(image?.id ?? "", /^sha256:[a-f0-9]{64}$/)
    assert.equal(image?.configurationCheck, true)
  }
}

function checkLocalTraffic(images, invoke, directory, temporary) {
  const caddy = images.find((image) => image.service === "caddy").id
  const fluent = images.find((image) => image.service === "fluent-bit").id
  const network = `aerpp-auxiliary-${randomUUID()}`
  const containers = []
  const marker = "aerpp-synthetic-forward-check"
  // Exercise the shipped input/parsers/filters without cloud credentials or egress.
  const config = `${
    readFileSync(resolve(directory, "fluent-bit.conf"), "utf8").split(
      /^\[OUTPUT\]/m,
    )[0]
  }[OUTPUT]\n    Name stdout\n    Match *\n`
  const configFile = resolve(temporary, "fluent-local.conf")
  writeFileSync(configFile, config)
  invoke("docker", ["network", "create", "--internal", network])
  const create = (args) => {
    const container = invoke("docker", [
      "create",
      "--pull",
      "never",
      "--network",
      network,
      ...args,
    ])
    containers.push(container)
    return container
  }
  try {
    const receiver = create([
      "--network-alias",
      "fluent-bit",
      "--entrypoint",
      "/fluent-bit/bin/fluent-bit",
      fluent,
      "-c",
      "/fluent-bit/etc/fluent-bit.conf",
    ])
    invoke("docker", [
      "cp",
      configFile,
      `${receiver}:/fluent-bit/etc/fluent-bit.conf`,
    ])
    invoke("docker", [
      "cp",
      resolve(directory, "parsers.conf"),
      `${receiver}:/fluent-bit/etc/parsers.conf`,
    ])
    invoke("docker", ["start", receiver])
    const upstream = create([
      "--network-alias",
      "app-aerpp",
      "--entrypoint",
      "caddy",
      caddy,
      "respond",
      "--listen",
      ":3000",
      "--body",
      marker,
    ])
    invoke("docker", ["start", upstream])
    const proxy = create([
      "--entrypoint",
      "caddy",
      caddy,
      "run",
      "--config",
      "/etc/caddy/Caddyfile",
      "--adapter",
      "caddyfile",
    ])
    invoke("docker", [
      "cp",
      resolve(directory, "Caddyfile"),
      `${proxy}:/etc/caddy/Caddyfile`,
    ])
    invoke("docker", ["start", proxy])
    assert.equal(
      invoke("docker", [
        "exec",
        proxy,
        "sh",
        "-c",
        "for attempt in 1 2 3 4 5 6 7 8 9 10; do wget -q -O- http://127.0.0.1/health && exit 0; sleep 1; done; exit 1",
      ]),
      marker,
    )
    // Exercise an error request too: both proxy diagnostics and access logs
    // must exclude private headers, body and URL query values.
    invoke("docker", ["stop", upstream])
    invoke("docker", [
      "exec",
      proxy,
      "sh",
      "-c",
      "wget -q -O- --header='X-Aerpp-Tab: synthetic-private-context' --header='Cookie: synthetic-private-cookie' --post-data='synthetic-private-body' 'http://127.0.0.1/health?email=synthetic-private-query' >/dev/null 2>&1 || true",
    ])
    const proxyLogs = invoke("docker", ["logs", proxy])
    assert(
      !proxyLogs.includes("synthetic-private-"),
      "Proxy logs exposed private request content",
    )
    const requests = proxyLogs.split("\n").flatMap((line) => {
      try {
        const entry = JSON.parse(line)
        return entry.request ? [entry] : []
      } catch {
        return []
      }
    })
    assert(
      requests.length > 0,
      "Proxy error logging check emitted no request record",
    )
    for (const entry of requests) {
      assert.equal(entry.request.uri, "/health")
      assert(!Object.hasOwn(entry.request, "headers"))
      assert(!Object.hasOwn(entry, "resp_headers"))
    }
    const sender = create([
      "--entrypoint",
      "/fluent-bit/bin/fluent-bit",
      fluent,
      "-i",
      "dummy",
      "-p",
      "samples=1",
      "-p",
      `dummy=${JSON.stringify({ log: JSON.stringify({ message: marker, severity: "INFO" }) })}`,
      "-t",
      "docker.app-aerpp",
      "-o",
      "forward",
      "-p",
      "host=fluent-bit",
      "-p",
      "port=24224",
      "-f",
      "1",
    ])
    invoke("docker", ["start", sender])
    let forwarded = false
    for (let attempt = 0; attempt < 40; attempt++) {
      const logs = invoke("docker", ["logs", receiver])
      forwarded =
        logs.includes(marker) &&
        /"service"\s*=>\s*"app-aerpp"/.test(logs) &&
        /"message"\s*=>/.test(logs)
      if (forwarded) break
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250)
    }
    assert(
      forwarded,
      "Synthetic Forward input and application JSON parser check failed",
    )
  } finally {
    try {
      if (containers.length)
        invoke("docker", [
          "rm",
          "--force",
          "--volumes",
          ...containers.reverse(),
        ])
    } finally {
      invoke("docker", ["network", "rm", network])
    }
  }
}

export function prepareAuxiliaryImages(
  platform,
  invoke = run,
  directory = resolve(ROOT, "infra"),
) {
  assert(["linux/arm64", "linux/amd64"].includes(platform))
  const compose = parse(
    readFileSync(resolve(directory, "compose.yaml"), "utf8"),
  )
  const configSha256 = auxiliaryConfigFingerprint(directory)
  const temporary = mkdtempSync(resolve(tmpdir(), "aerpp-auxiliary-"))
  try {
    const credential = resolve(temporary, "logging.json")
    writeFileSync(
      credential,
      JSON.stringify({
        type: "service_account",
        project_id: "synthetic-check",
        client_email: "logging@example.invalid",
        private_key: "synthetic-not-a-key",
      }),
      { mode: 0o600 },
    )
    const images = AUXILIARY_IMAGES.map(({ service, reference }) => {
      assert.equal(compose.services[service].image, reference)
      // Refresh latest for every build; all later operations use this inspected ID.
      invoke("docker", ["pull", "--platform", platform, reference])
      const inspected = JSON.parse(
        invoke("docker", ["image", "inspect", reference]),
      )[0]
      assert.equal(`${inspected.Os}/${inspected.Architecture}`, platform)
      assert.match(inspected.Id, /^sha256:[a-f0-9]{64}$/)
      const args =
        service === "caddy"
          ? [
              "--entrypoint",
              "caddy",
              inspected.Id,
              "validate",
              "--config",
              "/etc/caddy/Caddyfile",
              "--adapter",
              "caddyfile",
            ]
          : [
              "--env",
              "GCP_LOGGING_LOCATION=synthetic",
              "--env",
              "GCP_LOGGING_NAMESPACE=synthetic",
              "--env",
              "PARTICIPANT_API_SERVER_ID=synthetic",
              "--entrypoint",
              "/fluent-bit/bin/fluent-bit",
              inspected.Id,
              "--dry-run",
              "-c",
              "/fluent-bit/etc/fluent-bit.conf",
            ]
      const container = invoke("docker", [
        "create",
        "--pull",
        "never",
        "--network",
        "none",
        ...args,
      ])
      try {
        const files =
          service === "caddy"
            ? [["Caddyfile", "/etc/caddy/Caddyfile"]]
            : [
                ["fluent-bit.conf", "/fluent-bit/etc/fluent-bit.conf"],
                ["parsers.conf", "/fluent-bit/etc/parsers.conf"],
              ]
        for (const [file, destination] of files)
          invoke("docker", [
            "cp",
            resolve(directory, file),
            `${container}:${destination}`,
          ])
        if (service === "fluent-bit")
          invoke("docker", [
            "cp",
            credential,
            `${container}:/fluent-bit/etc/gcp-credentials.json`,
          ])
        invoke("docker", ["start", "--attach", container])
        assert.equal(
          invoke("docker", [
            "inspect",
            container,
            "--format",
            "{{.State.ExitCode}}",
          ]),
          "0",
          "Auxiliary configuration check failed",
        )
      } finally {
        invoke("docker", ["rm", "--force", "--volumes", container])
      }
      return {
        service,
        reference,
        id: inspected.Id,
        platform,
        configurationCheck: true,
      }
    })
    checkLocalTraffic(images, invoke, directory, temporary)
    assert.equal(
      auxiliaryConfigFingerprint(directory),
      configSha256,
      "Configuration changed during auxiliary image checks",
    )
    return {
      configSha256,
      checkedAt: new Date().toISOString(),
      images,
      localProxyCheck: true,
      loggingForwardCheck: true,
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}
