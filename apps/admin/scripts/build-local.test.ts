import { spawnSync } from "node:child_process"
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { adminBuildEnvironment } from "./build-settings.mjs"

describe("isolated Admin verification build", () => {
  it("starts a production build with common questionnaires and no inherited application settings", () => {
    const directory = mkdtempSync(join(tmpdir(), "admin-local-build-"))
    try {
      mkdirSync(join(directory, "scripts"))
      for (const name of ["build-local.mjs", "build-settings.mjs"])
        cpSync(new URL(name, import.meta.url), join(directory, "scripts", name))
      mkdirSync(join(directory, "node_modules/@aerpp"), { recursive: true })
      symlinkSync(
        fileURLToPath(new URL("../../../packages/config", import.meta.url)),
        join(directory, "node_modules/@aerpp/config"),
      )
      mkdirSync(join(directory, "node_modules/next/dist/bin"), {
        recursive: true,
      })
      writeFileSync(
        join(directory, "node_modules/next/dist/bin/next"),
        "process.stdout.write(JSON.stringify({args: process.argv.slice(2), env: process.env})); process.exitCode = 23",
      )
      const result = spawnSync(
        process.execPath,
        [join(directory, "scripts/build-local.mjs")],
        {
          encoding: "utf8",
          env: {
            PATH: process.env.PATH,
            NODE_ENV: "development",
            AERPP_ENVIRONMENT: "production",
            NEXTAUTH_SECRET: "synthetic-inherited-secret",
            GCP_PROJECT_ID: "synthetic-inherited-project",
            GOOGLE_APPLICATION_CREDENTIALS:
              "/synthetic-private-credential.json",
            FIRESTORE_EMULATOR_HOST: "invalid:9999",
            ADMIN_AUTH_BYPASS_ENABLED: "true",
            SUPPORT_API_CREDENTIAL: "synthetic-inherited-api-key",
            NODE_OPTIONS: "--max-old-space-size=64",
          },
        },
      )
      expect(result.status, result.stderr).toBe(23)
      const { args, env } = JSON.parse(result.stdout)
      expect(args).toEqual(["build"])
      expect(env).toMatchObject({
        AERPP_ENVIRONMENT: "",
        NODE_ENV: "production",
        GCP_PROJECT_ID: "synthetic-admin-build",
        GOOGLE_APPLICATION_CREDENTIALS: "",
        NODE_OPTIONS: "",
        ADMIN_AUTH_BYPASS_ENABLED: "",
        FIRESTORE_EMULATOR_HOST: "",
        SUPPORT_API_CREDENTIAL: "",
      })
      expect(result.stdout).not.toContain("synthetic-inherited")
      expect(result.stdout).not.toContain("synthetic-private-credential")
      writeFileSync(
        join(directory, ".env.local"),
        "NEXTAUTH_SECRET=synthetic-conflict",
      )
      const conflict = spawnSync(
        process.execPath,
        [join(directory, "scripts/build-local.mjs")],
        { encoding: "utf8" },
      )
      expect(conflict.status).toBe(1)
      expect(conflict.stderr).toContain("app-local .env")
      expect(conflict.stdout).toBe("")
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it("retains explicit image environments without adding runtime credentials", () => {
    for (const profile of ["test", "production"]) {
      const env = adminBuildEnvironment(profile)
      expect(env).toMatchObject({
        AERPP_ENVIRONMENT: profile,
        GOOGLE_APPLICATION_CREDENTIALS: "",
        ADMIN_AUTH_BYPASS_ENABLED: "",
        NODE_ENV: "production",
      })
    }
    expect(() => adminBuildEnvironment("invalid")).toThrow()
  })
})
