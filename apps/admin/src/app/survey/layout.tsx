import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "アンケート結果",
  description:
    "AERPPのアンケート回答と、初回・追加利用別の質問項目ごとの集計を確認できます。",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return <>{children}</>
}
