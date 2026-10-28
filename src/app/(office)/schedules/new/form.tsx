import { ScheduleForm } from '@/components/office/crane-schedule-forms'
import { requireAuth } from '@/server/auth/context'
import { listCranes } from '@/server/cranes/cranes'
import { createScheduleAction } from '../actions'

/**
 * The "add a schedule" form on the list page.
 *
 * A server component wrapper rather than a client one: the crane list costs one query and is only
 * fetched for the role that may add a schedule, so it has no business in the browser bundle.
 */
export async function CreateScheduleForm() {
  const context = await requireAuth()
  const cranes = await listCranes(context, {})

  if (cranes.length === 0) {
    return (
      <p className="text-sm text-slate-600">
        Add a crane to the register first — a schedule is an obligation on a machine.
      </p>
    )
  }

  return (
    <ScheduleForm
      action={createScheduleAction}
      cranes={cranes.map((crane) => ({
        id: crane.id,
        assetTag: crane.assetTag,
        siteName: crane.site.name,
      }))}
      submitLabel="Add schedule"
      idPrefix="new-schedule"
    />
  )
}
