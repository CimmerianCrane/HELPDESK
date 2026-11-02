/**
 * Navigation feedback for the whole office shell.
 *
 * Every office page is `force-dynamic` and reads the database in another region, so a click cannot
 * render until the server answers — without this file the browser sits on the old screen with no
 * sign that anything is happening, and that wait reads as "the app is slow". This boundary lets Next
 * swap to a skeleton the moment a link is followed: the shell's own shapes, at their real sizes, so
 * the page does not move when the data lands.
 */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-6">
      <span className="sr-only">Loading</span>
      <div className="h-7 w-48 rounded bg-panel" />
      <div className="grid gap-px overflow-hidden rounded-lg bg-rule sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="h-[104px] bg-panel" />
        ))}
      </div>
      <div className="h-64 rounded-lg bg-panel" />
    </div>
  )
}
