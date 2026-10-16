import CardPanel from "@/ui/card-panel"

export default function DebugSnapshotPanel({
  title,
  snapshot,
}: {
  title: string
  snapshot: unknown
}) {
  return (
    <CardPanel className="p-5">
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          {title}
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          `AppContext` と関連する ブラウザー保存領域 の現在値です。
        </p>
      </div>
      <section
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to focus this region to scroll the snapshot.
        tabIndex={0}
        aria-label={title}
        className="mt-4 overflow-x-auto rounded-xl bg-slate-950/95 p-4 text-xs leading-relaxed text-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--brand-blue)"
      >
        <pre>{JSON.stringify(snapshot, null, 2)}</pre>
      </section>
    </CardPanel>
  )
}
