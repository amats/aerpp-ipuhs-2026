import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "ライセンス",
  description:
    "AERPP本体、利用している依存ライブラリ、ローカル推論モデルのライセンス情報を確認できます。",
}

export default function Layout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return <>{children}</>
}
