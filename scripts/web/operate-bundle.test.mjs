import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { test } from "node:test"

function setup() {
  const root = mkdtempSync(join(tmpdir(), "aerpp-bundle-"))
  const bin = join(root, "bin")
  mkdirSync(bin)
  const calls = join(root, "calls")
  writeFileSync(
    join(bin, "docker"),
    // biome-ignore lint/suspicious/noTemplateCurlyInString: The generated shell script expands these parameters at execution time.
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$MOCK_CALLS"\nif [ "$1 $2" = "image inspect" ]; then\n  if [ "${MOCK_MISSING_IMAGE:-}" = 1 ]; then echo "No such image" >&2; exit 1; fi\n  if [ "$5" = "{{.Id}}" ]; then echo "$MOCK_IMAGE_ID"; else echo linux/arm64; fi\nfi\nif [ "$1" = create ]; then echo synthetic-probe; fi\nif [ "$1" = inspect ]; then echo 0; fi\nif [ "$1" = start ] && [ "${MOCK_FAIL_MODEL:-}" = 1 ]; then exit 1; fi\n',
    { mode: 0o700 },
  )
  const docker = join(bin, "docker")
  writeFileSync(
    docker,
    readFileSync(docker, "utf8") +
      `
if [ "$1" = create ] && [ -n "\${MOCK_HOLD:-}" ]; then
  touch "$MOCK_HOLD/entered"
  while [ ! -f "$MOCK_HOLD/release" ]; do sleep 0.02; done
fi
if [ "$1" = compose ]; then
  case "$*" in
    *" up "*)
      printf '%s\\n' "$*" > "$MOCK_CALLS.running"
      if [ -n "\${MOCK_FAIL_COMPOSE_RELEASE:-}" ]; then
        case "$*" in *"/releases/$MOCK_FAIL_COMPOSE_RELEASE/"*) exit 1 ;; esac
      fi
      ;;
  esac
fi
`,
  )
  writeFileSync(
    docker,
    readFileSync(docker, "utf8") +
      // biome-ignore lint/suspicious/noTemplateCurlyInString: The generated shell script expands these parameters at execution time.
      '\nif [ "$1" = load ] && [ "${MOCK_FAIL_LOAD:-}" = 1 ]; then exit 1; fi\nif [ "$1 $2" = "image inspect" ] && [ "${MOCK_FAIL_IMAGE:-}" = 1 ]; then exit 1; fi\n',
  )
  const rehash = (directory) => {
    const sums = readFileSync(join(directory, "SHA256SUMS"), "utf8")
      .trim()
      .split("\n")
      .map((line) => line.slice(66))
      .map(
        (file) =>
          `${createHash("sha256")
            .update(readFileSync(join(directory, file)))
            .digest("hex")}  ${file}`,
      )
    writeFileSync(join(directory, "SHA256SUMS"), `${sums.join("\n")}\n`)
  }
  const bundle = (id) => {
    const directory = join(root, id)
    mkdirSync(join(directory, "config"), { recursive: true })
    const files = [
      "compose.yaml",
      "images.json",
      "images.tar",
      "Caddyfile",
      "fluent-bit.conf",
      "parsers.conf",
      "release.json",
      "check-local-llm.mjs",
      "llm-config.json",
      "config/runtime.json",
      "config/logging-credentials.json",
    ]
    for (const file of files) writeFileSync(join(directory, file), "synthetic")
    writeFileSync(
      join(directory, "images.txt"),
      `app-aerpp sha256:${"a".repeat(64)} linux/arm64\n`,
    )
    writeFileSync(join(directory, "release-id.txt"), id)
    writeFileSync(join(directory, "config/profile.txt"), "test\n")
    copyFileSync(
      resolve("infra/operate-bundle.sh"),
      join(directory, "operate.sh"),
    )
    copyFileSync(resolve("infra/install.sh"), join(directory, "install.sh"))
    copyFileSync(
      resolve("infra/BUNDLE-README.md"),
      join(directory, "README.md"),
    )
    const all = [
      ...files,
      "images.txt",
      "release-id.txt",
      "config/profile.txt",
      "operate.sh",
      "install.sh",
      "README.md",
    ]
    writeFileSync(
      join(directory, "SHA256SUMS"),
      `${all
        .map(
          (file) =>
            `${createHash("sha256")
              .update(readFileSync(join(directory, file)))
              .digest("hex")}  ${file}`,
        )
        .join("\n")}\n`,
    )
    return directory
  }
  const install = join(root, "installation with spaces")
  const run = (directory, action, extra = [], env = {}) =>
    spawnSync(
      "bash",
      [join(directory, "operate.sh"), action, install, ...extra],
      {
        env: { PATH: `${bin}:/usr/bin:/bin`, MOCK_CALLS: calls, ...env },
        encoding: "utf8",
      },
    )
  return { root, calls, bundle, install, run, rehash, bin }
}

