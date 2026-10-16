import type { Metadata } from "next"
export const metadata: Metadata = {
  title: "お知らせ管理",
  description: "AERPPの研究参加者向けのお知らせを作成・編集・削除できます。",
}
export default function InformationLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
