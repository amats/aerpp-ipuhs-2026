function formatter(timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    calendar: "iso8601",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
    hourCycle: "h23",
  })
}

function localValue(date: Date, format: Intl.DateTimeFormat) {
  const parts = Object.fromEntries(
    format.formatToParts(date).map(({ type, value }) => [type, value]),
  )
  return `${parts.year.padStart(4, "0")}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${parts.fractionalSecond}`
}

export function formatInformationTime(iso: string, timeZone: string) {
  return localValue(new Date(iso), formatter(timeZone))
}

export function parseInformationTime(value: string, timeZone: string) {
  let format: Intl.DateTimeFormat
  try {
    format = formatter(timeZone)
  } catch {
    return {
      ok: false,
      message: "タイムゾーンを確認してください（例: Asia/Tokyo）。",
    } as const
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/.test(value))
    return { ok: false, message: "有効期限を確認してください。" } as const
  const wall = new Date(`${value}Z`)
  if (
    !Number.isFinite(wall.getTime()) ||
    wall.getUTCFullYear() < 1 ||
    !wall.toISOString().startsWith(value)
  )
    return { ok: false, message: "有効期限を確認してください。" } as const

  // Sample both sides of nearby offset transitions, then round-trip each candidate.
  const offsets = new Set<number>()
  for (let hours = -48; hours <= 48; hours += 6) {
    const sample = new Date(wall.getTime() + hours * 3_600_000)
    offsets.add(
      new Date(`${localValue(sample, format)}Z`).getTime() - sample.getTime(),
    )
  }
  const matches = [...offsets]
    .map((offset) => new Date(wall.getTime() - offset))
    .filter(
      (date) =>
        date.getUTCFullYear() >= 1 &&
        date.getUTCFullYear() <= 9999 &&
        localValue(date, format) === wall.toISOString().slice(0, -1),
    )
  if (matches.length !== 1)
    return {
      ok: false,
      message:
        matches.length > 1
          ? "夏時間の切り替えにより二通りの時刻があります。UTC を指定して入力してください。"
          : "指定した地域に存在しない日時、または保存可能な範囲外です。有効期限を確認してください。",
    } as const
  return { ok: true, iso: matches[0].toISOString() } as const
}
