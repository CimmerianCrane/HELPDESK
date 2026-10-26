import Link from 'next/link'

/**
 * Reached by a job that has been reassigned or cancelled since the link was sent — the two cases a
 * technician actually hits. Saying "not found" is accurate; saying which page to go back to is the
 * part that helps.
 */
export default function TechJobNotFound() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6">
      <h1 className="text-lg font-semibold text-slate-900">This job is not yours any more</h1>
      <p className="mt-1 text-slate-600">
        It may have been reassigned or cancelled. Your current work is on the list.
      </p>
      <Link
        href="/m/jobs"
        className="mt-4 inline-block rounded-md bg-slate-900 px-4 py-2 font-medium text-white active:bg-slate-800"
      >
        My jobs
      </Link>
    </div>
  )
}
