/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import LikertRadioFieldset from "./likert-radio-fieldset"

const options = ["1", "2", "3", "4", "5", "6", "7"] as const

describe("LikertRadioFieldset", () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    document.body.innerHTML = ""
  })

  it("marks only the selected option as checked", async () => {
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <LikertRadioFieldset
          name="score"
          legend="Score"
          value="4"
          onChange={vi.fn()}
          options={options}
        />,
      )
    })

    const checkedInput = container.querySelector(
      'input[type="radio"][value="4"]',
    ) as HTMLInputElement
    const uncheckedInput = container.querySelector(
      'input[type="radio"][value="3"]',
    ) as HTMLInputElement

    expect(checkedInput.checked).toBe(true)
    expect(uncheckedInput.checked).toBe(false)
  })

  it("applies required only to the first radio input", async () => {
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <LikertRadioFieldset
          name="score"
          legend="Score"
          value=""
          onChange={vi.fn()}
          options={options}
          required
          onClear={vi.fn()}
        />,
      )
    })

    const inputs = Array.from(
      container.querySelectorAll('input[type="radio"]'),
    ) as HTMLInputElement[]

    expect(container.querySelector("button")?.disabled).toBe(true)
    expect(inputs.at(0)?.required).toBe(true)
    expect(inputs.slice(1).every((input) => input.required === false)).toBe(
      true,
    )
  })
})
