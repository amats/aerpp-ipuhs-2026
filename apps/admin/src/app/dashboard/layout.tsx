import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "管理ダッシュボード",
  description:
    "AERPPの研究参加状況、解析の実施状況、アンケートの回答状況、お知らせと運用上の要対応事項を確認できます。",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return <>{children}</>
}
