import { readFileSync } from "node:fs"
import path from "node:path"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import ModelLicenseTerms from "./model-license-terms"

describe("model terms", () => {
  it("supplies the HAI-DEF terms and restrictions for the MedGemma preset", () => {
    const preset = JSON.parse(
      readFileSync(
        path.join(process.cwd(), "../../config/common/llm/lms-medgemma.json"),
        "utf8",
      ),
    )
    expect(preset.license.licenseName).toBe(
      "Health AI Developer Foundations Terms of Use",
    )
    const html = renderToStaticMarkup(
      <ModelLicenseTerms licenseLink={preset.license.link} />,
    )
    expect(html).toContain("3.1 Distribution and Redistribution")
    expect(html).toContain("Prohibited Use Policy")
    expect(html).toContain("3.2 Use Restrictions")
  })
  it("does not attribute HAI-DEF terms to unrelated configured models", () => {
    expect(
      renderToStaticMarkup(
        <ModelLicenseTerms licenseLink="https://example.invalid/other-license" />,
      ),
    ).toBe("")
  })
})
