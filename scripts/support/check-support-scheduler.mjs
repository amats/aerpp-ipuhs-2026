import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { resolve } from "node:path"
import {
  readSupportEnvironment,
  supportMaintenanceWindowActive,
} from "@aerpp/config/support"
import {
  environmentDirectory,
  prepareApplicationRuntime,
} from "@aerpp/config/workspace"
import {
  gcloud,
  outputDirectory,
  privateJson,
  readJson,
} from "../shared/delivery.mjs"

try {
  const args = process.argv.slice(2)
  const selectedArgs = args
  const [environment, mode] = selectedArgs
  assert(["test", "production"].includes(environment))
  assert(["run", "check"].includes(mode))
  assert.equal(selectedArgs.length, 2)
  const { target, values } = prepareApplicationRuntime(
    environment,
    environmentDirectory(environment),
    { apps: "support" },
  )
  const runtime = readSupportEnvironment(values.support)
  assert.equal(runtime.admissionOpen, false)
  assert.equal(runtime.maintenanceEnabled, true)
  const output = outputDirectory(environment)
  const deployment = readJson(
    resolve(output, "support-deployment.json"),
    "Prepared deployment",
  )
  assert.equal(deployment.project, target.project)
  assert.equal(
    createHash("sha256")
      .update(values.support.SUPPORT_RUNTIME_JSON)
      .digest("hex"),
    deployment.runtimeSha256,
  )
  const cloud = readJson(
    resolve(output, "support-cloud-check.json"),
    "Cloud acceptance",
  )
  assert.equal(cloud.project, target.project)
  assert.equal(cloud.runtimeVersion, deployment.runtimeVersion)
  assert.equal(cloud.image, deployment.image)
  const jobs = ["withdrawal-cleanup", "mail-health"].map((operation) => {
    const name = `aerpp-support-${operation}`
    const job = JSON.parse(
      gcloud(target.project, [
        "scheduler",
        "jobs",
        "describe",
        name,
        `--location=${deployment.region}`,
        "--format=json",
      ]),
    )
    const uri = new URL(`/maintenance/${operation}`, runtime.baseUrl).href
    assert.equal(job.state, "ENABLED")
    assert.equal(job.httpTarget.httpMethod, "POST")
    assert.equal(job.httpTarget.uri, uri)
    assert.equal(job.httpTarget.oidcToken.audience, uri)
    assert.equal(
      job.httpTarget.oidcToken.serviceAccountEmail,
      runtime.schedulerIdentity,
    )
    return { name, operation, uri }
  })
  const requestFile = resolve(output, "support-scheduler-request.json")
  if (mode === "run") {
    privateJson(requestFile, {
      project: target.project,
      runtimeSha256: deployment.runtimeSha256,
      startedAt: new Date().toISOString(),
      maintenanceWindowActive: supportMaintenanceWindowActive(runtime),
    })
    for (const job of jobs)
      gcloud(target.project, [
        "scheduler",
        "jobs",
        "run",
        job.name,
        `--location=${deployment.region}`,
      ])
    console.log(
      "Two maintenance jobs requested. Run check after logs arrive; no email send requested.",
    )
  } else {
    const request = readJson(requestFile, "Scheduler request")
    assert.equal(request.project, target.project)
    assert.equal(request.runtimeSha256, deployment.runtimeSha256)
    assert(Number.isFinite(Date.parse(request.startedAt)))
    const checks = jobs.map((job) => {
      const filter = `resource.type="cloud_scheduler_job" resource.labels.job_id="${job.name}" timestamp>="${request.startedAt}" jsonPayload."@type"="type.googleapis.com/google.cloud.scheduler.logging.AttemptFinished"`
      const finished = JSON.parse(
        gcloud(target.project, [
          "logging",
          "read",
          filter,
          "--limit=10",
          "--format=json",
        ]),
      )
      assert(finished.some((entry) => entry.httpRequest?.status === 200))
      const runFilter = `resource.type="cloud_run_revision" resource.labels.service_name="aerpp-support" resource.labels.revision_name="${cloud.revision}" timestamp>="${request.startedAt}" httpRequest.requestUrl="${job.uri}" httpRequest.requestMethod="POST" httpRequest.status=200`
      const requests = JSON.parse(
        gcloud(target.project, [
          "logging",
          "read",
          runFilter,
          "--limit=10",
          "--format=json",
        ]),
      )
      assert(requests.length > 0)
      const operation =
        job.operation === "withdrawal-cleanup"
          ? "withdrawalCleanup"
          : "mailHealth"
      assert.equal(typeof request.maintenanceWindowActive, "boolean")
      const code = request.maintenanceWindowActive
        ? "MAINTENANCE_COMPLETED"
        : "MAINTENANCE_OUTSIDE_WINDOW"
      const resultFilter = `resource.type="cloud_run_revision" resource.labels.revision_name="${cloud.revision}" timestamp>="${request.startedAt}" jsonPayload.operation="${operation}" jsonPayload.code="${code}"`
      const results = JSON.parse(
        gcloud(target.project, [
          "logging",
          "read",
          resultFilter,
          "--limit=10",
          "--format=json",
        ]),
      )
      assert(results.length > 0)
      if (
        job.operation === "withdrawal-cleanup" &&
        request.maintenanceWindowActive
      ) {
        const cleanupFilter = `resource.type="cloud_run_revision" resource.labels.revision_name="${cloud.revision}" timestamp>="${request.startedAt}" jsonPayload.operation="withdrawalCleanup"`
        const cleanup = JSON.parse(
          gcloud(target.project, [
            "logging",
            "read",
            cleanupFilter,
            "--limit=10",
            "--format=json",
          ]),
        )
        assert(cleanup.some((entry) => entry.jsonPayload?.failed === 0))
        assert(!cleanup.some((entry) => entry.jsonPayload?.failed > 0))
      }
      return {
        operation: job.operation,
        schedulerStatus: 200,
        serviceStatus: 200,
        skipped: !request.maintenanceWindowActive,
      }
    })
    privateJson(resolve(output, "support-scheduler-check.json"), {
      _comment: "Generated real Scheduler/OIDC acceptance; do not edit",
      project: target.project,
      checkedAt: new Date().toISOString(),
      runtimeSha256: deployment.runtimeSha256,
      revision: cloud.revision,
      checks,
      mailSent: false,
    })
    console.log(
      request.maintenanceWindowActive
        ? "Both real Scheduler/OIDC calls completed on the accepted revision; Gmail token refresh succeeded without sending email."
        : "Both real Scheduler/OIDC calls skipped data and Gmail work outside the backend operating window on the accepted revision.",
    )
  }
} catch {
  console.error(
    "Scheduler acceptance incomplete; verify configuration and allow time for execution logs before retrying check. No credentials or raw logs emitted.",
  )
  process.exitCode = 1
}
