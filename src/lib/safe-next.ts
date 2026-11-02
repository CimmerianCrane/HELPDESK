/**
 * Where to go after signing in. Only same-origin absolute paths are accepted: `//evil.com` and
 * `//evil.com` with a backslash both pass a naive `startsWith('/')` check and would make this an
 * open redirect.
 *
 * In `src/lib` rather than beside the action because a `'use server'` module may only export async
 * actions — and the login *page* needs the same rule, so one copy is the only way the two cannot
 * drift apart.
 */
export function safeNext(value: FormDataEntryValue | string | null | undefined, fallback: string): string {
  const raw = typeof value === 'string' ? value : ''
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback
  return raw
}
