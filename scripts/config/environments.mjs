import { pathToFileURL } from "node:url"
import {
  checkEnvironment,
  environmentDirectory,
  generateEnvironment,
  initializeEnvironment,
} from "@aerpp/config/workspace"

export function main(args = process.argv.slice(2)) {
  try {
    const [command, name, selectedApp, ...extra] = args
    if (
      !["init", "check", "generate"].includes(command) ||
      extra.length ||
      (selectedApp !== undefined &&
        !(
          command === "init" ||
          ["web", "admin", "logging", "support"].includes(selectedApp)
        ))
    )
      throw new Error(
        "Usage: environments.mjs init test|production <project-id>, or check|generate example|test|production [app]",
      )
    const directory = environmentDirectory(name)
    if (command === "init")
      initializeEnvironment(
        name,
        directory,
        selectedApp ? { [name]: selectedApp } : undefined,
      )
    else if (command === "generate")
      generateEnvironment(name, directory, undefined, undefined, selectedApp)
    else checkEnvironment(name, directory, undefined, selectedApp)
    console.log(
      `${command} ${name}${selectedApp ? `/${selectedApp}` : ""}: complete. No cloud operation performed.`,
    )
    return 0
  } catch (error) {
    console.error(error.message)
    return 1
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = main()
