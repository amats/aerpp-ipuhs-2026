import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("@aerpp/config/server/web", () => ({
  env: {
    debugPagesEnabled: true,
    listParticipationEventsUrl: "https://example.com/consent",
    logLevel: "info",
    nodeEnv: "development",
    identifierHashSecret: "server-key",
    sendMagicLinkUrl:
      "https://synthetic-user:synthetic-password@example.com/magic-link?token=synthetic-token#synthetic-fragment",
    recordAnalysisCompletionUrl: "https://example.com/survey-metadata",
    submitSurveyUrl: "https://example.com/survey",
    verifyAuthenticationUrl: "https://example.com/verify",
    withdrawParticipationUrl: "https://example.com/withdraw",
  },
}))

vi.mock("@/lib/session", () => ({
  getSession: vi.fn(async () => ({
    clientId: "client-1",
    email: "researcher@example.com",
    pseudonym: "pseudo-1",
    stage: "authenticated",
    rootStep: "document",
    questionnaireKind: "initial",
  })),
}))

vi.mock("@/features/auth/auth-service", () => ({
  listParticipationEvents: vi.fn(async () => [
    {
      clientId: "client-1",
      eventAt: new Date("2026-03-25T00:00:00.000Z"),
      encryptedEmail: "encrypted",
      eventType: "consent",
      pseudonym: "pseudo-1",
      serverId: "server-1",
    },
  ]),
}))

vi.mock("@/features/app-context/step-state-session", () => ({
  readStageFromSession: vi.fn((session) => session.stage ?? "unauthenticated"),
  readStepStateFromSession: vi.fn(async (session) => ({
    stage: session.stage,
    step: session.rootStep,
  })),
}))

vi.mock("@/features/identity/participant-identifiers", () => ({
  readClientIdFromSession: vi.fn(async () => "client-1"),
  readPseudonymFromSession: vi.fn(async () => "pseudo-1"),
}))

vi.mock("@/features/debug/debug-client-panel", () => ({
  default: () => <div>client-debug-panel</div>,
}))

vi.mock("@/features/debug/debug-refresh-button", () => ({
  default: () => <div>refresh-button</div>,
}))

vi.mock("@/features/app-shell/app-shell", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

vi.mock("@/ui/card-section", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
}))

vi.mock("@/ui/card-panel", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
}))

vi.mock("@/ui/section-heading", () => ({
  default: ({ title }: { title?: string }) => <div>{title}</div>,
}))

describe("DebugPage", () => {
  it("renders the debug snapshots when enabled", async () => {
    const { default: DebugPage } = await import("./page")
    const markup = renderToStaticMarkup(await DebugPage())

    expect(markup).toContain("Runtime debug snapshot")
    expect(markup).toContain("refresh-button")
    expect(markup).toContain(
      "&quot;questionnaireKind&quot;: &quot;initial&quot;",
    )
    expect(markup).not.toContain("surveyCount")
    expect(markup).not.toContain("&quot;clientId&quot;")
    expect(markup).not.toContain("&quot;pseudonym&quot;")
    expect(markup).not.toContain("encrypted")
    expect(markup).not.toContain("researcher@example.com")
    expect(markup).not.toContain("synthetic-user")
    expect(markup).not.toContain("synthetic-password")
    expect(markup).not.toContain("synthetic-token")
    expect(markup).not.toContain("synthetic-fragment")
    expect(markup).toContain("https://example.com/magic-link")
    expect(markup).not.toContain("&quot;email&quot;")
    expect(markup).not.toContain("&quot;affiliation&quot;")
    expect(markup).not.toContain("&quot;participantType&quot;")
    expect(markup).not.toContain("&quot;reviewStatus&quot;")
    expect(markup).toContain(
      "&quot;recordAnalysisCompletionUrl&quot;: &quot;https://example.com/survey-metadata&quot;",
    )
    expect(markup).toContain("&quot;sessionError&quot;: null")
    expect(markup).toContain("Consent records")
    expect(markup).toContain("&quot;eventType&quot;: &quot;consent&quot;")
    expect(markup).toContain("client-debug-panel")
  })

  it("renders a snapshot even when session loading fails", async () => {
    vi.resetModules()
    vi.doMock("@aerpp/config/server/web", () => ({
      env: {
        debugPagesEnabled: true,
        nodeEnv: "development",
        listParticipationEventsUrl: "https://example.com/consent",
        logLevel: "info",
        identifierHashSecret: "server-key",
        sendMagicLinkUrl: "https://example.com/magic-link",
        recordAnalysisCompletionUrl: "https://example.com/survey-metadata",
        submitSurveyUrl: "https://example.com/survey",
        verifyAuthenticationUrl: "https://example.com/verify",
        withdrawParticipationUrl: "https://example.com/withdraw",
      },
    }))
    vi.doMock("@/lib/session", () => ({
      getSession: vi.fn(async () => {
        throw new Error("Failed to get session")
      }),
    }))
    vi.doMock("@/features/auth/auth-service", () => ({
      listParticipationEvents: vi.fn(async () => []),
    }))
    vi.doMock("@/features/app-context/step-state-session", () => ({
      readStageFromSession: vi.fn(
        (session) => session.stage ?? "unauthenticated",
      ),
    }))
    vi.doMock("@/features/identity/participant-identifiers", () => ({
      readClientIdFromSession: vi.fn(async () => null),
      readPseudonymFromSession: vi.fn(async () => null),
    }))
    vi.doMock("@/features/survey/survey-service", () => ({}))
    vi.doMock("@/features/debug/debug-client-panel", () => ({
      default: () => <div>client-debug-panel</div>,
    }))
    vi.doMock("@/features/debug/debug-refresh-button", () => ({
      default: () => <div>refresh-button</div>,
    }))
    vi.doMock("@/features/app-shell/app-shell", () => ({
      default: ({ children }: { children: React.ReactNode }) => (
        <div>{children}</div>
      ),
    }))
    vi.doMock("@/ui/card-section", () => ({
      default: ({ children }: { children: React.ReactNode }) => (
        <section>{children}</section>
      ),
    }))
    vi.doMock("@/ui/card-panel", () => ({
      default: ({ children }: { children: React.ReactNode }) => (
        <section>{children}</section>
      ),
    }))
    vi.doMock("@/ui/section-heading", () => ({
      default: ({ title }: { title?: string }) => <div>{title}</div>,
    }))

    const { default: DebugPage } = await import("./page")
    const markup = renderToStaticMarkup(await DebugPage())

    expect(markup).toContain("&quot;sessionError&quot;: &quot;Error&quot;")
    expect(markup).toContain("&quot;participation&quot;: null")
  })

  it("rejects a disabled snapshot before reading session or participant data", async () => {
    vi.resetModules()
    vi.doMock("@aerpp/config/server/web", () => ({
      env: { debugPagesEnabled: false },
    }))
    const { getSession } = await import("@/lib/session")
    vi.mocked(getSession).mockClear()
    const { default: Page } = await import("./page")
    await expect(Page()).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404")
    expect(getSession).not.toHaveBeenCalled()
  })
})
