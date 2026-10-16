const JAPAN_DATE_FORMATTER = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  dateStyle: "long",
})

export function formatDateInJapan(date: Date): string {
  return JAPAN_DATE_FORMATTER.format(date)
}
