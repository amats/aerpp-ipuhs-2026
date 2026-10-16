import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createQuestionnaireArtifact } from "@aerpp/config/questionnaire"
import { SURVEY_FILES } from "@aerpp/config/survey"
import { run } from "../shared/delivery.mjs"

export function readImageQuestionnaires(imageId, execute = run) {
  if (/^sha256:[a-f0-9]{64}$/.test(imageId) !== true)
    throw new Error("Immutable Web image ID required")
  const directory = mkdtempSync(join(tmpdir(), "aerpp-questionnaires-"))
  let container
  try {
    container = execute("docker", ["create", imageId])
    if (/^[a-f0-9]{12,64}$/.test(container) !== true)
      throw new Error("Invalid questionnaire extraction container")
    return SURVEY_FILES.map((name) => {
      const file = join(directory, name)
      execute("docker", [
        "cp",
        `${container}:/app/config/common/survey/${name}`,
        file,
      ])
      const source = readFileSync(file, "utf8")
      const artifact = createQuestionnaireArtifact(source)
      if (artifact.json !== source)
        throw new Error("Rebuild Web with canonical questionnaires")
      return { name, ...artifact }
    })
  } finally {
    try {
      if (container) execute("docker", ["rm", container])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }
}
