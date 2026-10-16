import { readFileSync } from "node:fs"
import path from "node:path"
import CardSection from "@/ui/card-section"
import SectionHeading from "@/ui/section-heading"

type DependencyNotice = {
  name: string
  sourceUrl?: string
  author: string
  version: string
  license: string
  applications: string[]
  notices: { file: string; text: string }[]
}

const DEPENDENCY_GROUPS = [
  { label: "A–F", initial: /^[a-f]/i },
  { label: "G–L", initial: /^[g-l]/i },
  { label: "M–R", initial: /^[m-r]/i },
  { label: "S–Z", initial: /^[s-z]/i },
  { label: "数字・その他", initial: /^[^a-z]/i },
]

export default function LicenseNotices() {
  const dependencies = (
    JSON.parse(
      readFileSync(
        path.join(process.cwd(), "generated/licenses/dependencies.json"),
        "utf8",
      ),
    ) as DependencyNotice[]
  ).filter((entry) => entry.applications.includes("admin"))
  const groups = DEPENDENCY_GROUPS.map(({ label, initial }) => ({
    label,
    entries: dependencies.filter(({ name }) =>
      initial.test(name.replace(/^@/, "")),
    ),
  })).filter(({ entries }) => entries.length > 0)
  const documents = [
    [
      "Noto Sans JP — SIL Open Font License 1.1",
      readFileSync(
        path.join(process.cwd(), "generated/licenses/OFL-1.1.txt"),
        "utf8",
      ),
    ],
    [
      "通知・帰属情報",
      readFileSync(
        path.join(process.cwd(), "generated/licenses/NOTICE"),
        "utf8",
      ),
    ],
    [
      "Apache License 2.0",
      readFileSync(
        path.join(process.cwd(), "generated/licenses/APACHE-2.0.txt"),
        "utf8",
      ),
    ],
  ]
  return (
    <CardSection>
      <SectionHeading
        title="第三者のライセンス・著作権表示"
        titleId="third-party-license-title"
        description="利用しているライブラリと同梱素材の通知・利用条件です。各項目を開いて本文をご確認いただけます。"
      />
      {documents.map(([title, text]) => (
        <details
          key={title}
          className="rounded-xl border border-slate-300 p-4 dark:border-slate-700"
        >
          <summary className="min-h-11 cursor-pointer rounded py-3 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2">
            {title}
          </summary>
          <pre className="mt-4 whitespace-pre-wrap wrap-break-word text-sm">
            {text.replace(/\r\n?/g, "\n")}
          </pre>
        </details>
      ))}
      <p className="text-sm">
        依存ライブラリは名前順にまとめています。@で始まる名前は、@の次の文字で分類しています。
      </p>
      {groups.map(({ label, entries }) => (
        <details
          key={label}
          className="min-w-0 rounded-xl border border-slate-300 p-4 dark:border-slate-700"
        >
          <summary className="min-h-11 cursor-pointer rounded py-3 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2">
            {label}（{entries.length}件）
          </summary>
          <div className="mt-3 grid min-w-0 gap-3">
            {entries.map(
              ({ name, version, license, author, sourceUrl, notices }) => (
                <details
                  key={`${name}@${version}`}
                  className="rounded-xl border border-slate-300 p-4 dark:border-slate-700"
                >
                  <summary className="min-h-11 cursor-pointer rounded py-3 wrap-anywhere font-semibold focus-visible:outline-2 focus-visible:outline-offset-2">
                    {name}@{version} — {license}
                  </summary>
                  {sourceUrl && (
                    <a
                      href={sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-4 block text-sm underline"
                    >
                      配布元・ソースコード
                    </a>
                  )}
                  {author && <p className="mt-4 text-sm">{author}</p>}
                  {notices.length === 0 ? (
                    <p className="mt-4 text-sm">
                      ライセンス本文の確認が未完了です。
                    </p>
                  ) : (
                    notices.map(({ file, text }) => (
                      <pre
                        key={file}
                        className="mt-4 whitespace-pre-wrap wrap-break-word text-sm"
                      >
                        {text.replace(/\r\n?/g, "\n")}
                      </pre>
                    ))
                  )}
                </details>
              ),
            )}
          </div>
        </details>
      ))}
    </CardSection>
  )
}
