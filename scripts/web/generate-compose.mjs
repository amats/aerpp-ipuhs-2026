import { mkdirSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { readAutoSettings } from "@aerpp/config/auto-settings"
import { requireConfigured } from "@aerpp/config/safety"
import {
  checkApplication,
  checkCredential,
  environmentDirectory,
  generatedEnvironmentDirectory,
  prepareApplicationRuntime,
  validateTargetValues,
} from "@aerpp/config/workspace"
import { privateJson } from "../shared/delivery.mjs"

// Compose interpolates string values even in JSON, including secrets and paths.
function composeLiteral(value) {
  return value.replaceAll("$", () => "$$")
}

export function generateWebCompose(
  name,
  image,
  directory = environmentDirectory(name),
  projects,
  output = generatedEnvironmentDirectory(name),
) {
  if (!image || !/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/.test(image))
    throw new Error("Specify the Web image built for the selected environment")
  const { target, values } = prepareApplicationRuntime(name, directory, {
    projects: projects,
    apps: ["web", "logging"],
  })
  validateTargetValues(target, values)
  checkApplication("web", values.web, name)
  checkCredential(
    values.logging.GOOGLE_APPLICATION_CREDENTIALS,
    target.project,
    "logging",
    readAutoSettings(directory, target).serviceAccounts?.logging,
  )
  requireConfigured(
    values.logging,
    ["GCP_LOGGING_LOCATION", "GCP_LOGGING_NAMESPACE"],
    "logging",
    readAutoSettings(directory, target).serviceAccounts?.logging,
  )
  const { GOOGLE_APPLICATION_CREDENTIALS: credential, ...logging } =
    values.logging
  const literalEnvironment = (env) =>
    Object.fromEntries(
      Object.entries(env).map(([key, value]) => [key, composeLiteral(value)]),
    )
  const manifest = {
    name: `aerpp-${name}`,
    services: {
      "app-aerpp": { image, environment: literalEnvironment(values.web) },
      "fluent-bit": {
        environment: literalEnvironment(logging),
        volumes: [
          {
            type: "bind",
            source: composeLiteral(credential),
            target: "/fluent-bit/etc/gcp-credentials.json",
            read_only: true,
            bind: { create_host_path: false },
          },
        ],
      },
    },
  }
  mkdirSync(output, { recursive: true, mode: 0o700 })
  privateJson(resolve(output, "compose.json"), manifest)
}

export function main(args = process.argv.slice(2)) {
  try {
    const [name, image, ...extra] = args
    if (extra.length)
      throw new Error("Usage: web:generate-compose test|production <web-image>")
    generateWebCompose(name, image)
    console.log(
      `Generated ${name} Compose settings privately; no containers started`,
    )
    return 0
  } catch {
    console.error(
      "Cannot generate Compose settings; check environment, Web image, Web settings and logging credentials",
    )
    return 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = main()
