import {
  getBrowserSession,
  readBrowserPayload,
  replaceBrowserPayload,
} from "@/lib/browser-session"

export async function readStoredResult() {
  await getBrowserSession()
  return (await readBrowserPayload("analysisResult")).value
}

export async function writeStoredResult(value: string | null) {
  await getBrowserSession()
  const snapshot = await readBrowserPayload("analysisResult")
  if ((await replaceBrowserPayload("analysisResult", snapshot, value)) !== true)
    throw new Error("Synthetic result write conflicted")
}
