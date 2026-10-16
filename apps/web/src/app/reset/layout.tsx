import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "保存データの初期化",
  description:
    "AERPPのセッションとブラウザー内の一時データを初期化します。登録済みの参加データや送信済みアンケートは削除されません。",
}

export default function Layout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return <>{children}</>
}
