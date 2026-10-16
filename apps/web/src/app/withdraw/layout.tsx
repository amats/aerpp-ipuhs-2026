import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "同意の撤回",
  description:
    "AERPPの研究参加について、登録済みメールアドレスを使って同意撤回の手続きを申請できます。",
}

export default function Layout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return <>{children}</>
}
