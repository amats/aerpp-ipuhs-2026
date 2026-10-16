import "server-only"

import {
  questionnaireBucket,
  questionnaireObjectName,
  verifyQuestionnaireArtifact,
} from "@aerpp/config/questionnaire"
import { env } from "@aerpp/config/server/admin"
import { QuestionnaireReferenceSchema } from "@aerpp/participant-api-contracts/participant-api"
import { GoogleAuth } from "google-auth-library"
import { googleClientOptions } from "@/lib/google-auth"
import { EXPORT_CONSTRAINTS as limits } from "./export-constraints"
import {
  QUESTIONNAIRE_ARCHIVE_MAX_CONCURRENCY,
  QUESTIONNAIRE_ARCHIVE_TIMEOUT_MS,
  QUESTIONNAIRE_READ_TIMEOUT_MS,
} from "./questionnaire-constraints"
import type {
  QuestionDefinition,
  QuestionnaireFiles,
  ResearchSource,
} from "./research-types"

// Called only by authenticated research ZIP requests. No startup reads or fallback assets.
export async function readArchivedQuestionnaire(
  definitionId: string,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted()
  const name = questionnaireObjectName(definitionId)
  const bucket = questionnaireBucket(env.gcpProjectId ?? "")
  if (env.environment !== "test" && env.environment !== "production")
    throw new Error(
      "Questionnaire archive requires an explicit cloud environment",
    )
  const client =
    googleClientOptions.authClient ??
    (await new GoogleAuth({
      projectId: env.gcpProjectId,
      scopes: ["https://www.googleapis.com/auth/devstorage.read_only"],
    }).getClient())
  signal.throwIfAborted()
  const response = await client.request<string>({
    url: `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(name)}?alt=media`,
    responseType: "text",
    timeout: QUESTIONNAIRE_READ_TIMEOUT_MS,
    maxContentLength: limits.maxSourceBytes,
    signal,
  })
  if (typeof response.data !== "string")
    throw new Error("Invalid questionnaire archive response")
  return response.data
}

export async function loadResearchQuestionnaires(
  source: ResearchSource,
  {
    read = readArchivedQuestionnaire,
    signal = AbortSignal.timeout(QUESTIONNAIRE_ARCHIVE_TIMEOUT_MS),
    retain,
  }: {
    read?: typeof readArchivedQuestionnaire
    signal?: AbortSignal
    retain?: (pending: Promise<unknown>) => void
  } = {},
) {
  signal.throwIfAborted()
  const ids = new Set<string>()
  for (const { data } of source.analysisQuestionnaires) {
    // Completion metadata has no questionnaire reference until submission.
    if (data.questionnaire === undefined && data.submittedAt === undefined)
      continue
    const reference = QuestionnaireReferenceSchema.safeParse(data.questionnaire)
    if (reference.success !== true)
      throw new Error("Invalid stored questionnaire reference")
    ids.add(reference.data.definitionId)
  }
  const definitions: Record<string, QuestionDefinition> = {}
  const files: QuestionnaireFiles = {}
  const orderedIds = [...ids].sort()
  if (orderedIds.length === 0) return { definitions, files }
  const controller = new AbortController()
  const readSignal = AbortSignal.any([signal, controller.signal])
  const artifacts = new Map<
    string,
    ReturnType<typeof verifyQuestionnaireArtifact>
  >()
  let nextIndex = 0
  let bytes = 0
  async function worker() {
    try {
      while (nextIndex < orderedIds.length) {
        readSignal.throwIfAborted()
        const id = orderedIds[nextIndex++]
        const json = await read(id, readSignal)
        readSignal.throwIfAborted()
        bytes += Buffer.byteLength(json)
        if (bytes > limits.maxSourceBytes)
          throw new Error("Questionnaire capacity exceeded")
        artifacts.set(id, verifyQuestionnaireArtifact(json, id))
      }
    } catch (error) {
      controller.abort(error)
      throw error
    }
  }
  let onAbort = () => {}
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(readSignal.reason)
    readSignal.addEventListener("abort", onAbort, { once: true })
  })
  try {
    const workers = Array.from(
      {
        length: Math.min(
          orderedIds.length,
          QUESTIONNAIRE_ARCHIVE_MAX_CONCURRENCY,
        ),
      },
      () => worker(),
    )
    retain?.(Promise.allSettled(workers))
    // Race also covers credential resolution or a dependency ignoring abort.
    await Promise.race([Promise.all(workers), aborted])
  } catch (error) {
    controller.abort(error)
    throw error
  } finally {
    readSignal.removeEventListener("abort", onAbort)
  }
  for (const id of orderedIds) {
    const artifact = artifacts.get(id)
    if (artifact === undefined)
      throw new Error("Incomplete questionnaire archive")
    definitions[id] = artifact.definition
    files[questionnaireObjectName(id)] = artifact.json
  }
  return { definitions, files }
}
