import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@aerpp/config/server/admin", () => ({ env: {} }))

import { createLocalAuthClient } from "./google-auth"

describe("local Admin keyless authentication", () => {
  it.each(["test", "production"])(
    "binds %s tokens to the selected account and project",
    async (environment) => {
      const project = `synthetic-${environment}`
      const operator = `${environment}@example.invalid`
      const account = `aerpp-admin-local@${project}.iam.gserviceaccount.com`
      const request = vi.fn().mockResolvedValue("synthetic-token")
      const client = createLocalAuthClient(
        project,
        operator,
        account,
        "/synthetic/gcloud",
        request,
      )
      expect((await client.getAccessToken()).token).toBe("synthetic-token")
      expect(request).toHaveBeenCalledExactlyOnceWith(
        [
          "auth",
          "print-access-token",
          `--account=${operator}`,
          `--project=${project}`,
          `--impersonate-service-account=${account}`,
          "--quiet",
        ],
        expect.objectContaining({
          CLOUDSDK_CONFIG: "/synthetic/gcloud",
          CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE: "",
          CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT: "",
        }),
      )
      expect(
        request.mock.calls[0][1].GOOGLE_APPLICATION_CREDENTIALS,
      ).toBeFalsy()
      await client.getAccessToken()
      expect(request).toHaveBeenCalledTimes(1)
    },
  )

  it("rejects a reader from another project before invoking gcloud", () => {
    const request = vi.fn()
    expect(() =>
      createLocalAuthClient(
        "synthetic-test",
        "operator@example.invalid",
        "aerpp-admin-local@synthetic-production.iam.gserviceaccount.com",
        undefined,
        request,
      ),
    ).toThrow("Invalid selected local Admin identity")
    expect(request).not.toHaveBeenCalled()
  })

  it.each(["failed", "empty", "malformed"])(
    "sanitizes %s token responses",
    async (mode) => {
      const request =
        mode === "failed"
          ? vi.fn().mockRejectedValue(new Error("private-token-and-stderr"))
          : vi.fn().mockResolvedValue(mode === "empty" ? "" : "private token")
      const client = createLocalAuthClient(
        "synthetic-test",
        "operator@example.invalid",
        "aerpp-admin-local@synthetic-test.iam.gserviceaccount.com",
        undefined,
        request,
      )
      await expect(client.getAccessToken()).rejects.toThrow(
        "Local Admin authentication failed",
      )
      await expect(client.getAccessToken()).rejects.not.toThrow("private")
    },
  )
})
