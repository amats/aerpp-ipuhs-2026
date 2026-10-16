import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, expect, it, vi } from "vitest"
import CloudConsoleLinks from "./cloud-console-links"

const { env } = vi.hoisted(() => ({
  env: {
    environment: "test",
    gcpProjectId: "synthetic-test" as string | undefined,
  },
}))
vi.mock("@aerpp/config/server/admin", () => ({ env }))
beforeEach(() => {
  env.environment = "test"
  env.gcpProjectId = "synthetic-test"
})

it.each(["test", "production"])(
  "binds every Console link to the %s environment project",
  (environment) => {
    env.environment = environment
    env.gcpProjectId = `synthetic-${environment}`
    const html = renderToStaticMarkup(<CloudConsoleLinks />)
    const links = [...html.matchAll(/href="([^"]+)"/g)].map(
      (match) => new URL(match[1]),
    )
    expect(links).toHaveLength(9)
    for (const link of links) {
      expect(link.origin).toBe("https://console.cloud.google.com")
      expect(link.searchParams.get("project")).toBe(env.gcpProjectId)
    }
    expect(html.match(/target="_blank"/g)).toHaveLength(9)
    expect(html.match(/rel="noopener noreferrer"/g)).toHaveLength(9)
  },
)

it.each(["local", "example"])(
  "does not link synthetic %s projects to the Console",
  (environment) => {
    env.environment = environment
    expect(renderToStaticMarkup(<CloudConsoleLinks />)).not.toContain("href=")
  },
)

it("does not fall back to an arbitrary Console project when project settings are absent", () => {
  env.gcpProjectId = undefined
  expect(renderToStaticMarkup(<CloudConsoleLinks />)).not.toContain("href=")
})
