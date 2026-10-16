"use client"

import Link from "next/link"

export default function AdminRecoveryControl() {
  return (
    <details className="min-w-0 border-t border-slate-200/80 pt-2 dark:border-white/10">
      <summary className="min-h-11 w-fit cursor-pointer content-center rounded-lg px-2 py-2 text-xs text-slate-600 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--brand-blue) dark:text-slate-300">
        研究責任者に復旧を依頼した方へ
      </summary>
      <div className="grid justify-items-start gap-3 px-2 pb-2 pt-1 text-sm leading-relaxed">
        <p>
          研究責任者から復旧の案内を受けた方は、復旧許可を確認し、同じメールアドレスで同意・再認証してください。
        </p>
        <Link
          href="/recovery"
          className="underline"
          onClick={(event) => {
            // A new document releases any queued Server Actions and re-admits the current hash.
            event.preventDefault()
            window.location.assign("/recovery")
          }}
        >
          研究責任者の復旧許可を適用
        </Link>
      </div>
    </details>
  )
}
