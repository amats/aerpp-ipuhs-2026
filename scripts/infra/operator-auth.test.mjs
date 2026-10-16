import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { test } from "node:test"
import {
  startOperatorTokenServer,
  withTerraformOperatorAuth,
} from "./operator-auth.mjs"

const CLIENT = "aerpp-terraform-operator"
const NONCE = "synthetic-loopback-capability"
const form = () =>
  new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: NONCE,
    client_id: CLIENT,
    client_secret: NONCE,
  })

test("loopback refresh requires its capability and retrieves a token for every refresh", async (t) => {
  let requests = 0
  const server = await startOperatorTokenServer(
    NONCE,
    () => `synthetic-${++requests}`,
  )
  t.after(() => server.close())
  assert.equal(new URL(server.url).hostname, "127.0.0.1")
  for (const index of [1, 2]) {
    const response = await fetch(server.url, { method: "POST", body: form() })
    assert.equal(response.headers.get("cache-control"), "no-store")
    assert.deepEqual(await response.json(), {
      access_token: `synthetic-${index}`,
      token_type: "Bearer",
      expires_in: 60,
    })
  }
  const body = form()
  body.delete("client_id")
  body.delete("client_secret")
  const response = await fetch(server.url, {
    method: "POST",
    body,
    headers: {
      authorization: `Basic ${Buffer.from(`${CLIENT}:${NONCE}`).toString("base64")}`,
    },
  })
  assert.equal(response.status, 200)
  assert.equal(requests, 3)
})

test("unauthenticated, unrelated and oversized requests cannot retrieve credentials", async (t) => {
  const server = await startOperatorTokenServer(NONCE, () =>
    assert.fail("invalid request fetched a token"),
  )
  t.after(() => server.close())
  assert.equal((await fetch(server.url)).status, 404)
  const bad = form()
  bad.set("refresh_token", "wrong")
  for (const body of [bad, new URLSearchParams()])
    assert.equal(
      (await fetch(server.url, { method: "POST", body })).status,
      403,
    )
  assert.equal(
    (await fetch(server.url, { method: "POST", body: "x".repeat(4097) }))
      .status,
    413,
  )
  assert.equal(
    (
      await fetch(server.url.replace("/token", "/other"), {
        method: "POST",
        body: form(),
      })
    ).status,
    404,
  )
})

test("credential-source failures and malformed tokens return no underlying details", async (t) => {
  let fail = true
  const server = await startOperatorTokenServer(NONCE, () => {
    if (fail) throw new Error("sensitive underlying detail")
    return "invalid token with spaces"
  })
  t.after(() => server.close())
  for (const failure of [true, false]) {
    fail = failure
    const response = await fetch(server.url, { method: "POST", body: form() })
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), {
      error: "temporarily_unavailable",
    })
  }
})

test("operator credentials stay private, bind the target and are removed after success or failure", async (t) => {
  const directory = mkdtempSync(resolve(tmpdir(), "aerpp-operator-auth-"))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const config = {
    projectId: "synthetic-test",
    infrastructure: { operatorAccount: "operator@synthetic.invalid" },
  }
  let file
  for (const failure of [false, true]) {
    const operation = withTerraformOperatorAuth(
      config.projectId,
      config,
      directory,
      (env) => {
        file = env.GOOGLE_APPLICATION_CREDENTIALS
        assert.equal(
          env.CLOUDSDK_CORE_ACCOUNT,
          config.infrastructure.operatorAccount,
        )
        assert.equal(env.GOOGLE_OAUTH_ACCESS_TOKEN, undefined)
        assert.equal(env.GOOGLE_BACKEND_ACCESS_TOKEN, undefined)
        assert.equal(statSync(file).mode & 0o777, 0o600)
        const data = JSON.parse(readFileSync(file, "utf8"))
        assert.equal(data.type, "external_account_authorized_user")
        assert.equal(new URL(data.token_url).hostname, "127.0.0.1")
        assert.equal(data.refresh_token, data.client_secret)
        assert.equal(data.refresh_token.length, 43)
        assert.equal(file.includes(data.refresh_token), false)
        if (failure) throw new Error("synthetic operation failed")
        return "complete"
      },
    )
    if (failure) await assert.rejects(operation, /synthetic operation failed/)
    else assert.equal(await operation, "complete")
    assert.equal(existsSync(file), false)
  }
  await assert.rejects(
    withTerraformOperatorAuth("other-project", config, directory, () =>
      assert.fail(),
    ),
    /matching private project/,
  )
})

test("the worker renews the bound gcloud identity while a synchronous Terraform process blocks its parent", async (t) => {
  const directory = mkdtempSync(resolve(tmpdir(), "aerpp-auth-worker-"))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const config = {
    projectId: "synthetic-test",
    infrastructure: { operatorAccount: "operator@synthetic.invalid" },
  }
  const command = resolve(directory, "gcloud")
  const counter = resolve(directory, "count.json")
  writeFileSync(
    command,
    `#!${process.execPath}\nconst fs=require('node:fs');if(process.env.CLOUDSDK_CORE_ACCOUNT!=='operator@synthetic.invalid'||!process.argv.includes('--project=synthetic-test'))process.exit(2);const file=${JSON.stringify(counter)};const n=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):0;fs.writeFileSync(file,JSON.stringify(n+1));process.stdout.write('synthetic-token-'+(n+1));\n`,
  )
  chmodSync(command, 0o700)
  const previous = process.env.PATH
  process.env.PATH = `${directory}:${previous}`
  t.after(() => {
    process.env.PATH = previous
  })
  await withTerraformOperatorAuth(
    config.projectId,
    config,
    directory,
    (env) => {
      const result = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import fs from 'node:fs';const c=JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS,'utf8'));for(const n of [1,2]){const response=await fetch(c.token_url,{method:'POST',body:new URLSearchParams({grant_type:'refresh_token',client_id:c.client_id,client_secret:c.client_secret,refresh_token:c.refresh_token})});const data=await response.json();if(data.access_token!=='synthetic-token-'+n)process.exit(1)}process.stdout.write('refreshed');`,
        ],
        { env, encoding: "utf8", timeout: 10000 },
      )
      assert.equal(
        result.status,
        0,
        "worker must serve refresh requests while parent is blocked",
      )
      assert.equal(result.stdout, "refreshed")
    },
  )
  assert.equal(JSON.parse(readFileSync(counter)), 2)
})
