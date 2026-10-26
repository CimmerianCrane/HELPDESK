'use client'

import { useState, useTransition } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { IDLE_FORM, type FormState } from '@/server/action-result'
import type { BoardJobCard, ScheduleBoard } from '@/server/schedule/scheduling'
import { formatDuration } from '@/lib/format'
import { FormMessage } from './ui'

/**
 * The schedule board (brief §4.4): people down the side, days across the top, visits in the cells.
 *
 * Drag a visit onto another technician or another day and it is rescheduled and reassigned in one
 * call. The drag is a convenience, not the only way in: every card also opens a panel with the same
 * controls in a form, and the underlying assignment has its own place on the job screen. A board
 * that could only be operated by dragging would be unusable with a keyboard and unusable on a
 * tablet with a stylus.
 *
 * The conflicts shown on a card come from the server — the same `jobConflicts` the assignment
 * service refuses with — so a red card and a refused drop are always the same complaint.
 */

interface Props {
  board: ScheduleBoard
  /** Set when the dispatcher has to be shown gaps in on-call cover. */
  reassign: (
    jobId: string,
    into: { technicianId: string | null; day: string | null },
  ) => Promise<FormState>
}

const PRIORITY_STYLES: Record<string, string> = {
  P1: 'border-l-4 border-l-red-600',
  P2: 'border-l-4 border-l-amber-500',
  P3: 'border-l-4 border-l-sky-500',
  P4: 'border-l-4 border-l-slate-300',
}

function localTime(value: Date | null, timeZone: string): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(value)
}

