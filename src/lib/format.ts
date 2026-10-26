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
