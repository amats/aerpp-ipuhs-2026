import type { Metadata, Viewport } from "next"
import AuthProvider from "@/features/auth/auth-provider"
import InformationDraftProvider from "@/features/information/information-draft-provider"
import "./globals.css"
import { uiClassName } from "@/ui/ui-styles"
import manifest from "./manifest.json"

export const metadata: Metadata = {
  applicationName: manifest.short_name,
  title: {
    default: manifest.short_name,
    template: `%s | ${manifest.short_name}`,
  },
  description: manifest.description,
}

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: manifest.theme_color },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ja">
      <body
        className={uiClassName(
          "mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-4 py-6 antialiased",
          "bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.95),rgba(241,245,249,0.94)_38%,rgba(226,232,240,0.92)_100%)]",
          "sm:px-6 sm:py-8 lg:gap-8 lg:px-8 lg:py-10",
          "dark:bg-[radial-gradient(circle_at_top_left,rgba(30,41,59,0.96),rgba(15,23,42,0.97)_45%,rgba(2,6,23,1)_100%)]",
        )}
      >
        <AuthProvider>
          <InformationDraftProvider>{children}</InformationDraftProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
