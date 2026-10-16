import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "運用状況",
  description:
    "AERPPの利用状況、要対応事項、定期メンテナンスと運用イベントを期間別に確認できます。",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return <>{children}</>
}
