import { beforeEach, describe, expect, it, vi } from "vitest"

const { environment, construct } = vi.hoisted(() => ({
  environment: {} as Record<string, string>,
  construct: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@aerpp/config/server/admin", () => ({ env: environment }))
vi.mock("@google-cloud/firestore", () => ({
  Firestore: class {
    constructor(settings: unknown) {
      construct(settings)
    }
  },
}))

describe("Admin Firestore credential selection", () => {
  beforeEach(() => {
    vi.resetModules()
    construct.mockClear()
    for (const key of Object.keys(environment)) delete environment[key]
  })

  it("uses the selected project and runtime ADC without supplying keys", async () => {
    environment.gcpProjectId = "synthetic-test"
    await import("./firestore")
    expect(construct).toHaveBeenCalledExactlyOnceWith({
      projectId: "synthetic-test",
    })
  })

  it("uses the selected keyless local reader", async () => {
    Object.assign(environment, {
      gcpProjectId: "synthetic-test",
      localGoogleAccount: "operator@example.invalid",
      localServiceAccount:
        "aerpp-admin-local@synthetic-test.iam.gserviceaccount.com",
    })
    await import("./firestore")
    expect(construct).toHaveBeenCalledExactlyOnceWith({
      projectId: "synthetic-test",
      authClient: expect.objectContaining({
        refreshHandler: expect.any(Function),
      }),
    })
  })
})
