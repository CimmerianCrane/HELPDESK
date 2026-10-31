import type { Metadata } from 'next'
import Link from 'next/link'
import { cardClass } from '@/components/office/ui'
import { formatDate, formatDateTime } from '@/lib/format'
import { requireAuth } from '@/server/auth/context'
import { can } from '@/server/auth/permissions'
import { dashboardSummary } from '@/server/dashboard/dashboard'
import { ON_HOLD_REASON_LABELS, JOB_STATUS_LABELS } from '@/server/jobs/labels'
import { getSettings } from '@/server/settings/settings'
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/server/users/labels'

export const metadata: Metadata = { title: 'Dashboard — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

/**
 * The office board (brief §8; UI-REVIEW §5). The owner rejected the first version as "not the look
 * I want": it repeated the same count three times, left a half-page void, and carried a developer
 * block on the dispatcher's first screen. This one is an ops board, today first.
 *
 * The order is the order a person answers the question "what needs me now":
 *   1. the finding, as the page title, in one sentence built from the figures below it;
 *   2. the four attention figures, each with a comparison against yesterday;
 *   3. today on the board — the visits due today and who takes the 2am call;
 *   4. only the panels that have something in them.
 *
 * Every count is the same service the tiles have always read, so the dashboard cannot disagree with
 * the list a count links to. Developer state (database, timezone, clock, capabilities) lives on
 * `/admin`, not here.
 */
export default async function DashboardPage() {
  const context = await requireAuth()
  const isOffice = can(context.role, 'dashboard.office')

  if (!isOffice) return <FieldBoard />

  const [dashboard, settings] = await Promise.all([dashboardSummary(context), getSettings()])

  const finding = headline(dashboard)
  const today = dashboard.today

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-muted">{formatDate(new Date(), settings.timezone)}</p>
          <h1 className="max-w-3xl font-display text-title leading-tight font-semibold text-ink">
            {finding}
          </h1>
        </div>
        <Link
          href="/jobs"
          className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink hover:border-ink"
        >
          All jobs
        </Link>
      </header>

      {/* The board's own instrument: one charcoal gauge with a hazard stripe across its face, the way
          a load indicator is marked on the machine. It is the product's signature element — every
          count that needs a decision is read off it — and it is the biggest block because it answers
          the question the title asks. */}
      <section aria-labelledby="attention-heading">
        <h2 id="attention-heading" className="sr-only">
          Needs attention now
        </h2>
        <div className="overflow-hidden rounded-lg bg-anchor">
          <div className="hazard-band h-2" aria-hidden />
          <dl className="grid divide-y divide-white/10 sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
            <Cell
              label="Open P1s"
              value={dashboard.p1Open}
              change={dashboard.sinceYesterday.p1Open}
              href="/jobs?priority=P1"
              tone={dashboard.p1Open > 0 ? 'neg' : 'ink'}
              hint="Crane down or someone at risk."
            />
            <Cell
              label="SLA breaches"
              value={dashboard.slaBreached}
              change={dashboard.sinceYesterday.slaBreached}
              href="/jobs?sla=breached"
              tone={dashboard.slaBreached > 0 ? 'neg' : 'ink'}
              hint="Past a response or resolution target."
            />
            <Cell
              label="Late visits"
              value={dashboard.overdue}
              change={dashboard.sinceYesterday.lateVisits}
              href="/jobs?sort=scheduled"
              tone={dashboard.overdue > 0 ? 'warn' : 'ink'}
              hint="A date has passed and the work has not started."
            />
            <Cell
              label="Awaiting invoicing"
              value={dashboard.awaitingInvoicing}
              change={dashboard.sinceYesterday.awaitingInvoicing}
              href="/jobs?status=REVIEWED"
              tone="ink"
              hint="Signed off; the bill has not gone out."
            />
          </dl>
        </div>
      </section>

      {/* Today first: the board's job is to say what is happening now, not what happened last week. */}
      <section className={cardClass} aria-labelledby="today-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="today-heading" className="font-semibold text-ink">
            Today on the board
          </h2>
          <Link
            href="/schedule"
            className="text-sm text-muted underline decoration-line underline-offset-2 hover:text-ink"
          >
            Open the schedule
          </Link>
        </div>

        <div className="mt-3 grid gap-6 lg:grid-cols-[2fr_1fr]">
          <div>
            <p className="text-xs font-medium text-muted">
              Visits today
            </p>
            {today.visits.length === 0 ? (
              <p className="mt-2 text-sm text-faint">
                Nothing is booked for today. The{' '}
                <Link href="/schedule" className="text-ink underline decoration-line underline-offset-2">
                  schedule board
                </Link>{' '}
                is where that changes.
              </p>
            ) : (
              <ul className="mt-2 text-sm">
                {today.visits.map((visit) => (
                  <li
                    key={visit.jobId}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-rule py-2 first:border-t-0"
                  >
                    <span className="min-w-0">
                      <Link
                        href={`/jobs/${visit.jobId}`}
                        className="font-medium text-ink underline decoration-line underline-offset-2"
                      >
                        {visit.number}
                      </Link>{' '}
                      <span className="text-muted">
                        {visit.customerName} · {visit.siteName}
                        {visit.assetTags.length > 0 ? ` · ${visit.assetTags.join(', ')}` : ''}
                      </span>
                    </span>
                    <span className="flex items-center gap-2 text-xs text-muted">
                      <span data-num>{formatDateTime(visit.scheduledStart, settings.timezone)}</span>
                      <span className="rounded bg-field px-1.5 py-0.5">
                        {JOB_STATUS_LABELS[visit.status]}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <p className="text-xs font-medium text-muted">On call now</p>
            {today.onCall.length === 0 ? (
              <p className="mt-2 text-sm text-faint">
                Nobody is rostered. The{' '}
                <Link href="/schedule/roster" className="text-ink underline decoration-line underline-offset-2">
                  roster
                </Link>{' '}
                is where that is fixed.
              </p>
            ) : (
              <ul className="mt-2 text-sm">
                {today.onCall.map((shift) => (
                  <li
                    key={shift.technicianId}
                    className="border-t border-rule py-2 first:border-t-0"
                  >
                    <span className="font-medium text-ink">{shift.technicianName}</span>
                    <span className="block text-xs text-muted">
                      until {formatDateTime(shift.until, settings.timezone)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* Only the panels with content. An empty "On hold" beside a full list was a half-page void in
          the first version; a card that says "nothing is on hold" costs a card. When only one panel
          has content it spans the canvas: a card stopping at the halfway mark is the same void. */}
      <div className={`grid gap-4 ${dashboard.onHoldTotal > 0 ? 'lg:grid-cols-2' : ''}`}>
        {dashboard.onHoldTotal > 0 ? (
          <section className={cardClass}>
            <h2 className="font-semibold text-ink">On hold</h2>
            <p className="mt-1 text-sm text-muted">
              Work stopped, by the reason it was stopped. Every one of these is waiting on somebody.
            </p>
            <ul className="mt-3 text-sm">
              {dashboard.onHoldByReason.map((entry) => (
                <li
                  key={entry.reason}
                  className="flex items-center justify-between gap-4 border-t border-rule py-2 first:border-t-0"
                >
                  <Link
                    href="/jobs?status=ON_HOLD"
                    className="text-ink underline decoration-line underline-offset-2"
                  >
                    {ON_HOLD_REASON_LABELS[entry.reason]}
                  </Link>
                  <span data-num className="font-medium text-ink">
                    {entry.count}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className={cardClass}>
          <h2 className="font-semibold text-ink">The next 30 days</h2>
          <dl className="mt-3 text-sm">
            <Figure label="Visits booked" value={dashboard.visitsBooked} />
            <Figure
              label="Services and exams due"
              value={dashboard.dueWithin30Days}
              href="/schedules?due=30"
            />
            <Figure
              label="Schedules overdue"
              value={dashboard.schedulesOverdue}
              href="/schedules?due=overdue"
              tone={dashboard.schedulesOverdue > 0 ? 'neg' : 'ink'}
            />
            <Figure
              label="Certificates expiring"
              value={dashboard.certificatesExpiring}
              href="/certificates?due=30"
              tone={dashboard.certificatesExpiring > 0 ? 'warn' : 'ink'}
            />
          </dl>
        </section>
      </div>

      {/* Only rendered when it has something in it — "Nothing scheduled in the next 30 days" does not
          earn a full-width panel. */}
      {dashboard.upcoming.length > 0 ? (
        <section className={cardClass}>
          <h2 className="font-semibold text-ink">Coming up</h2>
          <ul className="mt-3 text-sm">
            {dashboard.upcoming.map((entry) => (
              <li
                key={entry.jobId}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-rule py-2 first:border-t-0"
              >
                <span>
                  <Link
                    href={`/jobs/${entry.jobId}`}
                    className="font-medium text-ink underline decoration-line underline-offset-2"
                  >
                    {entry.number}
                  </Link>{' '}
                  <span className="text-muted">
                    {entry.customerName} · {entry.siteName}
                    {entry.assetTags.length > 0 ? ` · ${entry.assetTags.join(', ')}` : ''}
                  </span>
                </span>
                <span data-num className="text-muted">
                  {formatDateTime(entry.scheduledStart, settings.timezone)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

/**
 * A technician lands on the same page and gets their own answer: the phone app, not a company-wide
 * board they may not read.
 */
async function FieldBoard() {
  const context = await requireAuth()
  const firstName = context.name.split(' ')[0]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-title font-semibold text-ink">
          {firstName ? `Hello, ${firstName}` : 'Hello'}
        </h1>
        <p className="mt-1 text-muted">
          Signed in as <strong className="font-medium text-ink">{ROLE_LABELS[context.role]}</strong>.{' '}
          {ROLE_DESCRIPTIONS[context.role]}
        </p>
      </div>
      <section className={cardClass}>
        <h2 className="font-semibold text-ink">Your work</h2>
        <p className="mt-1 text-sm text-muted">
          The company board is for the office. Your jobs are on the phone app, which works without a
          signal once it has synced.
        </p>
        <Link
          href="/m/jobs"
          className="mt-4 inline-block rounded-md bg-hivis px-4 py-2 font-semibold text-ink hover:bg-hivis/85"
        >
          Open my jobs
        </Link>
      </section>
    </div>
  )
}

/** The one-sentence finding the page is titled with. Built from the figures below it, never stale. */
function headline(counts: {
  p1Open: number
  slaBreached: number
  overdue: number
}): string {
  if (counts.p1Open > 0) {
    return `${counts.p1Open} crane${counts.p1Open === 1 ? ' is' : 's are'} down or at risk, and ${counts.slaBreached} job${counts.slaBreached === 1 ? ' has' : 's have'} passed an SLA target.`
  }
  if (counts.slaBreached > 0) {
    return `${counts.slaBreached} job${counts.slaBreached === 1 ? ' has' : 's have'} passed a response or resolution target.`
  }
  if (counts.overdue > 0) {
    return `${counts.overdue} visit${counts.overdue === 1 ? ' was' : 's were'} due and never started.`
  }
  return 'Nothing is past its target. The board is clear.'
}

const TONES = { ink: 'text-on-anchor', neg: 'text-red-400', warn: 'text-hivis' } as const

/** One cell of the gauge: a figure, its direction since yesterday, and its hint. */
function Cell({
  label,
  value,
  change,
  href,
  hint,
  tone,
}: {
  label: string
  value: number
  change: number
  href: string
  hint: string
  tone: keyof typeof TONES
}) {
  return (
    <div className="px-5 py-4">
      <dt className="text-sm font-medium text-on-anchor-muted">
        <Link href={href} className="hover:text-hivis hover:underline hover:underline-offset-2">
          {label}
        </Link>
      </dt>
      <dd
        data-num
        className={`mt-1 font-display text-[40px] leading-none font-semibold ${TONES[tone]}`}
      >
        {value}
      </dd>
      <p className="mt-2 text-xs text-on-anchor-muted">
        {change === 0 ? 'Same as yesterday' : <Change change={change} />}
        <span className="mt-0.5 block text-on-anchor-muted/75">{hint}</span>
      </p>
    </div>
  )
}

/**
 * A direction, said in words as well as a glyph — a bare triangle is not readable by everybody, and
 * an increase in anything on this strip is bad news, which the colour has to carry but not alone.
 */
function Change({ change }: { change: number }) {
  const more = change > 0
  return (
    <span className={more ? 'font-medium text-red-400' : 'font-medium text-emerald-400'}>
      {more ? '▲' : '▼'} {Math.abs(change)} {more ? 'more' : 'fewer'} than yesterday
    </span>
  )
}

/** A labelled figure with a rule under it, for the "next 30 days" card. */
function Figure({
  label,
  value,
  href,
  tone = 'ink',
}: {
  label: string
  value: number
  href?: string
  tone?: keyof typeof TONES
}) {
  // On the pale panel, not the charcoal gauge, so this row uses the reading tones.
  const reading = tone === 'neg' ? 'text-neg' : tone === 'warn' ? 'text-warn' : 'text-ink'
  const figure = (
    <span data-num className={`font-display text-[22px] leading-none font-semibold ${reading}`}>
      {value}
    </span>
  )

  return (
    <div className="flex items-center justify-between gap-4 border-t border-rule py-2 first:border-t-0">
      <dt className="text-muted">{label}</dt>
      <dd>
        {href ? (
          <Link href={href} className="underline decoration-line underline-offset-2">
            {figure}
          </Link>
        ) : (
          figure
        )}
      </dd>
    </div>
  )
}
