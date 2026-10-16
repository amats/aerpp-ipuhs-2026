import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

test("startup probes Responses with synthetic input and rejects unavailable or incompatible inference", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "aerpp-llm-probe-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  copyFileSync(
    new URL("../../infra/check-local-llm.mjs", import.meta.url),
    join(root, "check-local-llm.mjs"),
  )
  let response
  let status = 200
  const calls = []
  const server = createServer(async (req, res) => {
    let body = ""
    for await (const chunk of req) body += chunk
    calls.push({
      path: req.url,
      body: body === "" ? undefined : JSON.parse(body),
    })
    res.setHeader("Content-Type", "application/json")
    if (req.url === "/v1/models")
      return res.end(JSON.stringify({ data: [{ id: "synthetic-model" }] }))
    res.statusCode = status
    res.end(JSON.stringify(response))
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  t.after(() => server.close())
  const generation = {
    temperature: 0.2,
    topP: 0.9,
    topK: 20,
    repeatPenalty: 1.1,
    seed: 42,
  }
  writeFileSync(
    join(root, "llm-config.json"),
    JSON.stringify({
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
      model: "synthetic-model",
      generation,
    }),
  )
  const completed = {
    status: "completed",
    output: [
      {
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: "OK" }],
      },
    ],
  }
  for (const scenario of [
    { status: 200, body: completed, exit: 0 },
    { status: 404, body: {}, exit: 1 },
    {
      status: 200,
      body: { choices: [{ message: { content: "OK" } }] },
      exit: 1,
    },
    { status: 200, body: { ...completed, status: "incomplete" }, exit: 1 },
    { status: 200, body: { ...completed, output: [] }, exit: 1 },
    {
      status: 200,
      body: {
        ...completed,
        output: [{ ...completed.output[0], role: "user" }],
      },
      exit: 1,
    },
    {
      status: 200,
      body: {
        ...completed,
        output: [
          {
            ...completed.output[0],
            content: [{ type: "output_text", text: " " }],
          },
        ],
      },
      exit: 1,
    },
  ]) {
    status = scenario.status
    response = scenario.body
    const child = spawn(process.execPath, [join(root, "check-local-llm.mjs")], {
      stdio: "pipe",
    })
    child.stdout.resume()
    child.stderr.resume()
    assert.equal((await once(child, "exit"))[0], scenario.exit)
    assert.equal(calls.at(-1).path, "/v1/responses")
    assert.deepEqual(calls.at(-1).body, {
      model: "synthetic-model",
      input: "Startup connectivity check. Reply with OK.",
      stream: false,
      store: false,
      temperature: generation.temperature,
      top_p: generation.topP,
      top_k: generation.topK,
      repeat_penalty: generation.repeatPenalty,
      seed: generation.seed,
    })
  }
})
