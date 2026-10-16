import type { Server } from "node:http"
import type { AddressInfo } from "node:net"
import { createInformationRepository } from "@aerpp/firestore/information"
import { Firestore } from "@google-cloud/firestore"
import { expect, test } from "@playwright/test"
import { createSupportApp } from "../src/app.js"
import { MailSink } from "../src/mail.js"
import { CALLER_SECRET, syntheticRuntime } from "../test-support/runtime.js"

let database: Firestore
let server: Server
let origin: string
const headers = {
  authorization: `Bearer local.${CALLER_SECRET}`,
  "Content-Type": "application/json",
}
test.beforeAll(async () => {
  if (!/^127\.0\.0\.1:[0-9]+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? ""))
    throw new Error("Isolated emulator required")
  database = new Firestore({ projectId: "demo-information-e2e" })
  const runtime = syntheticRuntime()
  runtime.credentials[0].operations.push("addInformation")
  server = await new Promise((accept) => {
    const listener = createSupportApp(runtime, database, new MailSink()).listen(
      0,
      "127.0.0.1",
      () => accept(listener),
    )
  })
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterAll(async () => {
  if (server) {
    server.closeAllConnections()
    await new Promise<void>((accept) => server.close(() => accept()))
  }
  if (database) await database.terminate()
})
test("Support HTTP and Admin repository share CRUD with stale-write fencing", async () => {
  const repository = createInformationRepository(database)
  const input = { content: "お知らせ 😀", expireAt: "2030-01-01T00:00:00.000Z" }
  expect(
    (
      await fetch(`${origin}/api/operator/information`, {
        method: "POST",
        headers,
        body: JSON.stringify(input),
      })
    ).status,
  ).toBe(200)
  const [original] = await repository.list()
  expect(original.content).toBe(input.content)
  expect(original.tone).toBe("info")
  expect(original.createdAt).not.toBeNull()
  const target = { id: original.id, version: original.version }
  const competing = await Promise.all([
    repository.update(target, { ...input, content: "編集 A" }),
    repository.update(target, { ...input, content: "編集 B" }),
  ])
  expect(competing.filter((result) => result.ok)).toHaveLength(1)
  expect(competing.filter((result) => !result.ok)).toEqual([
    { ok: false, code: "conflict" },
  ])
  expect(await repository.remove(target)).toEqual({
    ok: false,
    code: "conflict",
  })
  const [updated] = await repository.list()
  expect(updated.createdAt).toBe(original.createdAt)
  const response = await fetch(`${origin}/api/participant/information`, {
    headers,
  })
  expect(response.status).toBe(200)
  const { messages } = await response.json()
  expect(messages[0]).toMatchObject({
    id: original.id,
    content: updated.content,
    tone: "info",
  })
  expect(messages[0].expireAt).toHaveProperty("_seconds")
  const latest = { id: updated.id, version: updated.version }
  expect(await repository.remove(latest)).toEqual({ ok: true })
  expect(await repository.update(latest, input)).toEqual({
    ok: false,
    code: "not_found",
  })
  expect(await repository.remove(latest)).toEqual({
    ok: false,
    code: "not_found",
  })
  expect(await repository.list()).toEqual([])
  const id = await repository.add(input)
  expect((await repository.listMessages())[0]).toMatchObject({
    id,
    content: input.content,
  })
  await database.collection("information").doc(id).delete()
})

test("both information readers reject incomplete stored records", async () => {
  const repository = createInformationRepository(database)
  const ref = database.collection("information").doc("incomplete-notice")
  await ref.set({ content: "Incomplete notice" })
  try {
    await expect(repository.list()).rejects.toThrow()
    await expect(repository.listMessages()).rejects.toThrow()
    expect(
      (await fetch(`${origin}/api/participant/information`, { headers }))
        .status,
    ).toBe(500)
  } finally {
    await ref.delete()
  }
})
