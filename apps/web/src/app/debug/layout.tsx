import { env } from "@aerpp/config/server/web"
import type { Metadata } from "next"
import { notFound } from "next/navigation"

export const metadata: Metadata = {
  title: "Debug",
  description: "AERPPの開発・検証用デバッグ情報を確認するためのページです。",
}

export default function DebugLayout({
  children,
}: {
  children: React.ReactNode
}) {
  if (env.debugPagesEnabled !== true) notFound()
  return children
}
