import { expect, it } from "vitest"
import { formatInformationTime, parseInformationTime } from "./information-time"

it.each([
  ["2030-01-01T00:00", "Asia/Tokyo", "2029-12-31T15:00:00.000Z"],
  ["2030-01-01T12:00:12.345", "Asia/Kathmandu", "2030-01-01T06:15:12.345Z"],
  ["2030-07-01T12:00", "America/New_York", "2030-07-01T16:00:00.000Z"],
  ["2030-01-01T12:00", "America/New_York", "2030-01-01T17:00:00.000Z"],
  ["2030-01-01T12:00", "UTC", "2030-01-01T12:00:00.000Z"],
  ["0001-01-01T00:00", "UTC", "0001-01-01T00:00:00.000Z"],
  ["9999-12-31T23:59:59.999", "UTC", "9999-12-31T23:59:59.999Z"],
])("converts %s in %s to UTC", (local, zone, iso) => {
  expect(parseInformationTime(local, zone)).toEqual({ ok: true, iso })
  expect(formatInformationTime(iso, zone)).toBe(
    new Date(`${local}Z`).toISOString().slice(0, -1),
  )
})

it.each([
  ["", "UTC"],
  ["2030-02-30T12:00", "UTC"],
  ["2030-01-01T24:00", "UTC"],
  ["0000-01-01T00:00", "UTC"],
  ["2030-01-01T12:00", "invalid/zone"],
  ["2030-03-10T02:30", "America/New_York"],
  ["2030-11-03T01:30", "America/New_York"],
  ["2030-04-07T01:45", "Australia/Lord_Howe"],
  ["2011-12-30T12:00", "Pacific/Apia"],
])("rejects invalid or non-unique input %s in %s", (local, zone) => {
  expect(parseInformationTime(local, zone).ok).toBe(false)
})
