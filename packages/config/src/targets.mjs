import { existsSync, readFileSync } from "node:fs"
import { environmentDefinition } from "./safety.mjs"

const PROJECT_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/
export function loadCloudProjects(
  selected,
  readConfig = (name) => {
    const file = new URL(
      `../../../config/${environmentDefinition(name).directory}/config.json`,
      import.meta.url,
    )
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined
  },
) {
  const projects = {}
  for (const name of ["test", "production"]) {
    let project
    try {
      project = readConfig(name)?.projectId
    } catch {
      if (selected === name || !selected)
        throw new Error(`Cannot read ${name} cloud project configuration`)
      continue
    }
    if (project === undefined) continue
    if (!PROJECT_PATTERN.test(project) || project.startsWith("demo-")) {
      if (selected === name || !selected)
        throw new Error(`Configure ${name} projectId`)
      continue
    }
    projects[name] = project
  }
  if (projects.test && projects.test === projects.production)
    throw new Error("Test and production must use distinct project IDs")
  return projects
}
export function environmentTarget(name, projects) {
  const definition = environmentDefinition(name)
  if (definition.kind === "emulator") return { name, project: "demo-aerpp" }
  const configured = projects ?? loadCloudProjects(name)
  if (configured.test && configured.test === configured.production)
    throw new Error("Test and production must use distinct project IDs")
  const project = configured[name]
  if (!PROJECT_PATTERN.test(project ?? "") || project.startsWith("demo-"))
    throw new Error(`Configure the selected ${name} cloud project`)
  return { name, project }
}