function JobCard({
  job,
  timeZone,
  compact = false,
}: {
  job: BoardJobCard
  timeZone: string
  compact?: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: job.id,
    data: { job },
  })

  const problems = job.conflicts.filter(
    (conflict) => conflict.kind === 'double-booked' || conflict.kind === 'on-leave',
  )
  const leaves = job.conflicts.filter((conflict) => conflict.kind === 'on-leave')

  const style = transform
    ? { transform: CSS.Translate.toString(transform), zIndex: 20 }
    : undefined

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={[
        // A 44px-tall target at minimum: the board is used on a tablet in a workshop.
        'cursor-grab touch-none rounded-md border border-slate-200 bg-white p-2 text-left shadow-sm',
        'focus:ring-2 focus:ring-slate-900 focus:outline-none',
        isDragging ? 'opacity-50' : 'hover:border-slate-300',
        leaves.length > 0 ? 'border-l-4 border-l-violet-500' : (PRIORITY_STYLES[job.priority] ?? ''),
      ].join(' ')}
      aria-label={`${job.number}, ${job.customerName}. Drag to move.`}
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/jobs/${job.id}`}
          className="text-sm font-medium text-slate-900 underline decoration-slate-300 hover:decoration-slate-900"
          // The link is inside a draggable; without this a tap starts a drag instead of navigating.
          onPointerDown={(event) => event.stopPropagation()}
        >
          {job.number}
        </Link>
        {!compact && job.scheduledStart ? (
          <span className="shrink-0 text-xs text-slate-500">
            {localTime(job.scheduledStart, timeZone)}–{localTime(job.scheduledEnd, timeZone)}
          </span>
        ) : null}
      </div>
      <p className="mt-0.5 truncate text-xs text-slate-600">{job.customerName}</p>
      {job.assetTags.length > 0 ? (
        <p className="truncate text-xs text-slate-500">{job.assetTags.join(', ')}</p>
      ) : null}
      {problems.length > 0 ? (
        <p className="mt-1 text-xs font-medium text-red-700">
          {problems.length === 1 ? problems[0]!.message : `${problems.length} clashes`}
        </p>
      ) : null}
    </div>
  )
}

/** One cell: a day × a technician (or the unassigned row). */
function Cell({
  id,
  children,
  className = '',
}: {
  id: string
  children?: React.ReactNode
  className?: string
}) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      className={[
        'min-h-20 border-t border-l border-slate-200 p-1.5 align-top',
        isOver ? 'bg-slate-100 ring-2 ring-inset ring-slate-400' : '',
        className,
      ].join(' ')}
    >
      {children}
    </div>
  )
}

export function ScheduleBoardView({ board, reassign }: Props) {
  const router = useRouter()
  const [active, setActive] = useState<BoardJobCard | null>(null)
  const [message, setMessage] = useState<FormState>(IDLE_FORM)
  const [pending, startTransition] = useTransition()

  const sensors = useSensors(
    // A small distance before a drag starts, so clicking a job number still navigates.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  )

  const onDragStart = (event: DragStartEvent) => {
    setActive((event.active.data.current as { job?: BoardJobCard } | undefined)?.job ?? null)
  }

  const onDragEnd = (event: DragEndEvent) => {
    setActive(null)
    const job = (event.active.data.current as { job?: BoardJobCard } | undefined)?.job
    const target = event.over?.id
    if (!job || !target) return

    const [technicianId, day] = String(target).split('|')
    startTransition(async () => {
      const result = await reassign(job.id, {
        technicianId: technicianId === 'unassigned' ? null : (technicianId ?? null),
        day: day ?? null,
      })
      setMessage(result)
      if (result.ok) router.refresh()
    })
  }

  const days = board.window.days

  return (
    <div className="space-y-4">
      <FormMessage state={message} />

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <caption className="sr-only">
              Schedule for the {board.view === 'week' ? 'week beginning' : 'day'} {board.day}
            </caption>
            <thead>
              <tr>
                <th scope="col" className="w-40 px-3 py-2 text-xs font-medium text-slate-500 uppercase">
                  Technician
                </th>
                {days.map((day) => (
                  <th
                    key={day.toISOString()}
                    scope="col"
                    className="border-l border-slate-200 px-3 py-2 text-xs font-medium text-slate-500"
                  >
                    {new Intl.DateTimeFormat('en-GB', {
                      timeZone: board.timezone,
                      weekday: 'short',
                      day: '2-digit',
                      month: '2-digit',
                    }).format(
                      // The day carrier is a UTC midnight; render it in UTC so it labels itself.
                      new Date(day.getTime() + 12 * 3_600_000),
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {board.technicians.map((technician) => {
                const onLeaveToday = technician.unavailability.some((span) =>
                  days.some((day) => {
                    const start = day.getTime()
                    const end = start + 86_400_000
                    return span.startAt.getTime() < end && span.endAt.getTime() > start
                  }),
                )
                return (
                  <tr key={technician.id}>
                    <th scope="row" className="px-3 py-2 align-top">
                      <div className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: technician.colour ?? '#94a3b8' }}
                        />
                        <span className="text-sm font-medium text-slate-900">{technician.name}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {technician.scheduledMinutes > 0
                          ? `${formatDuration(technician.scheduledMinutes * 60_000)} booked`
                          : 'Nothing booked'}
                      </p>
                      {technician.onCall ? (
                        <p className="text-xs font-medium text-emerald-700">On call</p>
                      ) : null}
                      {onLeaveToday ? (
                        <p className="text-xs font-medium text-violet-700">On leave</p>
                      ) : null}
                    </th>

                    {days.map((day) => {
                      const dayJobs = jobsInCell(board, technician.id, day)
                      return (
                        <Cell key={`${technician.id}|${day.toISOString()}`} id={`${technician.id}|${isoDayOf(day)}`}>
                          <div className="space-y-1">
                            {dayJobs.map((job) => (
                              <JobCard key={job.id} job={job} timeZone={board.timezone} />
                            ))}
                          </div>
                        </Cell>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <DragOverlay>
          {active ? (
            <div className="w-48 rotate-1 rounded-md border border-slate-300 bg-white p-2 shadow-lg">
              <p className="text-sm font-medium text-slate-900">{active.number}</p>
              <p className="truncate text-xs text-slate-600">{active.customerName}</p>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {pending ? <p className="text-sm text-slate-500">Saving…</p> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Nothing on the board yet</h2>
          <p className="mt-1 text-xs text-slate-500">
            A technician and no date, or a date and nobody. Both are refused dispatch until they are
            fixed.
          </p>
          <div className="mt-3 space-y-2">
            {board.undated.length === 0 && board.unassigned.length === 0 ? (
              <p className="text-sm text-slate-500">Every job on the board is dated and staffed.</p>
            ) : (
              <>
                {board.undated.map((job) => (
                  <div key={job.id}>
                    <JobCard job={job} timeZone={board.timezone} compact />
                    <p className="mt-0.5 pl-1 text-xs text-amber-800">No date — drag it onto a day.</p>
                  </div>
                ))}
                {board.unassigned.map((job) => (
                  <div key={job.id}>
                    <JobCard job={job} timeZone={board.timezone} compact />
                    <p className="mt-0.5 pl-1 text-xs text-amber-800">
                      Nobody assigned — drag it onto a technician.
                    </p>
                  </div>
                ))}
              </>
            )}
          </div>
          <Cell id="unassigned|" className="mt-3 rounded border border-dashed border-slate-300">
            <p className="text-xs text-slate-400">Drop here to take somebody off a job.</p>
          </Cell>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">On-call cover</h2>
          {board.onCallGaps.length === 0 ? (
            <p className="mt-1 text-sm text-emerald-700">
              Somebody is on call for every hour of this {board.view === 'week' ? 'week' : 'day'}.
            </p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm text-red-800">
              {board.onCallGaps.map((gap) => (
                <li key={gap.start.toISOString()}>
                  Nobody on call {localDateTime(gap.start, board.timezone)} –{' '}
                  {localDateTime(gap.end, board.timezone)}
                </li>
              ))}
            </ul>
          )}
          <Link href="/schedule/roster" className="mt-3 inline-block text-sm text-slate-700 underline">
            Manage the roster
          </Link>
        </section>
      </div>

      {board.later.length > 0 ? (
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">After this {board.view}</h2>
          <ul className="mt-2 divide-y divide-slate-100">
            {board.later.map((job) => (
              <li key={job.id} className="flex items-center justify-between gap-4 py-2 text-sm">
                <Link href={`/jobs/${job.id}`} className="font-medium text-slate-900 underline">
                  {job.number}
                </Link>
                <span className="text-slate-600">{job.customerName}</span>
                <span className="text-slate-500">
                  {job.scheduledStart ? localDateTime(job.scheduledStart, board.timezone) : '—'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <DetailsPanel board={board} />
    </div>
  )
}

function DetailsPanel({ board }: { board: ScheduleBoard }) {
  return (
    <noscript>
      <p className="text-sm text-slate-600">
        Moving visits needs JavaScript. The assignment and reschedule forms on each job screen do the
        same work without it.
      </p>
      {board.jobs.length === 0 ? null : (
        <ul className="mt-2 text-sm">
          {board.jobs.map((job) => (
            <li key={job.id}>
              <Link href={`/jobs/${job.id}`} className="underline">
                {job.number}
              </Link>{' '}
              — {job.customerName}
            </li>
          ))}
        </ul>
      )}
    </noscript>
  )
}

function isoDayOf(day: Date): string {
  return day.toISOString().slice(0, 10)
}

function localDateTime(value: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(value)
}

/** The jobs in one cell: assigned to this technician and falling on this local day. */
function jobsInCell(board: ScheduleBoard, technicianId: string, day: Date): BoardJobCard[] {
  const start = day.getTime()
  const end = start + 86_400_000
  return board.jobs.filter(
    (job) =>
      job.technicianIds.includes(technicianId) &&
      job.scheduledStart &&
      job.scheduledEnd &&
      job.scheduledStart.getTime() < end &&
      job.scheduledEnd.getTime() > start,
  )
}
