import { createHash } from "node:crypto"
import { z } from "zod"

export const QUESTIONNAIRE_ID_PATTERN = /^jcs-v1:sha256:[a-f0-9]{64}$/
export const QUESTIONNAIRE_MAX_BYTES = 200_000

// Validate the archive without projecting away study-owned definition fields.
const definitionSchema = z
  .object({
    survey_version: z.string().min(1),
    description: z.string().min(1),
    types: z.array(
      z
        .object({
          type: z.enum(["section", "likert7", "single_choice", "text"]),
          labels: z.record(z.string(), z.string()).optional(),
        })
        .passthrough(),
    ),
    items: z
      .array(
        z
          .object({
            type: z.enum(["section", "likert7", "single_choice", "text"]),
            item_id: z.string().optional(),
            section_id: z.string().optional(),
            question_ja: z.string().optional(),
            required: z.boolean().optional(),
            construct: z.string().optional(),
            reverse: z.boolean().optional(),
            options: z.array(z.string()).optional(),
          })
          .passthrough()
          .refine((item) =>
            item.type === "section"
              ? typeof item.section_id === "string" &&
                item.section_id.length > 0
              : typeof item.item_id === "string" &&
                item.item_id.length > 0 &&
                typeof item.question_ja === "string" &&
                typeof item.required === "boolean",
          ),
      )
      .min(1),
  })
  .passthrough()

// Parse before JCS serialization: JSON.parse alone silently accepts duplicate keys.
export function parseQuestionnaireJson(source) {
  if (
    typeof source !== "string" ||
    Buffer.byteLength(source) > QUESTIONNAIRE_MAX_BYTES
  )
    throw new Error("Invalid questionnaire size")
  let offset = 0
  const whitespace = () => {
    while (/[\t\n\r ]/.test(source[offset] ?? "x")) offset++
  }
  function string() {
    const start = offset++
    while (offset < source.length) {
      const character = source[offset++]
      if (character === "\\") offset++
      else if (character === '"') {
        const value = JSON.parse(source.slice(start, offset))
        if (value.isWellFormed() !== true)
          throw new Error("Invalid questionnaire Unicode")
        return value
      }
    }
    throw new Error("Invalid questionnaire JSON")
  }
  function value(depth = 0) {
    if (depth > 32) throw new Error("Questionnaire nesting limit exceeded")
    whitespace()
    const character = source[offset]
    if (character === '"') return string()
    if (character === "{" || character === "[") {
      const object = character === "{"
      const end = object ? "}" : "]"
      const entries = []
      const keys = new Set()
      offset++
      whitespace()
      if (source[offset] !== end) {
        while (true) {
          whitespace()
          let key
          if (object) {
            if (source[offset] !== '"')
              throw new Error("Invalid questionnaire JSON")
            key = string()
            if (keys.has(key) === true)
              throw new Error("Duplicate questionnaire key")
            keys.add(key)
            whitespace()
            if (source[offset++] !== ":")
              throw new Error("Invalid questionnaire JSON")
          }
          const child = value(depth + 1)
          entries.push(object ? [key, child] : child)
          whitespace()
          if (source[offset] !== ",") break
          offset++
        }
      }
      if (source[offset++] !== end)
        throw new Error("Invalid questionnaire JSON")
      return object ? Object.fromEntries(entries) : entries
    }
    const token =
      /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
        source.slice(offset),
      )
    if (token === null) throw new Error("Invalid questionnaire JSON")
    offset += token[0].length
    const parsed = JSON.parse(token[0])
    if (typeof parsed === "number" && Number.isFinite(parsed) !== true)
      throw new Error("Invalid questionnaire number")
    return parsed
  }
  const parsed = value()
  whitespace()
  if (offset !== source.length) throw new Error("Invalid questionnaire JSON")
  if (definitionSchema.safeParse(parsed).success !== true)
    throw new Error("Invalid questionnaire definition")
  return parsed
}

// RFC 8785: UTF-16 key order, ECMAScript primitive encoding, unchanged arrays/strings.
function canonicalJson(value) {
  if (Array.isArray(value) === true)
    return `[${value.map(canonicalJson).join(",")}]`
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`
  return JSON.stringify(value)
}

export function createQuestionnaireArtifact(source) {
  const definition = parseQuestionnaireJson(source)
  const json = canonicalJson(definition)
  const digest = createHash("sha256").update(json, "utf8").digest("hex")
  return {
    definition: JSON.parse(json),
    json,
    definitionId: `jcs-v1:sha256:${digest}`,
  }
}

export function questionnaireObjectName(definitionId) {
  if (
    typeof definitionId !== "string" ||
    QUESTIONNAIRE_ID_PATTERN.test(definitionId) !== true
  )
    throw new Error("Invalid questionnaire identifier")
  return `questionnaires/jcs-v1/sha256/${definitionId.slice("jcs-v1:sha256:".length)}.json`
}

export function verifyQuestionnaireArtifact(source, definitionId) {
  questionnaireObjectName(definitionId)
  const artifact = createQuestionnaireArtifact(source)
  if (artifact.definitionId !== definitionId || artifact.json !== source)
    throw new Error("Questionnaire archive integrity mismatch")
  return artifact
}

export function questionnaireBucket(project) {
  if (
    typeof project !== "string" ||
    /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project) !== true
  )
    throw new Error("Explicit questionnaire project required")
  return `${project}-questionnaires`
}
