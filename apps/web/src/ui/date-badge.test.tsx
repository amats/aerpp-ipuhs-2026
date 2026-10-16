import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"
import DateBadge from "./date-badge"

it.each([
  ["2026-09-13T14:59:59.000Z", "2026年9月13日"],
  ["2026-09-13T15:00:00.000Z", "2026年9月14日"],
])("shows the Japan calendar date for %s", (timestamp, expected) => {
  expect(
    renderToStaticMarkup(<DateBadge date={new Date(timestamp)} />),
  ).toContain(expected)
})
