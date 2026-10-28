/**
 * Navigation feedback for the whole office shell.
 *
 * Every office page is `force-dynamic` and reads the database in another region, so a click cannot
 * render until the server answers — without this file the browser sits on the old screen with no
 * sign that anything is happening, and that wait reads as "the app is slow". This boundary lets Next
 * swap to a skeleton the moment a link is followed.
 */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-8">
      <span className="sr-only">Loading</span>
      <div className="h-8 w-48 animate-pulse rounded bg-slate-200" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="h-24 animate-pulse rounded-lg border border-slate-200 bg-white" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-lg border border-slate-200 bg-white" />
    </div>
  )
}
