import { expect, it } from "vitest"
import { buildOperationalLogFilter } from "./cloud-logging-filter"

it("includes proxy HTTP failures recorded at info level without broadening project resource scope", () => {
  const filter = buildOperationalLogFilter(
    "2026-10-08T00:00:00Z",
    "2026-10-09T00:00:00Z",
  )
  expect(filter).toContain(
    '(labels.component="caddy" AND jsonPayload.status>=500)',
  )
  expect(filter).toContain('labels."aerpp-component"="admin"')
  expect(filter).toContain('labels."aerpp-component"="support"')
  expect(filter).not.toContain("service_name")
  expect(filter).toContain(
    'resource.type="generic_node" AND labels.component="app-aerpp"',
  )
})
