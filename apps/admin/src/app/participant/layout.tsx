import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "参加者",
  description:
    "AERPPの研究参加者の参加状態、同意・撤回履歴、解析とアンケートの実施状況を確認できます。",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return <>{children}</>
}
