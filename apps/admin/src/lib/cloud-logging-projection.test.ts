import { expect, it } from "vitest"
import { toOperationalLogEntry } from "./cloud-logging-projection"

it.each(["admin", "support"] as const)(
  "classifies %s by revision ownership regardless of service name",
  (component) => {
    for (const name of ["custom-service", "aerpp-admin", "aerpp-support"]) {
      const entry = toOperationalLogEntry(
        {
          data: {},
          metadata: {
            resource: {
              type: "cloud_run_revision",
              labels: { service_name: name },
            },
            labels: { "aerpp-component": component },
            httpRequest: { status: 503 },
          },
        } as never,
        0,
      )
      expect(entry).toMatchObject({ service: component, statusCode: 503 })
      expect(JSON.stringify(entry)).not.toContain(name)
    }
  },
)
