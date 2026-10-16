import {
  buildOperationalLogFilter,
  OPERATIONAL_SERVICE_FILTERS,
} from "@/lib/cloud-logging-filter"
import type { OperationalGroup } from "./operational-log-types"

export function operationalLogQuery(
  since: string,
  until: string,
  group?: OperationalGroup,
): string {
  let query = buildOperationalLogFilter(since, until)
  if (!group) return query
  query += ` AND ${OPERATIONAL_SERVICE_FILTERS[group.service]}`
  // Groups contain only catalogued event/operation/code values.
  for (const field of ["event", "operation", "code"] as const)
    if (group[field] !== null)
      query += ` AND jsonPayload.${field}=${JSON.stringify(group[field])}`
  // A generic group must not lead to ordinary startup or success events.
  query +=
    ' AND (severity>=WARNING OR jsonPayload.level=("warn" OR "error" OR "fatal") OR httpRequest.status>=500 OR jsonPayload.statusCode>=500 OR jsonPayload.responseStatus>=500 OR jsonPayload.status>=500 OR jsonPayload.failed>0 OR jsonPayload.outcome=("failed" OR "partial") OR jsonPayload.event=~"[.]failed$")'
  const fields = [
    "jsonPayload.statusCode",
    "jsonPayload.responseStatus",
    "jsonPayload.status",
    "httpRequest.status",
  ]
  // Follow the first non-null status field. A transport failure without HTTP
  // status must not link to rejected HTTP requests from a different group.
  const statusQuery = fields
    .map((field, index) =>
      [
        ...fields
          .slice(0, index)
          .map((prior) => `(NOT ${prior}:* OR ${prior}=NULL_VALUE)`),
        group.statusCode === null
          ? `(${field}>=100 AND ${field}<=599)`
          : `${field}=${group.statusCode}`,
      ].join(" AND "),
    )
    .map((clause) => `(${clause})`)
    .join(" OR ")
  query += ` AND ${group.statusCode === null ? "NOT " : ""}(${statusQuery})`
  return query
}
