'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { FieldError, FormMessage, inputClass } from '@/components/office/ui'
import type { FormState } from '@/server/action-result'
import { IDLE_FORM } from '@/server/action-result'
import type { SavedJobFilter } from '@/server/jobs/saved-filters'

/**
 * Saved filters under the job list (brief §8).
 *
 * Saving replays the exact query in the address bar, so the row is a link back to the same view. The
 * delete is its own one-button form rather than part of the save form: a row with two buttons in one
 * form makes Enter do whichever button the browser considers first.
 */
export function SavedFilters({
  filters,
  currentQuery,
  saveAction,
  deleteAction,
}: {
  filters: SavedJobFilter[]
  /** The query string this page is showing, without the leading `?`. */
  currentQuery: string
  saveAction: (state: FormState, formData: FormData) => Promise<FormState>
  deleteAction: (filterId: string) => Promise<void>
}) {
  const [state, formAction] = useActionState(saveAction, IDLE_FORM)

  return (
    <section className="rounded-lg bg-panel p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">Saved filters</h2>
        <p className="text-xs text-muted">Yours — nobody else sees them.</p>
      </div>

      {filters.length === 0 ? (
        <p className="mt-2 text-sm text-muted">
          None yet. Set the filters you use every morning, then save them here.
        </p>
      ) : (
        <ul className="mt-2 flex flex-wrap gap-2">
          {filters.map((filter) => (
            <li
              key={filter.id}
              className="flex items-center gap-1 rounded border border-line bg-sheet pl-2 text-sm"
            >
              <Link href={`/jobs?${filter.query}`} className="py-1 text-ink underline">
                {filter.name}
              </Link>
              <form action={deleteAction.bind(null, filter.id)}>
                <button
                  type="submit"
                  aria-label={`Delete the saved filter ${filter.name}`}
                  className="px-2 py-1 text-muted hover:text-neg"
                >
                  ×
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <form action={formAction} className="mt-3 flex flex-wrap items-start gap-2">
        {/* The address bar's own query, so a saved filter cannot drift from the view that saved it. */}
        <input type="hidden" name="query" value={currentQuery} />
        <div>
          <label htmlFor="filter-name" className="sr-only">
            Name this filter
          </label>
          <input
            id="filter-name"
            name="name"
            required
            maxLength={60}
            placeholder="Name this view"
            className={`${inputClass} mt-0 w-48`}
          />
          <FieldError state={state} name="name" />
        </div>
        <button
          type="submit"
          disabled={!currentQuery}
          title={currentQuery ? undefined : 'Set a filter first'}
          className="rounded-md border border-line bg-field px-3 py-2 text-sm text-ink hover:bg-raised disabled:opacity-50"
        >
          Save this filter
        </button>
        <FormMessage state={state} />
      </form>
    </section>
  )
}
