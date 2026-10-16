import "server-only"

import { env } from "@aerpp/config/server/admin"
import { operationalLogQuery } from "./operational-log-query"
import type { OperationalGroup } from "./operational-log-types"

export function operationalConsoleUrl(
  since: string,
  until: string,
  group?: OperationalGroup,
): string | null {
  if (
    !env.gcpProjectId ||
    ["test", "production"].includes(env.environment) !== true
  )
    return null
  const query = operationalLogQuery(since, until, group)
  // Parentheses are route syntax in Console's matrix parameters, but
  // encodeURIComponent leaves them unescaped.
  const encodedQuery = encodeURIComponent(query)
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
  const url = new URL(
    `https://console.cloud.google.com/logs/query;query=${encodedQuery}`,
  )
  url.searchParams.set("project", env.gcpProjectId)
  return url.toString()
}
