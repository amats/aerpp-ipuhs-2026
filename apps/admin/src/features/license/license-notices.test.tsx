import { readFileSync } from "node:fs"
import path from "node:path"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import LicenseNotices from "./license-notices"

describe("license notices", () => {
  it("renders root attribution, application dependencies and full bundled notices", () => {
    const html = renderToStaticMarkup(<LicenseNotices />)
    expect(html).toContain("第三者のライセンス・著作権表示")
    expect(html).toContain("Apache License")
    expect(html).toContain("SIL Open Font License")
    expect(html).toContain("Permission is hereby granted")
    expect(html).not.toContain("\r")
    const dependencies = JSON.parse(
      readFileSync(
        path.resolve(process.cwd(), "../../docs/licenses/npm-notices.json"),
        "utf8",
      ),
    ) as { name: string; applications: string[] }[]
    for (const item of dependencies.filter((item) =>
      item.applications.includes("admin"),
    )) {
      expect(html).toContain(item.name)
    }
  })
})
