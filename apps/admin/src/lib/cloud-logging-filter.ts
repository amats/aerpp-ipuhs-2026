import type { OperationalService } from "./cloud-logging-types"

// Revision labels are copied to request, system and application log entries.
// Keep list queries, maintenance queries and Console links on the same scope.
export const OPERATIONAL_SERVICE_FILTERS = {
  web: 'resource.type="generic_node" AND labels.component="app-aerpp"',
  proxy: 'resource.type="generic_node" AND labels.component="caddy"',
  support:
    'resource.type="cloud_run_revision" AND labels."aerpp-component"="support"',
  admin:
    'resource.type="cloud_run_revision" AND labels."aerpp-component"="admin"',
  scheduler:
    'resource.type="cloud_scheduler_job" AND resource.labels.job_id=("aerpp-support-withdrawal-cleanup" OR "aerpp-support-mail-health")',
} as const satisfies Record<OperationalService, string>

export function buildOperationalLogFilter(
  since: string,
  until: string,
): string {
  const resourceScope = Object.values(OPERATIONAL_SERVICE_FILTERS)
    .map((filter) => `(${filter})`)
    .join(" OR ")
  // Scope to application-owned resources, excluding unrelated project logs.
  return `timestamp>="${since}" AND timestamp<="${until}" AND (${resourceScope}) AND (jsonPayload.event:* OR jsonPayload.operation:* OR severity>=WARNING OR jsonPayload.level=("warn" OR "error" OR "fatal") OR httpRequest.status>=500 OR (labels.component="caddy" AND jsonPayload.status>=500))`
}
