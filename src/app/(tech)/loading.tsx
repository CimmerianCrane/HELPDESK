/** Same reason as the office shell: a phone on a slow link needs to see the tap land. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-4 p-4">
      <span className="sr-only">Loading</span>
      <div className="h-8 w-40 animate-pulse rounded bg-panel" />
      <div className="h-24 animate-pulse rounded-lg border border-line bg-field" />
      <div className="h-24 animate-pulse rounded-lg border border-line bg-field" />
    </div>
  )
}
