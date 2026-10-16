import { isDeepStrictEqual } from "node:util"

function knownFields(value, unknown) {
  if (Array.isArray(value))
    return value.map((item, index) => knownFields(item, unknown?.[index]))
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => unknown?.[key] !== true)
      .map(([key, item]) => [key, knownFields(item, unknown?.[key])]),
  )
}

export function permitsMaintenanceUpdate(resource) {
  if (resource.change?.actions?.join() !== "update") return false
  const before = knownFields(
    structuredClone(resource.change.before),
    resource.change.after_unknown,
  )
  const after = knownFields(
    structuredClone(resource.change.after),
    resource.change.after_unknown,
  )
  try {
    if (
      [
        "google_service_account.local_admin",
        "google_service_account.logging",
      ].includes(resource.address)
    ) {
      for (const value of [before, after]) {
        delete value.display_name
        delete value.description
      }
    } else if (
      [
        "google_artifact_registry_repository.support",
        "google_artifact_registry_repository.admin[0]",
      ].includes(resource.address)
    ) {
      if (after.cleanup_policy_dry_run !== false) return false
      const policies = after.cleanup_policies
      if (!Array.isArray(policies) || ![2, 3].includes(policies.length))
        return false
      const old = policies.find((policy) => policy.id === "delete-old")
      const recent = policies.find((policy) => policy.id === "keep-recent")
      const deployed = policies.find((policy) => policy.id === "keep-deployed")
      if (
        old?.action !== "DELETE" ||
        old.condition?.[0]?.tag_state !== "ANY" ||
        old.condition[0].older_than !== "86400s" ||
        recent?.action !== "KEEP" ||
        recent.most_recent_versions?.[0]?.keep_count !== 1 ||
        (deployed &&
          (deployed.action !== "KEEP" ||
            deployed.condition?.[0]?.tag_state !== "ANY" ||
            !deployed.condition[0].version_name_prefixes?.length ||
            !deployed.condition[0].version_name_prefixes.every((digest) =>
              /^sha256:[a-f0-9]{57}$/.test(digest),
            )))
      )
        return false
      for (const value of [before, after]) {
        delete value.cleanup_policies
        delete value.cleanup_policy_dry_run
      }
      if (resource.address === "google_artifact_registry_repository.admin[0]") {
        if (after.docker_config?.[0]?.immutable_tags !== false) return false
        // New mutable repositories can omit the default Docker configuration.
        if (before.docker_config?.length === 0) before.docker_config = [{}]
        delete before.docker_config[0].immutable_tags
        delete after.docker_config[0].immutable_tags
      }
    } else if (resource.address === "google_cloud_run_v2_service.support[0]") {
      const previousLabels = before.template[0].labels ?? {}
      const nextLabels = after.template[0].labels ?? {}
      if (isDeepStrictEqual(previousLabels, nextLabels) !== true) {
        const environment = after.labels?.["aerpp-environment"]
        const ownership = {
          "aerpp-component": "support",
          "aerpp-environment": environment,
        }
        if (
          !["test", "production"].includes(environment) ||
          Object.entries(ownership).some(
            ([key, value]) =>
              previousLabels[key] !== undefined &&
              previousLabels[key] !== value,
          ) ||
          isDeepStrictEqual(nextLabels, { ...previousLabels, ...ownership }) !==
            true
        )
          return false
        // Permit only adding canonical revision ownership for log monitoring.
        delete before.template[0].labels
        delete after.template[0].labels
      }
      const previousResources = before.template[0].containers[0].resources?.[0]
      const nextResources = after.template[0].containers[0].resources?.[0]
      if (previousResources?.cpu_idle !== nextResources?.cpu_idle) {
        if (
          previousResources?.cpu_idle !== false ||
          nextResources?.cpu_idle !== true
        )
          return false
        delete previousResources.cpu_idle
        delete nextResources.cpu_idle
      }
      const previousProbes = before.template[0].containers[0].startup_probe
      const nextProbes = after.template[0].containers[0].startup_probe
      if (isDeepStrictEqual(previousProbes, nextProbes) !== true) {
        const previous = previousProbes?.[0]
        const next = nextProbes?.[0]
        if (
          previousProbes?.length !== 1 ||
          nextProbes?.length !== 1 ||
          previous?.http_get?.[0]?.path !== "/health" ||
          previous?.timeout_seconds !== 1 ||
          previous?.period_seconds !== 10 ||
          previous?.failure_threshold !== 3 ||
          next?.period_seconds !== 1 ||
          next?.failure_threshold !== 30
        )
          return false
        // Detect readiness sooner while preserving the thirty-second budget.
        for (const probe of [previous, next]) {
          delete probe.period_seconds
          delete probe.failure_threshold
        }
      }
      const previousImage = before.template[0].containers[0].image
      const nextImage = after.template[0].containers[0].image
      if (previousImage !== nextImage) {
        const previous = /^(.+)@sha256:[a-f0-9]{64}$/.exec(previousImage ?? "")
        const next = /^(.+)@sha256:[a-f0-9]{64}$/.exec(nextImage ?? "")
        if (!previous || !next || previous[1] !== next[1]) return false
      }
      for (const value of [before, after]) {
        delete value.template[0].containers[0].image
        delete value.template[0].containers[0].env[0].value_source[0]
          .secret_key_ref[0].version
      }
    } else if (resource.address === "google_cloud_run_v2_service.admin[0]") {
      if (before.template[0].timeout !== after.template[0].timeout) {
        if (
          before.template[0].timeout !== "60s" ||
          after.template[0].timeout !== "120s"
        )
          return false
        delete before.template[0].timeout
        delete after.template[0].timeout
      }
      for (const value of [before, after]) {
        delete value.template[0].containers[0].image
        delete value.template[0].containers[0].env
        delete value.traffic
      }
    } else if (
      [
        'google_cloud_scheduler_job.support["withdrawal-cleanup"]',
        'google_cloud_scheduler_job.support["mail-health"]',
      ].includes(resource.address)
    ) {
      delete before.paused
      delete after.paused
      if (before.attempt_deadline !== after.attempt_deadline) {
        if (
          before.attempt_deadline !== "60s" ||
          after.attempt_deadline !== "75s"
        )
          return false
        delete before.attempt_deadline
        delete after.attempt_deadline
      }
      if (resource.address.endsWith('["withdrawal-cleanup"]')) {
        if (
          !["*/5 * * * *", "*/30 * * * *"].includes(before.schedule) ||
          after.schedule !== "*/30 * * * *"
        )
          return false
        delete before.schedule
        delete after.schedule
      }
    } else if (
      resource.address === "google_monitoring_alert_policy.support_errors[0]"
    ) {
      delete before.conditions[0].condition_matched_log[0].filter
      delete after.conditions[0].condition_matched_log[0].filter
      delete before.documentation
      delete after.documentation
    } else if (
      resource.address === "google_monitoring_notification_channel.support[0]"
    ) {
      delete before.labels.email_address
      delete after.labels.email_address
    } else return false
    return isDeepStrictEqual(before, after)
  } catch {
    return false
  }
}

