import { Children, isValidElement, type ReactNode } from "react"
import { beforeEach, expect, it, vi } from "vitest"
import AppHeaderActions from "./app-header-actions"

const mocks = vi.hoisted(() => ({
  confirmDiscard: vi.fn(),
  resetDraft: vi.fn(),
  signOut: vi.fn(),
}))
vi.mock("next-auth/react", () => ({ signOut: mocks.signOut }))
vi.mock("@/features/information/information-draft-provider", () => ({
  useInformationDraft: () => mocks,
}))

beforeEach(() => vi.resetAllMocks())

it.each([false, true])(
  "signs out only after draft discard is accepted (%s)",
  async (accepted) => {
    mocks.confirmDiscard.mockReturnValue(accepted)
    const element = AppHeaderActions({
      email: "admin@example.invalid",
      adminAuthBypassEnabled: false,
    })
    const button = Children.toArray(element.props.children).find(
      (child) =>
        isValidElement<{ children: ReactNode }>(child) &&
        child.props.children === "サインアウト",
    )
    if (!isValidElement<{ onClick: () => void }>(button))
      throw new Error("Sign-out button missing")
    button.props.onClick()
    expect(mocks.resetDraft).toHaveBeenCalledTimes(accepted ? 1 : 0)
    if (accepted)
      expect(mocks.signOut).toHaveBeenCalledWith({ callbackUrl: "/" })
    else expect(mocks.signOut).not.toHaveBeenCalled()
  },
)
