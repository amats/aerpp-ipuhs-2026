import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { registerHooks } from "node:module"
import { fileURLToPath } from "node:url"
import {
  createQuestionnaireArtifact,
  questionnaireObjectName,
} from "@aerpp/config/questionnaire"
import { defaults, seal } from "iron-webcrypto"

// Load the actual pure TypeScript exporters without connecting to cloud services.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && context.parentURL) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL)
      if (existsSync(candidate)) return nextResolve(candidate.href, context)
    }
    return nextResolve(specifier, context)
  },
})
const root = new URL("../../../", import.meta.url)
const feature = new URL("apps/admin/src/features/research/", root)
const { buildRawExport, buildAccessExport, researchFiles, accessFiles } =
  await import(new URL("research-export.ts", feature))
const { exportArchive } = await import(new URL("export-archive.ts", feature))
const { decryptExportEmail } = await import(new URL("export-email.ts", feature))
const samplePassword = "synthetic-sample-email-seal-password"
const originals = Object.fromEntries(
  ["survey-initial.json", "survey-follow-up.json"].map((name) => [
    name,
    readFileSync(new URL(`config/common/survey/${name}`, root), "utf8"),
  ]),
)
const definitions = {
  initial: JSON.parse(originals["survey-initial.json"]),
  followup: JSON.parse(originals["survey-follow-up.json"]),
}
const timestamp = (iso) => ({
  seconds: Math.floor(Date.parse(iso) / 1000),
  nanoseconds: 123456789,
})
const source = {
  emailConfirmations: [],
  analysisQuestionnaires: [],
  attempts: [],
  participationEvents: [],
  participationStates: [],
  snapshotAt: "2026-09-19T12:00:00.000Z",
}
const owners = new Map()
for (let n = 1; n <= 8; n++) {
  const pseudonym = `SAMPLE-P${String(n).padStart(3, "0")}`
  const renewed = n === 7
  const boundary = renewed ? "SAMPLE-WITHDRAWAL-P007" : null
  const owner = {
    dataPurpose: n === 5 ? "test" : n === 6 ? "unclassified" : "research",
    pseudonym,
    consentId: `SAMPLE-CONSENT-P${String(n).padStart(3, "0")}`,
    clientId: `SAMPLE-CLIENT-${n}`,
    serverId: n % 2 ? "sample-server-a" : "sample-server-b",
  }
  owners.set(n, owner)
  const encryptedEmail =
    n === 8
      ? "synthetic-unreadable-email"
      : `${await seal(`participant-${n}@example.invalid`, { id: "1", secret: samplePassword }, defaults)}~2`
  source.participationStates.push({
    id: pseudonym,
    data: {
      pseudonym,
      dataPurpose: n === 5 ? "test" : n === 6 ? "unclassified" : "research",
      status: n === 8 ? "withdrawn" : "active",
      consentBoundaryId: boundary,
      ...(n === 8
        ? {
            lastWithdrawalId: "SAMPLE-WITHDRAWAL-P008",
            withdrawnAt: timestamp("2026-09-18T00:00:00Z"),
            cleanupStatus: "pending",
          }
        : {}),
    },
  })
  source.participationEvents.push({
    id: owner.consentId,
    data: {
      ...owner,
      encryptedEmail,
      eventType: "consent",
      precedingWithdrawalId: boundary,
      consentRequestedAt: timestamp("2026-09-01T08:59:00Z"),
      consentConfirmedAt: timestamp("2026-09-01T09:00:00Z"),
    },
  })
  source.emailConfirmations.push({
    id: owner.consentId,
    data: {
      ...owner,
      encryptedEmail,
      status: "completed",
      createdAt: timestamp("2026-09-01T08:59:00Z"),
      updatedAt: timestamp("2026-09-01T09:00:00Z"),
    },
  })
  if (renewed || n === 8)
    source.participationEvents.push({
      id: renewed ? boundary : "SAMPLE-WITHDRAWAL-P008",
      data: {
        ...owner,
        eventType: "withdrawal",
        consentId: renewed
          ? `SAMPLE-OLD-CONSENT-P${String(n).padStart(3, "0")}`
          : owner.consentId,
        consentBoundaryId: null,
        ...(n === 8 ? { encryptedEmail } : {}),
        withdrawalAcceptedAt: timestamp(
          renewed ? "2026-08-31T09:00:00Z" : "2026-09-18T00:00:00Z",
        ),
      },
    })
}
function answersFor(definition, person, round) {
  const answers = {}
  for (const item of definition.items) {
    if (!item.item_id) continue
    answers[item.item_id] = null
    if (item.type === "single_choice")
      answers[item.item_id] =
        item.options[(person + round) % item.options.length]
    if (item.type === "likert7")
      answers[item.item_id] = String(
        1 + ((person * 3 + round + Number(item.item_id.at(-1))) % 7),
      )
  }
  return answers
}
function execution(person, round, options = {}) {
  const owner = owners.get(person)
  const analysisId = `SAMPLE-A${String(person).padStart(3, "0")}-${round}`
  const startedAtMs =
    Date.parse(`2026-09-${String(2 + round * 3).padStart(2, "0")}T10:00:00Z`) +
    person * 60000
  const durationMs = 40000 + person * 1000
  const outcome = options.outcome ?? "completed"
  const attempt = {
    ...owner,
    analysisId,
    startedAtMs,
    questionnaireKind: round === 1 ? "initial" : "follow-up",
    modelName: "sample-local-model",
    documentGraphemeCounts: [1200 + person * 100, 800],
  }
  if (outcome !== "unconfirmed")
    Object.assign(attempt, {
      outcome,
      endedAtMs: startedAtMs + durationMs,
      durationMs,
    })
  source.attempts.push({ id: analysisId, data: attempt })
  if (outcome !== "completed") return
  const metadata = {
    ...owner,
    analysisId,
    analysisWorkspaceVersion: "1.0.0",
    modelName: "sample-local-model",
    processingDurationSeconds: durationMs / 1000,
    documentCount: 2,
    documentGraphemeCount: 2000 + person * 100,
    resultGraphemeCount: 600 + person * 40,
  }
  const data = {
    ...metadata,
    createdAt: timestamp(
      new Date(startedAtMs + durationMs + 1000).toISOString(),
    ),
    _integrity: { version: 1, metadata },
  }
  if (options.submitted !== false) {
    const answers = answersFor(
      round === 1 ? definitions.initial : definitions.followup,
      person,
      round,
    )
    if (person === 1 && round === 1)
      Object.assign(answers, {
        TX1: "【架空サンプル】確認する観点を整理する参考になった。",
        TX2: "【架空サンプル】説明が長く、要点を探しにくかった。",
        TX3: "【架空サンプル】想定していた指摘と共通する点があった。",
      })
    if (person === 1 && round > 1)
      answers.TX_F1 =
        "【架空サンプル】見出しがあると確認しやすい。\n短い要約も欲しい。"
    if (person === 2 && round === 1) {
      answers.PE1 = "6"
      delete answers.PE2
      answers.PE3 = "5"
      answers.TX2 = ""
    }
    if (person === 3 && round === 1)
      for (const item of definitions.initial.items)
        if (item.type === "likert7") delete answers[item.item_id]
    if (person === 4 && round === 1) {
      answers.PE1 = "8"
      answers.EE1 = true
    }
    if (person === 5 && round === 1) {
      answers.PE1 = null
      delete answers.PE2
      answers.PE3 = "6"
    }
    const definition = round === 1 ? definitions.initial : definitions.followup
    const questionnaire = {
      kind: round === 1 ? "initial" : "follow-up",
      definitionId: createQuestionnaireArtifact(JSON.stringify(definition))
        .definitionId,
    }
    Object.assign(
      data,
      { answers, questionnaire },
      {
        submittedAt: timestamp(
          new Date(startedAtMs + durationMs + 180000).toISOString(),
        ),
      },
    )
    data._integrity.answers = { questionnaire, answers }
  }
  source.analysisQuestionnaires.push({ id: analysisId, data })
}
for (let person = 1; person <= 8; person++)
  execution(person, 1, { submitted: person !== 6 })
