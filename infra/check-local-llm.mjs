import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

try {
  const config = JSON.parse(
    readFileSync(new URL("./llm-config.json", import.meta.url)),
  )
  const base = new URL(config.baseUrl)
  assert(
    ["localhost", "127.0.0.1", "host.docker.internal", "[::1]"].includes(
      base.hostname,
    ),
  )
  const models = await fetch(`${base.href.replace(/\/$/, "")}/models`, {
    signal: AbortSignal.timeout(15000),
  })
  assert.equal(models.status, 200)
  assert((await models.json()).data.some((item) => item.id === config.model))
  const generation = config.generation
  const result = await fetch(`${base.href.replace(/\/$/, "")}/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(120000),
    body: JSON.stringify({
      model: config.model,
      input: "Startup connectivity check. Reply with OK.",
      stream: false,
      store: false,
      temperature: generation.temperature,
      top_p: generation.topP,
      top_k: generation.topK,
      repeat_penalty: generation.repeatPenalty,
      seed: generation.seed,
    }),
  })
  assert.equal(result.status, 200)
  assert.equal(
    result.headers.get("content-type")?.split(";")[0].trim(),
    "application/json",
  )
  const response = await result.json()
  assert.equal(response.status, "completed")
  assert(Array.isArray(response.output))
  const messages = response.output.filter((item) => item.type === "message")
  assert(messages.length > 0)
  for (const message of messages) {
    assert.equal(message.role, "assistant")
    assert(message.status === undefined || message.status === "completed")
    assert(Array.isArray(message.content))
    assert(
      message.content.every(
        (part) => part.type === "output_text" && typeof part.text === "string",
      ),
    )
  }
  assert(
    messages
      .flatMap((message) => message.content)
      .map((part) => part.text)
      .join("")
      .trim(),
  )
  console.log(
    "Configured local model is available and completed a synthetic generation check.",
  )
} catch {
  console.error(
    "Local model startup check failed; verify LM Studio and the selected model. No model or application generation settings were changed.",
  )
  process.exitCode = 1
}
