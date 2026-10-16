import { readFileSync } from "node:fs"
import path from "node:path"

const HAI_DEF_TERMS_URL =
  "https://developers.google.com/health-ai-developer-foundations/terms"
export default function ModelLicenseTerms({
  licenseLink,
}: {
  licenseLink: string
}) {
  if (licenseLink !== HAI_DEF_TERMS_URL) return null
  const documents = [
    [
      "Health AI Developer Foundations Terms of Use — 全文",
      readFileSync(
        path.join(process.cwd(), "generated/licenses/HAI-DEF-TERMS.txt"),
        "utf8",
      ),
    ],
    [
      "Health AI Developer Foundations Prohibited Use Policy — 全文",
      readFileSync(
        path.join(
          process.cwd(),
          "generated/licenses/HAI-DEF-PROHIBITED-USE.txt",
        ),
        "utf8",
      ),
    ],
  ]
  return documents.map(([title, text]) => (
    <details key={title}>
      <summary className="cursor-pointer font-semibold">{title}</summary>
      <pre className="mt-4 whitespace-pre-wrap wrap-break-word text-sm">
        {text}
      </pre>
    </details>
  ))
}
