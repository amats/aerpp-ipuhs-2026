import { randomUUID } from "node:crypto"
import { setImmediate as yieldWork } from "node:timers/promises"
import { env } from "@aerpp/config/server/admin"
import { exportDownloadArchive } from "@/features/research/export-archive"
import { EXPORT_CONSTRAINTS as limits } from "@/features/research/export-constraints"
import { decryptExportEmail } from "@/features/research/export-email"
import { acquireExportWork } from "@/features/research/export-work"
import { loadResearchQuestionnaires } from "@/features/research/research-definitions"
import { eligibleResearchSource } from "@/features/research/research-eligibility"
import {
  ACCESS_CSV_FILES,
  accessFiles,
  buildAccessExport,
  buildRawExport,
  researchFiles,
} from "@/features/research/research-export"
import { readResearchSource } from "@/features/research/research-source"
import { requireAdminSession } from "@/lib/auth"
import { logExportFailure } from "@/lib/logger"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
}
export async function GET(request: Request) {
  await requireAdminSession("/research")
  const query = new URL(request.url).searchParams
  const dataset = query.get("dataset") ?? "research"
  const format = query.get("format") ?? "json"
  const csvFiles: Record<string, string> =
    dataset === "research"
      ? {
          analysisQuestionnaires: "analysis-questionnaires.csv",
          attempts: "attempts.csv",
        }
      : dataset === "access"
        ? ACCESS_CSV_FILES
        : {}
  if (
    !["research", "access"].includes(dataset) ||
    !["bundle", "json", ...Object.keys(csvFiles)].includes(format)
  )
    return new Response("Invalid dataset or format", {
      status: 400,
      headers: HEADERS,
    })
  const work = acquireExportWork()
  if (work === null)
    return new Response(
      "出力処理が進行中です。時間をおいて再試行してください。",
      {
        status: 429,
        headers: { ...HEADERS, "Retry-After": "15" },
      },
    )
  try {
    // Include the snapshot read in the budget, reserving time to serialize the ZIP.
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(limits.requestTimeoutMs),
    ])
    const archiveSignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(limits.readTimeoutMs),
    ])
    const source = await readResearchSource(dataset !== "research", {
      signal: archiveSignal,
      retain: work.retain,
    })
    archiveSignal?.throwIfAborted()
    const exportId = randomUUID()
    const archive =
      dataset === "research" && format === "bundle"
        ? await loadResearchQuestionnaires(eligibleResearchSource(source), {
            signal: archiveSignal,
            retain: work.retain,
          })
        : { definitions: {}, files: {} }
    await yieldWork()
    signal.throwIfAborted()
    const only =
      format === "bundle"
        ? undefined
        : format === "json"
          ? "source.json"
          : csvFiles[format]
    const files: Record<string, string> =
      dataset === "research"
        ? researchFiles(
            buildRawExport(source, archive.definitions, exportId),
            archive.files,
            only,
          )
        : accessFiles(
            await buildAccessExport(
              source,
              (value) => decryptExportEmail(value, env.sessionSealPassword),
              env.identifierHashSecret,
              exportId,
              signal,
            ),
            only,
          )
    await yieldWork()
    signal.throwIfAborted()
    if (
      Object.values(files).reduce(
        (total, content) => total + Buffer.byteLength(content),
        0,
      ) > limits.maxFileBytes
    )
      throw new Error("Export capacity exceeded")
    const content =
      format === "bundle"
        ? new Uint8Array(await exportDownloadArchive(files, signal))
        : files[format === "json" ? "source.json" : csvFiles[format]]
    signal.throwIfAborted()
    return new Response(content, {
      headers: {
        ...HEADERS,
        "Content-Type":
          format === "bundle"
            ? "application/zip"
            : format === "json"
              ? "application/json; charset=utf-8"
              : "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${dataset}-source-${exportId}.${format === "bundle" ? "zip" : format === "json" ? "json" : "csv"}"`,
      },
    })
  } catch (error) {
    logExportFailure(error)
    return new Response(
      "元データを取得できませんでした。出力は完了していません。再度お試しください。",
      { status: 503, headers: HEADERS },
    )
  } finally {
    work.release()
  }
}