execution(1, 2)
execution(1, 3)
execution(2, 2)
execution(4, 2)
execution(7, 2)
execution(3, 2, { outcome: "failed" })
execution(5, 2, { outcome: "cancelled" })
execution(6, 2, { outcome: "unconfirmed" })

const artifacts = Object.values(originals).map(createQuestionnaireArtifact)
const archivedDefinitions = Object.fromEntries(
  artifacts.map((artifact) => [artifact.definitionId, artifact.definition]),
)
const archiveFiles = Object.fromEntries(
  artifacts.map((artifact) => [
    questionnaireObjectName(artifact.definitionId),
    artifact.json,
  ]),
)
const data = buildRawExport(source, archivedDefinitions)
const access = await buildAccessExport(
  source,
  (value) => decryptExportEmail(value, samplePassword),
  "synthetic-sample-identifier-secret",
)
const output = new URL("generated/reports/export-sample/", root)
rmSync(new URL("files/", output), { recursive: true, force: true })
for (const [dataset, files] of Object.entries({
  research: researchFiles(data, archiveFiles),
  access: accessFiles(access),
})) {
  mkdirSync(new URL(`files/${dataset}/`, output), {
    recursive: true,
    mode: 0o700,
  })
  for (const [name, content] of Object.entries(files)) {
    const file = new URL(`files/${dataset}/${name}`, output)
    mkdirSync(new URL(".", file), { recursive: true, mode: 0o700 })
    writeFileSync(file, content, { mode: 0o600 })
  }
  writeFileSync(
    new URL(`${dataset}-source-SAMPLE.zip`, output),
    exportArchive(files),
    { mode: 0o600 },
  )
}
writeFileSync(
  new URL("sample-summary.json", output),
  JSON.stringify(
    {
      notice: "Generated; do not edit. SYNTHETIC SAMPLE ONLY; no cloud access.",
      synthetic: true,
      research: data.manifest.counts,
      access: access.manifest.counts,
    },
    null,
    2,
  ),
  { mode: 0o600 },
)
writeFileSync(
  new URL("SAMPLE-GUIDE.md", output),
  "# Synthetic export sample\n\nGenerated; do not edit. No real participationStates or cloud access.\n\nSeparate research-source-SAMPLE.zip and access-source-SAMPLE.zip archives match the individual downloads; files/ contains their extracted contents. All retained purposes are included; research rows from closed withdrawal periods are excluded. Access retains withdrawal history. Reconcile later withdrawals and previously downloaded research copies offline. JSON preserves missing/null/invalid values; CSV is supplementary.\n\nAccess files contain decrypted fictional email addresses at example.invalid. SAMPLE-P008 deliberately has an unreadable email in its consent, withdrawal and authentication records: email is 復号できません in JSON and CSV, and the consent/withdrawal did is null in JSON and blank in CSV. These three rows remain included in the counts. SAMPLE-P007's withdrawal has no email field, so it stays absent in JSON and its did is null; missing and unreadable values remain distinct.\n",
  { mode: 0o600 },
)
console.log(fileURLToPath(new URL("research-source-SAMPLE.zip", output)))

console.log(fileURLToPath(new URL("access-source-SAMPLE.zip", output)))
