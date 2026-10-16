import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "node:test"

function setup(failure = "") {
  const directory = mkdtempSync(path.join(tmpdir(), "aerpp-setup-"))
  const root = path.join(directory, "workspace with spaces")
  const bin = path.join(directory, "bin")
  const userDirectory = path.join(directory, "user with spaces")
  const log = path.join(directory, "commands.jsonl")
  mkdirSync(path.join(root, ".devcontainer"), { recursive: true })
  mkdirSync(bin)
  mkdirSync(userDirectory)
  writeFileSync(path.join(userDirectory, ".bashrc"), "# Existing settings\n")
  writeFileSync(log, "")
  writeFileSync(path.join(root, ".env"), "TOOL_SETTING=preserved\n")
  copyFileSync(
    new URL("../../.devcontainer/postCreate.sh", import.meta.url),
    path.join(root, ".devcontainer/postCreate.sh"),
  )
  copyFileSync(
    new URL("../../.devcontainer/setup-gcloud-repository.sh", import.meta.url),
    path.join(root, ".devcontainer/setup-gcloud-repository.sh"),
  )
  const mock = `#!${process.execPath}
const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
const command = path.basename(process.argv[1])
const args = process.argv.slice(2)
if (command === "sudo") {
  if (args[0] === "-n") args.shift()
  const result = spawnSync(args[0], args.slice(1), { stdio: "inherit" })
  process.exit(result.status ?? 1)
}
fs.appendFileSync(process.env.SETUP_LOG, JSON.stringify({ command, args, cwd: process.cwd() }) + "\\n")
if ([command, ...args].join(" ").startsWith(process.env.SETUP_FAILURE || "NEVER")) process.exit(42)
if (command === "pnpm" && args.join(" ") === "completion bash") process.stdout.write("# Synthetic pnpm completion\\n")
`
  for (const command of [
    "sudo",
    "chown",
    "chmod",
    "apt-get",
    "pnpm",
    "npm",
    "curl",
    "gpg",
    "install",
    "tee",
    "gcloud",
  ]) {
    writeFileSync(path.join(bin, command), mock, { mode: 0o755 })
  }
  return {
    root,
    userDirectory,
    run: (script = "postCreate.sh") =>
      spawnSync("bash", [path.join(root, ".devcontainer", script)], {
        cwd: directory,
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: userDirectory,
          PATH: `${bin}:${process.env.PATH}`,
          SETUP_LOG: log,
          SETUP_FAILURE: failure,
        },
      }),
    commands: () =>
      readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  }
}

test("setup installs workspace dependencies and shared Chromium from the mounted root", () => {
  const fixture = setup()
  try {
    const result = fixture.run()
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(
      fixture.commands().map(({ command, args }) => [command, ...args]),
      [
        ["pnpm", "install", "--frozen-lockfile"],
        ["pnpm", "run", "test:e2e:install", "--with-deps"],
        ["pnpm", "completion", "bash"],
      ],
    )
    assert.ok(
      fixture
        .commands()
        .filter(({ command }) => command === "pnpm")
        .every(({ cwd }) => cwd === fixture.root),
    )
    assert.equal(
      readFileSync(path.join(fixture.root, ".env"), "utf8"),
      "TOOL_SETTING=preserved\n",
    )
    assert.equal(
      readFileSync(
        path.join(fixture.userDirectory, ".pnpm-completion.bash"),
        "utf8",
      ),
      "# Synthetic pnpm completion\n",
    )
    const expectedBashrc =
      "# Existing settings\nsource ~/.pnpm-completion.bash\n"
    assert.equal(
      readFileSync(path.join(fixture.userDirectory, ".bashrc"), "utf8"),
      expectedBashrc,
    )
    writeFileSync(
      path.join(fixture.userDirectory, ".pnpm-completion.bash"),
      "# Previous completion\n",
    )
    assert.equal(fixture.run().status, 0)
    assert.equal(
      readFileSync(
        path.join(fixture.userDirectory, ".pnpm-completion.bash"),
        "utf8",
      ),
      "# Synthetic pnpm completion\n",
    )
    assert.deepEqual(readdirSync(fixture.userDirectory).sort(), [
      ".bashrc",
      ".pnpm-completion.bash",
    ])
    assert.equal(
      readFileSync(path.join(fixture.userDirectory, ".bashrc"), "utf8"),
      expectedBashrc,
    )
  } finally {
    fixture.cleanup()
  }
})

