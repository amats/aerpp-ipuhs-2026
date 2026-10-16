import { renderToString } from "react-dom/server"
import { expect, it, vi } from "vitest"
import DebugClientPanel from "./debug-client-panel"
import DebugHomeFlowPanel from "./debug-home-flow-panel"

vi.mock("@/features/app-context/app-context-provider", () => ({
  useAppContext: () => ({
    stage: "authenticated",
    rootStep: "result",
    stepState: { stage: "authenticated", step: "result" },
    analysisJob: null,
    result: null,
    surveyAnswer: {},
  }),
}))
vi.mock("@/features/message/message-context-provider", () => ({
  useMessageContext: () => ({
    statusMessage: null,
    dismissedInformationMessageIds: [],
  }),
}))

it.each([
  ["client", DebugClientPanel],
  ["home flow", DebugHomeFlowPanel],
] as const)(
  "renders %s on the server without accessing browser storage",
  (_name, Panel) => {
    expect(typeof window).toBe("undefined")
    expect(() => renderToString(<Panel />)).not.toThrow()
  },
)
