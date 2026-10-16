import { beforeEach, describe, expect, it, vi } from "vitest"

const services = vi.hoisted(() => ({
  loadConsentPdf: vi.fn(),
  loadExplanationPdf: vi.fn(),
  loadPlanPdf: vi.fn(),
  loadWithdrawalPdf: vi.fn(),
  listDocumentHistory: vi.fn(),
  loadHistoricalDocument: vi.fn(),
}))
vi.mock("./pdf-download-service", () => services)
vi.mock("./document-history-service", () => services)

import { handleDocumentRead } from "./document-route"

const pdf = { ok: true, contentBase64: "AQID", filename: "receipt.pdf" }
function request(query: string, token?: string) {
  return new Request(`http://localhost/api/documents?${query}`, {
    headers: {
      "x-request-id": "document-test",
      ...(token ? { "x-aerpp-tab": token } : {}),
    },
  })
}

describe("document read route", () => {
  beforeEach(() => {
    for (const service of Object.values(services))
      service.mockReset().mockResolvedValue(pdf)
  })

  it.each([
    ["explanation", "loadExplanationPdf"],
    ["plan", "loadPlanPdf"],
    ["consent", "loadConsentPdf"],
    ["withdrawal", "loadWithdrawalPdf"],
  ] as const)(
    "retains session validation in the %s service",
    async (name, service) => {
      const response = await handleDocumentRead(
        request(`name=${name}`, "sealed-tab"),
      )
      expect(response.status).toBe(200)
      expect(response.headers.get("cache-control")).toBe("private, no-store")
      expect(response.headers.get("x-request-id")).toBe("document-test")
      expect(await response.json()).toEqual(pdf)
      expect(services[service]).toHaveBeenCalledWith("sealed-tab")
    },
  )

  it("uses owned history selection and preserves read authorization failure", async () => {
    await handleDocumentRead(
      request("name=consent&recordId=record-a", "sealed-tab"),
    )
    expect(services.loadHistoricalDocument).toHaveBeenCalledWith(
      "record-a",
      "consent",
      "sealed-tab",
    )
    expect(services.loadConsentPdf).not.toHaveBeenCalled()
    services.listDocumentHistory.mockResolvedValue({
      ok: false,
      reason: "session_invalid",
    })
    const response = await handleDocumentRead(request("name=history"))
    expect(await response.json()).toEqual({
      ok: false,
      reason: "session_invalid",
    })
    expect(services.listDocumentHistory).toHaveBeenCalledWith(undefined)
  })

  it.each([
    "",
    "name=unknown",
    "name=consent&email=other",
    "name=history&recordId=x",
    "name=consent&name=plan",
    "name=consent&recordId=",
  ])("rejects invalid selection before reading: %s", async (query) => {
    const response = await handleDocumentRead(request(query))
    expect(response.status).toBe(400)
    expect(response.headers.get("x-request-id")).toBe("document-test")
    for (const service of Object.values(services))
      expect(service).not.toHaveBeenCalled()
  })

  it("returns a bounded safe failure when a service throws", async () => {
    services.loadConsentPdf.mockRejectedValue(
      new Error("synthetic private upstream failure"),
    )
    const response = await handleDocumentRead(
      request("name=consent", "sealed-tab"),
    )
    expect(response.status).toBe(503)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(await response.text()).not.toContain("synthetic private")
  })
})