export function selectMailAdmissionEvidence(runtime, baseline, current, image) {
  const evidence = baseline?.cloud?.image === image ? baseline : current
  assertMailAdmission(runtime, evidence, image)
  return evidence
}

export function assertMailAdmission(runtime, evidence, image) {
  if (!runtime.admissionOpen) return
  const { cloud, data, scheduler } = evidence ?? {}
  if (
    !["test", "production"].includes(runtime.environment) ||
    !runtime.maintenanceEnabled ||
    runtime.mailMode !== "gmail" ||
    cloud?.project !== runtime.projectId ||
    cloud.image !== image ||
    data?.project !== runtime.projectId ||
    data.ttlActive !== true ||
    scheduler?.project !== runtime.projectId ||
    scheduler.revision !== cloud.revision ||
    scheduler.runtimeSha256 !== data.runtimeSha256 ||
    ![200, 503, 403].every((status) =>
      data.checks?.some((check) => check.status === status),
    ) ||
    !["withdrawal-cleanup", "mail-health"].every((operation) =>
      scheduler.checks?.some(
        (check) =>
          check.operation === operation &&
          check.schedulerStatus === 200 &&
          check.serviceStatus === 200 &&
          check.skipped === false,
      ),
    )
  )
    throw new Error(
      "Mail admission requires accepted data/Scheduler evidence for this image",
    )
}
