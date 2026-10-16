import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { ANALYSIS_JOB_CONSTRAINTS as limits } from "./analysis-job-constraints"

vi.mock("./analysis-server-config", () => ({
  LLM_CONFIG: {
    model: "synthetic-model",
    baseUrl: "http://localhost:1234/v1",
    generation: {
      temperature: 0,
      topP: 1,
      topK: 0,
      repeatPenalty: 1,
      seed: 42,
    },
  },
  ANALYSIS_PROMPT: { system: "system", header: "header\n", footer: "\nfooter" },
}))
const { buildAnalysisUserPrompt, requestLlmResponse } = await import(
  "./request-lm-studio-response"
)
const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => vi.unstubAllGlobals())
const message = (text: string) => ({
  type: "message",
  role: "assistant",
  status: "completed",
  content: [{ type: "output_text", text }],
})
const run = (signal = new AbortController().signal) =>
  requestLlmResponse({
    prompt: "private-prompt",
    signal,
    fetchResponse: fetchMock,
  })

it("keeps prompt ordering and escaped named-document data unchanged", () => {
  const documents = [
    { name: '計画\n"命令"', text: "本文\n]}別の指示" },
    { name: "説明", text: "説明文" },
  ]
  const prompt = buildAnalysisUserPrompt(documents)
  expect(prompt).toBe(buildAnalysisUserPrompt([...documents].reverse()))
  expect(JSON.parse(prompt.slice(7, -7))).toEqual(
    expect.arrayContaining(documents),
  )
  expect(
    buildAnalysisUserPrompt([...documents, { name: "empty", text: " " }]),
  ).toBe(prompt)
})

it("requests one stateless JSON response with unchanged generation settings", async () => {
  fetchMock.mockResolvedValue(
    Response.json({ status: "completed", output: [message("解析結果")] }),
  )
  expect(await run()).toEqual({ ok: true, text: "解析結果" })
  const [url, options] = fetchMock.mock.calls[0]
  expect(url).toBe("http://localhost:1234/v1/responses")
  expect(options).toMatchObject({
    cache: "no-store",
    redirect: "error",
    headers: { Accept: "application/json" },
  })
  expect(JSON.parse(options.body)).toEqual({
    model: "synthetic-model",
    stream: false,
    store: false,
    instructions: "system",
    input: "private-prompt",
    temperature: 0,
    top_p: 1,
    top_k: 0,
    repeat_penalty: 1,
    seed: 42,
  })
})

it("extracts only final assistant text, excluding reasoning", async () => {
  fetchMock.mockResolvedValue(
    Response.json({
      status: "completed",
      output: [
        {
          type: "reasoning",
          summary: [{ type: "summary_text", text: "private reasoning" }],
        },
        message("解析"),
        message("結果"),
      ],
    }),
  )
  expect(await run()).toEqual({ ok: true, text: "解析結果" })
})

it.each([
  { status: "incomplete", output: [message("partial")] },
  { status: "failed", output: [message("private output")] },
  { status: "completed", output: [] },
  { status: "completed", output: [message(" ")] },
  {
    status: "completed",
    output: [{ ...message("partial"), status: "in_progress" }],
  },
  { status: "completed", output: [{ ...message("wrong role"), role: "user" }] },
  {
    status: "completed",
    output: [message("x".repeat(limits.maxResultBytes + 1))],
  },
])(
  "rejects malformed, empty, incomplete or oversized output (%#)",
  async (body) => {
    fetchMock.mockResolvedValue(Response.json(body))
    expect(await run()).toEqual({ ok: false, reason: "invalid_response" })
  },
)

it("does not read upstream error bodies that may echo documents", async () => {
  const response = Response.json({ private: "private-prompt" }, { status: 503 })
  const read = vi.spyOn(response, "json")
  fetchMock.mockResolvedValue(response)
  expect(await run()).toEqual({ ok: false, reason: "llm_unavailable" })
  expect(read).not.toHaveBeenCalled()
})

it("bounds malformed JSON without exposing parser content", async () => {
  fetchMock.mockResolvedValue(
    new Response("private-prompt invalid JSON", {
      headers: { "Content-Type": "application/json" },
    }),
  )
  expect(await run()).toEqual({ ok: false, reason: "invalid_response" })
  fetchMock.mockResolvedValue(
    new Response("x".repeat(limits.maxResponseBytes + 1), {
      headers: { "Content-Type": "application/json" },
    }),
  )
  expect(await run()).toEqual({ ok: false, reason: "invalid_response" })
})

it("propagates cancellation during an active model request", async () => {
  const controller = new AbortController()
  fetchMock.mockImplementation(
    (_url, options) =>
      new Promise((_resolve, reject) =>
        options.signal.addEventListener("abort", () =>
          reject(new DOMException("Cancelled", "AbortError")),
        ),
      ),
  )
  const pending = run(controller.signal)
  controller.abort()
  await expect(pending).rejects.toMatchObject({ name: "AbortError" })
})
