import { execFileSync } from "node:child_process"
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  createQuestionnaireArtifact,
  questionnaireObjectName,
} from "@aerpp/config/questionnaire"
import { expect, it } from "vitest"
import type { SourceDocument } from "../src/features/research/research-types"
import { readArchive } from "../test-support/read-archive"

it("generates separate archives with valid, unreadable and missing emails using public inputs only", () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url))
  const temporary = mkdtempSync(join(tmpdir(), "aerpp-sample-"))
  try {
    const script = "apps/admin/scripts/generate-research-sample.mjs"
    mkdirSync(dirname(join(temporary, script)), { recursive: true })
    copyFileSync(join(root, script), join(temporary, script))
    for (const entry of [
      "apps/admin/node_modules",
      "apps/admin/src/features/research",
      "config/common/survey",
    ]) {
      mkdirSync(dirname(join(temporary, entry)), { recursive: true })
      symlinkSync(join(root, entry), join(temporary, entry), "dir")
    }
    execFileSync(process.execPath, [join(temporary, script)], {
      cwd: temporary,
      stdio: "pipe",
    })
    const output = join(temporary, "generated/reports/export-sample")
    const research = readArchive(
      readFileSync(join(output, "research-source-SAMPLE.zip")),
    )
    const access = readArchive(
      readFileSync(join(output, "access-source-SAMPLE.zip")),
    )
    for (const name of ["survey-initial.json", "survey-follow-up.json"]) {
      const artifact = createQuestionnaireArtifact(
        readFileSync(join(root, "config/common/survey", name), "utf8"),
      )
      const path = questionnaireObjectName(artifact.definitionId)
      expect(research[path]).toBe(artifact.json)
      expect(access).not.toHaveProperty(path)
    }
    const researchData = JSON.parse(research["source.json"])
    expect(
      researchData.analysisQuestionnaires.some(
        (row: SourceDocument) => row.data.pseudonym === "SAMPLE-P008",
      ),
    ).toBe(false)
    expect(
      researchData.analysisQuestionnaires.some(
        (row: SourceDocument) => row.data.pseudonym === "SAMPLE-P007",
      ),
    ).toBe(true)
    const data = JSON.parse(access["source.json"])
    expect(data.manifest.schemaVersion).toBe(8)
    expect(data.manifest.excludedRecords).toBe(0)
    for (const collection of ["participationEvents", "emailConfirmations"]) {
      const rows: SourceDocument[] = data[collection]
      const failed = rows.filter((row) => row.data.pseudonym === "SAMPLE-P008")
      expect(failed).toHaveLength(collection === "participationEvents" ? 2 : 1)
      for (const row of failed) {
        expect(row.data.email).toBe("復号できません")
        if (collection === "participationEvents")
          expect(row.data.did).toBeNull()
      }
      expect(
        rows.find((row) => row.id === "SAMPLE-CONSENT-P001")?.data.email,
      ).toBe("participant-1@example.invalid")
      expect(data.manifest.counts[collection]).toEqual({
        read: rows.length,
        exported: rows.length,
      })
      expect(
        access[
          collection === "participationEvents"
            ? "participation-events.csv"
            : "email-confirmations.csv"
        ].match(/"復号できません"/g),
      ).toHaveLength(failed.length)
    }
    const missing = data.participationEvents.find(
      (row: SourceDocument) => row.id === "SAMPLE-WITHDRAWAL-P007",
    )
    expect(missing.data).not.toHaveProperty("email")
    expect(missing.data.did).toBeNull()
    for (const [dataset, files] of Object.entries({ research, access })) {
      for (const [name, content] of Object.entries(files)) {
        expect(readFileSync(join(output, "files", dataset, name), "utf8")).toBe(
          content,
        )
        expect(content).not.toContain("encryptedEmail")
        expect(content).not.toContain("synthetic-unreadable-email")
        expect(content).not.toContain("synthetic-sample-email-seal-password")
        if (dataset === "research")
          expect(content).not.toContain("@example.invalid")
      }
    }
    expect(readFileSync(join(output, "SAMPLE-GUIDE.md"), "utf8")).toContain(
      "SAMPLE-P008",
    )
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})
