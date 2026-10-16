import { expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { deriveRecoveryPseudonym } from "./recovery-pseudonym"

it("matches the stable Web PID vector and preserves literal secret bytes", () => {
  expect(
    deriveRecoveryPseudonym(
      " PERSON@EXAMPLE.INVALID ",
      "synthetic-identifier-secret",
    ),
  ).toBe("aerpp:pid-adc0246ab71baf83eed95b5d77a4e689")
  expect(
    deriveRecoveryPseudonym(
      "person@example.invalid",
      " synthetic-identifier-secret ",
    ),
  ).toBe("aerpp:pid-8b37943850e629626c8ff744662e203b")
  expect(
    deriveRecoveryPseudonym(
      "ＰＥＲＳＯＮ@example.invalid",
      "synthetic-identifier-secret",
    ),
  ).toBe("aerpp:pid-adc0246ab71baf83eed95b5d77a4e689")
})