test("bundle update and rollback preserve configuration and prohibit image pulls/builds", () => {
  const f = setup()
  try {
    const first = f.bundle("first")
    const second = f.bundle("second")
    assert.equal(f.run(first, "install").status, 1)
    assert.equal(f.run(first, "install", ["--maintenance"]).status, 0)
    writeFileSync(join(f.install, "config/operator-marker"), "preserve")
    assert.equal(f.run(second, "update", ["--maintenance"]).status, 0)
    assert.equal(
      readlinkSync(join(f.install, "current")),
      join(f.install, "releases/second"),
    )
    assert.equal(f.run(second, "rollback", ["--maintenance"]).status, 0)
    assert.equal(
      readlinkSync(join(f.install, "current")),
      join(f.install, "releases/first"),
    )
    assert.equal(
      readFileSync(join(f.install, "config/operator-marker"), "utf8"),
      "preserve",
    )
    const calls = readFileSync(f.calls, "utf8")
    assert.match(calls, /up -d --pull never --no-build --wait/)
    assert.doesNotMatch(calls, /(?:^|\n)(?:pull|build)|down|volume rm/)
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
})

test("failed model readiness and corrupt archives cannot advance the current release", () => {
  const f = setup()
  try {
    const first = f.bundle("first")
    const second = f.bundle("second")
    assert.equal(f.run(first, "install", ["--maintenance"]).status, 0)
    assert.notEqual(
      f.run(second, "update", ["--maintenance"], { MOCK_FAIL_MODEL: "1" })
        .status,
      0,
    )
    assert.equal(
      readlinkSync(join(f.install, "current")),
      join(f.install, "releases/first"),
    )
    writeFileSync(join(second, "images.tar"), "tampered")
    assert.notEqual(f.run(second, "verify").status, 0)
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
})

test("installer retains model readiness checks without starting application services and rejects completed installations", () => {
  const f = setup()
  try {
    const bundle = f.bundle("first")
    const invoke = () =>
      spawnSync("bash", [join(bundle, "install.sh"), f.install], {
        env: {
          PATH: `${join(f.root, "bin")}:/usr/bin:/bin`,
          MOCK_CALLS: f.calls,
        },
        encoding: "utf8",
      })
    const result = invoke()
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /インストールが完了しました/)
    const calls = readFileSync(f.calls, "utf8")
    assert.match(calls, /create --pull never --entrypoint node/)
    assert.match(calls, /start -a synthetic-probe/)
    assert.match(calls, /rm -f synthetic-probe/)
    assert.doesNotMatch(calls, /(?:^|\n)compose .*\bup\b/)
    assert.equal(
      readlinkSync(join(f.install, "current")),
      join(f.install, "releases/first"),
    )
    assert.match(readFileSync(f.calls, "utf8"), /load -i .*images\.tar/)
    const before = readFileSync(f.calls, "utf8")
      .split("\n")
      .filter((line) => line.startsWith("load ")).length
    assert.notEqual(invoke().status, 0)
    const after = readFileSync(f.calls, "utf8")
      .split("\n")
      .filter((line) => line.startsWith("load ")).length
    assert.equal(after, before)
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
})

test("initial image and model readiness failures resume the same verified bundle without deleting settings", () => {
  for (const failure of [
    { MOCK_FAIL_LOAD: "1" },
    { MOCK_FAIL_IMAGE: "1" },
    { MOCK_FAIL_MODEL: "1" },
  ]) {
    const f = setup()
    try {
      const bundle = f.bundle("first")
      assert.notEqual(
        f.run(bundle, "install", ["--maintenance"], failure).status,
        0,
      )
      assert(existsSync(join(f.install, ".pending-operation")))
      assert(!existsSync(join(f.install, ".operation-lock")))
      writeFileSync(join(f.install, "config/operator-marker"), "preserve")
      assert.notEqual(f.run(bundle, "start").status, 0)
      const retry = f.run(bundle, "install", ["--maintenance"])
      assert.equal(retry.status, 0, retry.stderr)
      assert.equal(
        readlinkSync(join(f.install, "current")),
        join(f.install, "releases/first"),
      )
      assert.equal(
        readFileSync(join(f.install, "config/operator-marker"), "utf8"),
        "preserve",
      )
      assert(!existsSync(join(f.install, ".pending-operation")))
    } finally {
      rmSync(f.root, { recursive: true, force: true })
    }
  }
})

test("failed update recovers the accepted release and retries without skipping a release", () => {
  const f = setup()
  try {
    const first = f.bundle("first")
    const second = f.bundle("second")
    assert.equal(f.run(first, "install", ["--maintenance"]).status, 0)
    assert.notEqual(
      f.run(second, "update", ["--maintenance"], {
        MOCK_FAIL_COMPOSE_RELEASE: "second",
      }).status,
      0,
    )
    assert.match(
      readFileSync(`${f.calls}.running`, "utf8"),
      /releases\/second\//,
    )
    assert.equal(
      readlinkSync(join(f.install, "current")),
      join(f.install, "releases/first"),
    )
    assert.notEqual(f.run(second, "recover").status, 0)
    assert.notEqual(f.run(second, "rollback", ["--maintenance"]).status, 0)
    assert.equal(f.run(second, "recover", ["--maintenance"]).status, 0)
    assert.match(
      readFileSync(`${f.calls}.running`, "utf8"),
      /releases\/first\//,
    )
    assert(existsSync(join(f.install, ".pending-operation")))
    assert.equal(f.run(second, "update", ["--maintenance"]).status, 0)
    assert.equal(
      readlinkSync(join(f.install, "previous")),
      join(f.install, "releases/first"),
    )
    assert.equal(
      readlinkSync(join(f.install, "current")),
      join(f.install, "releases/second"),
    )
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
})

test("failed rollback can recover and resume its original target", () => {
  const f = setup()
  try {
    const first = f.bundle("first")
    const second = f.bundle("second")
    assert.equal(f.run(first, "install", ["--maintenance"]).status, 0)
    assert.equal(f.run(second, "update", ["--maintenance"]).status, 0)
    assert.notEqual(
      f.run(second, "rollback", ["--maintenance"], {
        MOCK_FAIL_COMPOSE_RELEASE: "first",
      }).status,
      0,
    )
    assert.equal(f.run(second, "recover", ["--maintenance"]).status, 0)
    assert.match(
      readFileSync(`${f.calls}.running`, "utf8"),
      /releases\/second\//,
    )
    assert.equal(f.run(second, "rollback", ["--maintenance"]).status, 0)
    assert.equal(
      readlinkSync(join(f.install, "current")),
      join(f.install, "releases/first"),
    )
    assert.equal(
      readlinkSync(join(f.install, "previous")),
      join(f.install, "releases/second"),
    )
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
})

test("changed logging credentials and runtime settings are rejected before Docker mutation", () => {
  for (const file of [
    "logging-credentials.json",
    "runtime.json",
    "profile.txt",
  ]) {
    const f = setup()
    try {
      const first = f.bundle("first")
      const second = f.bundle("second")
      assert.equal(f.run(first, "install", ["--maintenance"]).status, 0)
      const before = readFileSync(f.calls, "utf8")
      writeFileSync(
        join(second, "config", file),
        file === "profile.txt" ? "production\n" : "changed",
      )
      f.rehash(second)
      assert.notEqual(f.run(second, "update", ["--maintenance"]).status, 0)
      assert.equal(readFileSync(f.calls, "utf8"), before)
      assert.equal(
        readlinkSync(join(f.install, "current")),
        join(f.install, "releases/first"),
      )
    } finally {
      rmSync(f.root, { recursive: true, force: true })
    }
  }
})

test("failed first installation accepts a corrected bundle only with unchanged installed configuration", () => {
  const f = setup()
  try {
    const first = f.bundle("first")
    const second = f.bundle("second")
    assert.notEqual(
      f.run(first, "install", ["--maintenance"], { MOCK_FAIL_LOAD: "1" })
        .status,
      0,
    )
    writeFileSync(join(second, "config/runtime.json"), "changed")
    f.rehash(second)
    assert.notEqual(f.run(second, "install", ["--maintenance"]).status, 0)
    writeFileSync(join(first, "compose.yaml"), "changed")
    f.rehash(first)
    assert.notEqual(f.run(first, "install", ["--maintenance"]).status, 0)
    assert(!existsSync(join(f.install, "current")))
    writeFileSync(join(second, "config/runtime.json"), "synthetic")
    f.rehash(second)
    const repaired = f.run(second, "install", ["--maintenance"])
    assert.equal(repaired.status, 0, repaired.stderr)
    assert.equal(
      readlinkSync(join(f.install, "current")),
      join(f.install, "releases/second"),
    )
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
})

test("all Compose actions fix the selected project despite inherited overrides", () => {
  for (const profile of ["test", "production"]) {
    const f = setup()
    try {
      const first = f.bundle("first")
      writeFileSync(join(first, "config/profile.txt"), `${profile}\n`)
      f.rehash(first)
      const env = {
        COMPOSE_PROJECT_NAME: "unrelated",
        COMPOSE_REMOVE_ORPHANS: "true",
      }
      for (const action of ["install", "start", "stop"]) {
        const result = f.run(
          first,
          action,
          action === "start" ? [] : ["--maintenance"],
          env,
        )
        assert.equal(result.status, 0, result.stderr)
      }
      const calls = readFileSync(f.calls, "utf8")
        .split("\n")
        .filter((line) => line.startsWith("compose --project-name "))
      assert.equal(calls.length, 2)
      for (const call of calls)
        assert(
          call.startsWith(
            `compose --project-name aerpp-${profile} --env-file /dev/null `,
          ),
        )
    } finally {
      rmSync(f.root, { recursive: true, force: true })
    }
  }
})

test("installer defaults to HOME/aerpp for both bundle environments", () => {
  for (const profile of ["test", "production"]) {
    const f = setup()
    try {
      const bundle = f.bundle("first")
      writeFileSync(join(bundle, "config/profile.txt"), `${profile}\n`)
      f.rehash(bundle)
      const result = spawnSync("bash", [join(bundle, "install.sh")], {
        env: {
          PATH: `${f.bin}:/usr/bin:/bin`,
          MOCK_CALLS: f.calls,
          HOME: join(f.root, "home with spaces"),
        },
        encoding: "utf8",
      })
      assert.equal(result.status, 0, result.stderr)
      assert(existsSync(join(f.root, "home with spaces/aerpp/current")))
    } finally {
      rmSync(f.root, { recursive: true, force: true })
    }
  }
})

test("concurrent operations are rejected before reaching Docker and the lock is released", async () => {
  const f = setup()
  let child
  try {
    const bundle = f.bundle("first")
    assert.equal(f.run(bundle, "install", ["--maintenance"]).status, 0)
    const hold = join(f.root, "hold")
    mkdirSync(hold)
    child = spawn("bash", [join(bundle, "operate.sh"), "start", f.install], {
      env: {
        PATH: `${f.bin}:/usr/bin:/bin`,
        MOCK_CALLS: f.calls,
        MOCK_HOLD: hold,
      },
      stdio: "ignore",
    })
    const exited = new Promise((resolve) => child.on("exit", resolve))
    for (let i = 0; i < 200 && !existsSync(join(hold, "entered")); i++)
      await new Promise((resolve) => setTimeout(resolve, 10))
    assert(existsSync(join(hold, "entered")))
    assert.equal(
      statSync(join(f.install, ".operation-lock")).mode & 0o777,
      0o700,
    )
    assert.equal(
      statSync(join(f.install, ".operation-lock/check-local-llm.mjs")).mode &
        0o777,
      0o644,
    )
    assert.equal(
      statSync(join(f.install, ".operation-lock/llm-config.json")).mode & 0o777,
      0o644,
    )
    assert.equal(
      statSync(join(f.install, "releases/first/llm-config.json")).mode & 0o777,
      0o600,
    )
    const before = readFileSync(f.calls, "utf8")
    const rejected = f.run(bundle, "stop", ["--maintenance"])
    assert.notEqual(rejected.status, 0)
    assert.match(rejected.stderr, /Another operation/)
    assert.equal(readFileSync(f.calls, "utf8"), before)
    writeFileSync(join(hold, "release"), "")
    assert.equal(await exited, 0)
    assert(!existsSync(join(f.install, ".operation-lock")))
    assert.equal(f.run(bundle, "stop", ["--maintenance"]).status, 0)
  } finally {
    if (child && child.exitCode === null) child.kill()
    rmSync(f.root, { recursive: true, force: true })
  }
})

test("installed operator survives bundle deletion through start, update, recovery and rollback", () => {
  const f = setup()
  try {
    const first = f.bundle("first")
    const installed = (args, env = {}) =>
      spawnSync("bash", [join(f.install, "operate.sh"), ...args], {
        cwd: f.root,
        env: { PATH: `${f.bin}:/usr/bin:/bin`, MOCK_CALLS: f.calls, ...env },
        encoding: "utf8",
      })
    assert.equal(f.run(first, "install", ["--maintenance"]).status, 0)
    rmSync(first, { recursive: true })
    assert.equal(statSync(join(f.install, "operate.sh")).mode & 0o777, 0o700)
    for (const args of [
      ["verify"],
      ["start"],
      ["start", "--maintenance"],
      ["stop", "--maintenance"],
    ]) {
      const result = installed(args)
      assert.equal(result.status, 0, result.stderr)
    }
    const second = f.bundle("second")
    assert.notEqual(installed(["update", second]).status, 0)
    assert.notEqual(
      installed(["update", second, "--maintenance"], {
        MOCK_FAIL_COMPOSE_RELEASE: "second",
      }).status,
      0,
    )
    assert.equal(installed(["recover", "--maintenance"]).status, 0)
    const updated = installed(["update", second, "--maintenance"])
    assert.equal(updated.status, 0, updated.stderr)
    rmSync(second, { recursive: true })
    for (const args of [
      ["verify"],
      ["start"],
      ["rollback", "--maintenance"],
      ["verify"],
      ["stop", "--maintenance"],
    ]) {
      const result = installed(args)
      assert.equal(result.status, 0, result.stderr)
    }
    assert.equal(
      readlinkSync(join(f.install, "current")),
      join(f.install, "releases/first"),
    )
    const compose = readFileSync(f.calls, "utf8")
      .split("\n")
      .filter((line) => line.startsWith("compose --project-name"))
    assert(compose.every((line) => line.includes(`${f.install}/releases/`)))
    writeFileSync(join(f.install, "releases/first/Caddyfile"), "corrupt")
    assert.notEqual(installed(["verify"]).status, 0)
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
})

test("installation inside the extracted bundle is rejected", () => {
  const f = setup()
  try {
    const bundle = f.bundle("first")
    const result = spawnSync(
      "bash",
      [join(bundle, "install.sh"), join(bundle, "installed")],
      {
        env: { PATH: `${f.bin}:/usr/bin:/bin`, MOCK_CALLS: f.calls },
        encoding: "utf8",
      },
    )
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /outside the extracted bundle/)
    assert.doesNotMatch(readFileSync(f.calls, "utf8"), /load -i/)
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
})

test("portable image tags accept classic and containerd IDs and reject missing or replaced images", () => {
  for (const identity of ["a", "b"]) {
    const f = setup()
    try {
      const bundle = f.bundle("portable")
      writeFileSync(
        join(bundle, "images.txt"),
        `app-aerpp aerpp-bundle/app-aerpp:portable linux/arm64 sha256:${"a".repeat(64)} sha256:${"b".repeat(64)}\n`,
      )
      f.rehash(bundle)
      const installed = f.run(bundle, "install", ["--maintenance"], {
        MOCK_IMAGE_ID: `sha256:${identity.repeat(64)}`,
      })
      assert.equal(installed.status, 0, installed.stderr)
      const started = f.run(bundle, "start", [], {
        MOCK_IMAGE_ID: `sha256:${identity.repeat(64)}`,
      })
      assert.equal(started.status, 0, started.stderr)
      for (const [env, message] of [
        [{ MOCK_IMAGE_ID: `sha256:${"c".repeat(64)}` }, /identity mismatch/],
        [{ MOCK_MISSING_IMAGE: "1" }, /Bundled image is missing/],
      ]) {
        const before = readFileSync(`${f.calls}.running`, "utf8")
        const failed = f.run(bundle, "start", [], env)
        assert.notEqual(failed.status, 0)
        assert.match(failed.stderr, message)
        assert.equal(readFileSync(`${f.calls}.running`, "utf8"), before)
      }
    } finally {
      rmSync(f.root, { recursive: true, force: true })
    }
  }
})
