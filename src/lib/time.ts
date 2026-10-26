/**
 * Wall-clock time in the operating timezone.
 *
 * Timestamps are stored in UTC (CLAUDE.md rule 8), but people type and read wall times: "Tuesday",
 * "08:30", "the week of the 26th". The gap between the two is where scheduling bugs live, so the
 * conversion is in one place and tested against a zone with daylight saving.
 *
 * Deliberately no date library. `Intl` already knows every zone rule, and the arithmetic here is
 * short enough to read; a dependency would add a second opinion about what a day is.
 */

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone)
  if (cached) return cached
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  formatters.set(timeZone, formatter)
  return formatter
}

export function zonedParts(
  instant: Date,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const values: Record<string, number> = {}
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    if (part.type !== 'literal') values[part.type] = Number(part.value)
  }
  return {
    year: values.year ?? 0,
    month: values.month ?? 1,
    day: values.day ?? 1,
    hour: values.hour ?? 0,
    minute: values.minute ?? 0,
    second: values.second ?? 0,
  }
}

/** How far ahead of UTC `timeZone` is at a given instant, in milliseconds. */
function offsetMs(instant: number, timeZone: string): number {
  const p = zonedParts(new Date(instant), timeZone)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - instant
}

/**
 * The instant at which a wall clock in `timeZone` reads `y-m-d hh:mm`.
 *
 * Two passes: guess by treating the wall time as UTC, correct by the offset at that guess, then
 * correct again by the offset at the corrected instant. The second pass is what makes a wall time
 * either side of a daylight-saving change land on the right side of it.
 *
 * A wall time that does not exist (the hour a clock skips forward) resolves to the instant the clock
 * jumps to, which is the only sensible answer and is what people expect when they type 02:30 on the
 * night the clocks go forward.
 */
export function wallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute)
  const firstOffset = offsetMs(guess, timeZone)
  const secondOffset = offsetMs(guess - firstOffset, timeZone)
  return new Date(guess - secondOffset)
}

/** `YYYY-MM-DD` for the day an instant falls on, in `timeZone`. */
export function dayKey(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/

/** Is this a well-formed `datetime-local` value? Shape only — no timezone involved. */
export function isLocalDateTime(value: string): boolean {
  const match = WALL_CLOCK.exec(value.trim())
  if (!match) return false
  const [year, month, day, hour, minute] = match.slice(1, 6).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ]
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  if (hour > 23 || minute > 59) return false
  // Reject 31 February and friends rather than silently rolling them into March.
  const probe = new Date(Date.UTC(year, month - 1, day, hour, minute))
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  )
}

/**
 * A `datetime-local` string read as wall time in `timeZone`.
 *
 * The mirror of `utcToLocalInput`, and the pair matters: the browser carries no zone, so a value
 * shown as "08:30 Singapore" has to come back as 08:30 Singapore. Reading it as UTC instead would
 * move every visit by the zone offset with nothing looking broken.
 */
export function localWallToUtc(value: string, timeZone: string): Date {
  const match = WALL_CLOCK.exec(value.trim())
  if (!match) throw new Error(`Not a local date and time: ${value}`)
  return wallTimeToUtc(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    timeZone,
  )
}

/** An instant as the `datetime-local` value that shows it in `timeZone`. */
export function utcToLocalInput(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone)
  const two = (value: number) => String(value).padStart(2, '0')
  return `${p.year}-${two(p.month)}-${two(p.day)}T${two(p.hour)}:${two(p.minute)}`
}

/** Adds whole days to a `YYYY-MM-DD` carrier. Safe because the carrier is never a local instant. */
export function addDays(day: Date, days: number): Date {
  return new Date(day.getTime() + days * 86_400_000)
}