for (const [failure, count] of [
  ["pnpm install", 1],
  ["pnpm run test:e2e:install", 2],
  ["pnpm completion bash", 3],
]) {
  test(`setup stops after ${failure} fails`, () => {
    const fixture = setup(failure)
    try {
      assert.equal(fixture.run().status, 42)
      assert.equal(fixture.commands().length, count)
      assert.deepEqual(readdirSync(fixture.userDirectory), [".bashrc"])
    } finally {
      fixture.cleanup()
    }
  })
}

test("failed completion generation preserves the existing completion and shell startup files", () => {
  const fixture = setup("pnpm completion bash")
  try {
    const completion = path.join(fixture.userDirectory, ".pnpm-completion.bash")
    const previousCompletion = "# Retained completion\n"
    const bashrc = path.join(fixture.userDirectory, ".bashrc")
    const previousBashrc = readFileSync(bashrc, "utf8")
    writeFileSync(completion, previousCompletion)

    assert.equal(fixture.run().status, 42)
    assert.equal(readFileSync(completion, "utf8"), previousCompletion)
    assert.equal(readFileSync(bashrc, "utf8"), previousBashrc)
    assert.deepEqual(readdirSync(fixture.userDirectory).sort(), [
      ".bashrc",
      ".pnpm-completion.bash",
    ])
  } finally {
    fixture.cleanup()
  }
})

test("setup rejects a completion destination directory without modifying it or shell startup", () => {
  const fixture = setup()
  try {
    const completion = path.join(fixture.userDirectory, ".pnpm-completion.bash")
    mkdirSync(completion)
    writeFileSync(path.join(completion, "retained"), "retained file\n")
    const bashrc = path.join(fixture.userDirectory, ".bashrc")
    const previousBashrc = readFileSync(bashrc, "utf8")

    assert.notEqual(fixture.run().status, 0)
    assert.equal(readFileSync(bashrc, "utf8"), previousBashrc)
    assert.deepEqual(readdirSync(completion), ["retained"])
    assert.equal(
      readFileSync(path.join(completion, "retained"), "utf8"),
      "retained file\n",
    )
    assert.deepEqual(readdirSync(fixture.userDirectory).sort(), [
      ".bashrc",
      ".pnpm-completion.bash",
    ])
  } finally {
    fixture.cleanup()
  }
})

for (const failure of ["curl", "gpg --dearmor"]) {
  test(`repository setup stops after ${failure} fails`, () => {
    const fixture = setup(failure)
    try {
      assert.equal(fixture.run("setup-gcloud-repository.sh").status, 42)
      assert(!fixture.commands().some(({ command }) => command === "tee"))
    } finally {
      fixture.cleanup()
    }
  })
}

test("repository setup registers the signed source without installing packages", () => {
  const fixture = setup()
  try {
    const result = fixture.run("setup-gcloud-repository.sh")
    assert.equal(result.status, 0, result.stderr)
    const commands = fixture
      .commands()
      .map(({ command, args }) => [command, ...args].join(" "))
    assert(
      commands.some((command) => command.startsWith("gpg --dearmor --yes")),
    )
    assert.equal(
      commands.at(-1),
      "tee /etc/apt/sources.list.d/google-cloud-cli.list",
    )
    assert(!fixture.commands().some(({ command }) => command === "apt-get"))
  } finally {
    fixture.cleanup()
  }
})
