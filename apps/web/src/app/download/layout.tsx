import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "同意履歴・関連書類",
  description:
    "同意・撤回の履歴と、その時点の書類や現在公開中の研究説明文書・研究計画書を確認できます。",
}

export default function Layout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return <>{children}</>
}
