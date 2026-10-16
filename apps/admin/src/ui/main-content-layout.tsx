import type { ReactNode, Ref } from "react"

export default function MainContentLayout({
  children,
  className,
  ref,
}: {
  children: ReactNode
  className?: string
  ref?: Ref<HTMLElement>
}) {
  const baseClass = "mx-auto flex min-w-0 w-full flex-col gap-6 lg:gap-8"
  const composedClass = className ? `${baseClass} ${className}` : baseClass

  return (
    <main
      ref={ref}
      className="flex min-w-0 flex-1 items-stretch justify-center"
    >
      <div className={composedClass}>{children}</div>
    </main>
  )
}
