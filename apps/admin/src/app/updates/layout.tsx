import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "参加・回答履歴",
  description:
    "AERPPの研究参加への同意とアンケート回答に関する直近の更新を確認できます。",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return <>{children}</>
}
