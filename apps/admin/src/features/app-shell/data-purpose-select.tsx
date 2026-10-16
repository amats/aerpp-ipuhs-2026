"use client"

import {
  DATA_PURPOSE_LABELS,
  type DataPurposeFilter,
} from "@aerpp/firestore/data-purpose-types"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { startTransition, useId } from "react"

export default function DataPurposeSelect({
  selected,
}: {
  selected: DataPurposeFilter
}) {
  const id = useId()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  return (
    <div className="flex items-center gap-3 text-sm">
      <label htmlFor={id}>データ区分</label>
      <select
        id={id}
        value={selected}
        className="min-h-11 rounded-lg border bg-white px-3 py-2 text-slate-900"
        onChange={(event) => {
          const params = new URLSearchParams(searchParams.toString())
          params.delete("serverId")
          params.set("dataPurpose", event.currentTarget.value)
          startTransition(() => router.push(`${pathname}?${params.toString()}`))
        }}
      >
        {Object.entries(DATA_PURPOSE_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </div>
  )
}
