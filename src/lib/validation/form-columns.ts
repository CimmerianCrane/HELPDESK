/**
 * A repeated form field, read as a column of values.
 *
 * A line editor renders the same input name once per row, so `formValues` hands the action back
 * `string | string[]` — and a single line arrives as a bare string. Every action that turns those
 * back into rows needs this exact three lines; keeping it here is what stops the quote and invoice
 * line editors drifting apart.
 */
export function column(
  values: Record<string, string | string[]>,
  name: string,
): string[] {
  const value = values[name]
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}
