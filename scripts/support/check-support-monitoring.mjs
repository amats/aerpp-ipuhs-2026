import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { environmentTarget } from "@aerpp/config/targets"
import { environmentDirectory } from "@aerpp/config/workspace"
import { gcloud, outputDirectory, privateJson } from "../shared/delivery.mjs"
import { assertSupportErrorPolicy } from "./support-monitoring-policy.mjs"

export function assertSupportMonitoring(channels, alerts, email, project) {
  assert(typeof email === "string" && email.trim().length > 0)
  const matchingChannels = channels.filter(
    (item) => item.displayName === "AERPP support operator",
  )
  assert.equal(matchingChannels.length, 1)
  const channel = matchingChannels[0]
  assert(
    channel?.enabled === true &&
      typeof channel.name === "string" &&
      new RegExp(
        `^projects/${project}/notificationChannels/[A-Za-z0-9_-]+$`,
      ).test(channel.name) === true &&
      channel.type === "email" &&
      channel.labels?.email_address === email,
  )
  const matchingPolicies = alerts.filter(
    (item) =>
      item.displayName === "AERPP support errors and maintenance failures",
  )
  assert.equal(matchingPolicies.length, 1)
  const policy = matchingPolicies[0]
  assert(
    policy?.enabled === true &&
      typeof policy.name === "string" &&
      new RegExp(`^projects/${project}/alertPolicies/[A-Za-z0-9_-]+$`).test(
        policy.name,
      ) === true &&
      Array.isArray(policy.notificationChannels) === true &&
      policy.notificationChannels.length === 1 &&
      policy.notificationChannels[0] === channel.name,
  )
  assertSupportErrorPolicy(policy, project)
  return { channel, policy }
}

async function main() {
  const [environment, mode] = process.argv.slice(2)
  assert(["test", "production"].includes(environment))
  assert.equal(process.argv.slice(2).length, 2)
  assert(["check", "diagnose", "notify-once"].includes(mode))
  const { project } = environmentTarget(environment)
  const config = JSON.parse(
    readFileSync(resolve(environmentDirectory(environment), "config.json")),
  )
  const email = config.infrastructure.monitoring.notificationEmail
  const token = gcloud(project, ["auth", "print-access-token"])
  const get = async (path) => {
    const response = await fetch(
      `https://monitoring.googleapis.com/v3/projects/${project}/${path}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20000),
      },
    )
    assert.equal(response.status, 200)
    return response.json()
  }
  const collect = async (path, key) => {
    const items = []
    let pageToken
    do {
      const page = await get(
        `${path}${pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : ""}`,
      )
      items.push(...(page[key] ?? []))
      pageToken = page.nextPageToken
    } while (pageToken)
    return items
  }
  const [channels, alerts] = await Promise.all([
    collect("notificationChannels", "notificationChannels"),
    collect("alertPolicies", "alertPolicies"),
  ])
  const { channel, policy } = assertSupportMonitoring(
    channels,
    alerts,
    email,
    project,
  )
  const output = outputDirectory(environment)
  privateJson(resolve(output, "support-monitoring-check.json"), {
    checkedAt: new Date().toISOString(),
    project,
    channel: channel.name,
    policies: [policy.name],
    independentEmailChannel: true,
    notificationReceiptVerified: false,
  })
  if (mode === "diagnose") {
    const [incidents, snoozes] = await Promise.all([
      collect("alerts", "alerts"),
      collect("snoozes", "snoozes"),
    ])
    const filter = `timestamp >= "${policy.creationRecord.mutateTime}" AND (${policy.conditions[0].conditionMatchedLog.filter})`
    const matchingLogs = JSON.parse(
      gcloud(project, [
        "logging",
        "read",
        filter,
        "--freshness=1h",
        "--limit=100",
        "--format=json",
      ]),
    )
    privateJson(resolve(output, "support-monitoring-diagnostic.json"), {
      checkedAt: new Date().toISOString(),
      project,
      channel,
      policies: alerts,
      incidents,
      snoozes,
      matchingLogs,
      notificationReceiptVerified: false,
    })
    console.log(
      `Read-only diagnosis saved privately: ${incidents.length} project incidents, ${snoozes.length} snooze records, ${matchingLogs.length} matching logs in the last hour (limit 100). Receipt requires operator confirmation.`,
    )
  } else if (mode === "notify-once") {
    writeFileSync(
      resolve(output, "support-alert-test-claim.json"),
      JSON.stringify({ requestedAt: new Date().toISOString(), project }),
      { mode: 0o600, flag: "wx" },
    )
    gcloud(project, [
      "logging",
      "write",
      "aerpp-support-alert-test",
      '{"event":"operator-notification-test","purpose":"deployment-acceptance"}',
      "--payload-type=json",
      "--severity=ERROR",
    ])
    console.log(
      "One sanitized monitoring test event written. Confirm receipt at the configured operator mailbox; no Gmail sender credentials used.",
    )
  } else
    console.log(
      "Error notification channel and policy verified. Notification receipt remains a separate check.",
    )
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch(() => {
    console.error(
      "Monitoring acceptance incomplete; check private evidence and permissions. Do not repeat a claimed notification test automatically.",
    )
    process.exitCode = 1
  })
