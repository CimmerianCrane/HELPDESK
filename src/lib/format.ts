/**
 * Display formatting. Dates render as DD/MM/YYYY (CLAUDE.md rule 8) in the operating timezone, not
 * the server's — `en-GB` gives that order directly, so there is no hand-rolled padding to get wrong.
 */
export function formatDate(value: Date | null | undefined, timeZone: string): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(value)
}

/**
 * A span of milliseconds as something a person reads at a glance: "2d 4h", "3h 05m", "12m".
 *
 * Used for SLA countdowns and age-of-ticket, where the exact second is noise. Negative input is
 * formatted by absolute value — the caller says "overdue" or "remaining" around it.
 */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(Math.abs(ms) / 60_000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const remainder = minutes % 60

  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0) return remainder > 0 ? `${hours}h ${String(remainder).padStart(2, '0')}m` : `${hours}h`
  return `${minutes}m`
}

export function formatDateTime(value: Date | null | undefined, timeZone: string): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(value)
}
