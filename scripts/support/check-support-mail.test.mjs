import assert from "node:assert/strict"
import test from "node:test"
import { sendOnce } from "./check-support-mail.mjs"

test("mail check claims before sending and never repeats uncertain delivery", async () => {
  let claimed = false
  let attempts = 0
  let evidence
  const dependencies = {
    claim() {
      assert.equal(claimed, false)
      claimed = true
    },
    async send() {
      attempts++
      throw new Error("private SDK details")
    },
    save(value) {
      evidence = value
    },
  }
  assert.equal(await sendOnce(dependencies), false)
  assert.deepEqual(evidence, { accepted: false, deliveryUnconfirmed: true })
  await assert.rejects(() => sendOnce(dependencies))
  assert.equal(attempts, 1)
})
test("HTTP acceptance is separate from mailbox delivery", async () => {
  let evidence
  assert.equal(
    await sendOnce({
      claim() {},
      send: async () => new Response('{"ok":true}', { status: 200 }),
      save(value) {
        evidence = value
      },
    }),
    true,
  )
  assert.deepEqual(evidence, {
    status: 200,
    accepted: true,
    deliveryUnconfirmed: false,
  })
})
