"use client"

import { usePathname } from "next/navigation"
import { type ReactNode, useEffect, useRef } from "react"
import MainContentLayout from "@/ui/main-content-layout"

// Client boundary that moves focus into route content after ordinary navigation.
export default function RouteFocusBoundary({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  const pathname = usePathname()
  const previousPathRef = useRef(pathname)
  const historyPathRef = useRef<string | null>(null)
  const mainRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const handlePopState = () => {
      historyPathRef.current =
        window.location.pathname === previousPathRef.current
          ? null
          : window.location.pathname
    }
    window.addEventListener("popstate", handlePopState, true)
    return () => window.removeEventListener("popstate", handlePopState, true)
  }, [])

  useEffect(() => {
    if (previousPathRef.current === pathname) return
    previousPathRef.current = pathname
    const fromHistory = historyPathRef.current === pathname
    historyPathRef.current = null
    // Leave history scroll restoration and explicit fragment targets to the router.
    if (fromHistory || window.location.hash) return

    const main = mainRef.current
    if (!main) return
    let frame: number | null = null
    const scheduleFocus = () => {
      if (frame !== null) return
      frame = window.requestAnimationFrame(() => {
        frame = null
        const heading = Array.from(
          main.querySelectorAll<HTMLHeadingElement>("h2[tabindex]"),
        ).find((element) => element.getClientRects().length > 0)
        if (!heading) return
        observer.disconnect()
        heading.focus({ preventScroll: true })
        heading.scrollIntoView({ behavior: "instant", block: "center" })
      })
    }
    // A streamed or cached route may reveal its heading after the pathname commits.
    const observer = new MutationObserver(scheduleFocus)
    observer.observe(main, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "hidden"],
    })
    scheduleFocus()
    return () => {
      observer.disconnect()
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
  }, [pathname])

  return (
    <MainContentLayout ref={mainRef} className={className}>
      {children}
    </MainContentLayout>
  )
}
