import { db, type Tx } from '@/lib/db'
import { env } from '@/lib/env'
import { errorMessage, logger } from '@/lib/logger'
import { withAudit } from '@/server/audit/audit'
import { NotFoundError, RuleError } from '@/server/auth/errors'
import { assertCan } from '@/server/auth/permissions'
import { jobReadWhere } from '@/server/auth/scope'
import type { AuthContext } from '@/server/auth/types'
import { emailAdapter } from '@/server/email/email'
import { canTransition } from '@/server/jobs/status'
import { formatDateTime } from '@/lib/format'
import { getSettings } from '@/server/settings/settings'

/**
 * Dispatch (brief §4.4): sending a technician the details of a visit.
 *
 * A dispatch is more than "you are going to this address". What a technician needs before leaving is
 * who to ask for at the gate, how to get in, whether the machine has been a problem lately, and what
 * checklist the office expects back. Assembling that from six tables is exactly the sort of thing
 * that gets skipped under time pressure, so it is assembled once here and stored on the notification.
 *
 * Two rules from the wider brief shape this file:
 *
 *   - **Only a SCHEDULED job can be dispatched.** Dispatch is a lifecycle step, recorded in
 *     `JobStatusHistory` like every other. Firing an email without the status change would leave the
 *     board saying "planned" about work that is already on the road.
 *   - **The site's access notes are not invented.** If nobody has recorded how to get in, the
 *     dispatch says so rather than leaving the technician to find out at the barrier.
 */

export interface DispatchCrane {
  id: string
  assetTag: string
  type: string
  swlKg: string
  status: string
  restrictedReason: string | null
  /** The last few things recorded against the machine, newest first. */
  recent: Array<{ kind: 'report' | 'certificate'; label: string; at: Date }>
}

export interface DispatchChecklistItem {
  section: string
  code: string
  label: string
}

export interface DispatchPack {
  jobId: string
  jobNumber: string
  customerName: string
  siteName: string
  address: string | null
  accessNotes: string | null
  inductionRequirements: string | null
  operatingHours: string | null
  /** Who to ask for. The primary contact at the site, falling back to the customer's primary. */
  contact: { name: string; role: string; phone: string | null; email: string | null } | null
  scheduledStart: Date | null
  scheduledEnd: Date | null
  description: string | null
  priority: string
  cranes: DispatchCrane[]
  checklist: DispatchChecklistItem[]
  /** Things the office must see before sending somebody — a restricted crane, no access notes. */
  warnings: string[]
}

/** Builds everything a dispatch carries. Read-only, so the preview screen and the send share it. */
export async function dispatchPack(
  context: AuthContext,
  jobId: string,
  client: Tx = db,
  now: Date = new Date(),
): Promise<DispatchPack> {
  assertCan(context, 'job.dispatch')

  const job = await client.job.findFirst({
    where: { id: jobId, ...jobReadWhere(context) },
    select: {
      id: true,
      number: true,
      priority: true,
      description: true,
      scheduledStart: true,
      scheduledEnd: true,
      customer: { select: { id: true, legalName: true, tradingName: true } },
      site: {
        select: {
          id: true,
          name: true,
          address: true,
          accessNotes: true,
          inductionRequirements: true,
          operatingHours: true,
          contacts: {
            where: { deletedAt: null, role: 'SITE_CONTACT' },
            orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
            take: 1,
            select: { name: true, role: true, phone: true, email: true },
          },
        },
      },
      jobType: {
        select: {
          name: true,
          defaultChecklistTemplateId: true,
        },
      },
      cranes: {
        select: { craneId: true },
      },
      technicians: {
        select: { technicianId: true, isLead: true },
      },
    },
  })
  if (!job) throw new NotFoundError('No such job.')

  const customerName = job.customer.tradingName ?? job.customer.legalName

  // The contact falls back from the site's own contact to the customer's primary contact. A site
  // with nobody named still has somebody who answers the phone.
  const siteContact = job.site.contacts[0] ?? null
  const contact =
    siteContact ??
    (await client.contact.findFirst({
      where: { customerId: job.customer.id, deletedAt: null, isPrimary: true },
      select: { name: true, role: true, phone: true, email: true },
    }))

  const cranes = await Promise.all(
    job.cranes.map(async ({ craneId }) => {
      const crane = await client.crane.findUniqueOrThrow({
        where: { id: craneId },
        select: {
          id: true,
          assetTag: true,
          type: true,
          swlKg: true,
          status: true,
          restrictedReason: true,
        },
      })

      const [reports, certificates] = await Promise.all([
        client.report.findMany({
          // Approved only: a draft is the office's working copy and is not what the technician needs
          // to know about the machine, which is what has been certified and what was found last time.
          where: { craneId, status: 'APPROVED' },
          orderBy: { approvedAt: 'desc' },
          take: 3,
          select: { documentNumber: true, approvedAt: true, createdAt: true },
        }),
        client.certificate.findMany({
          where: { craneId, deletedAt: null },
          orderBy: { issueDate: 'desc' },
          take: 3,
          select: { certificateNumber: true, type: true, issueDate: true, expiryDate: true },
        }),
      ])

      return {
        id: crane.id,
        assetTag: crane.assetTag,
        type: crane.type,
        swlKg: crane.swlKg.toString(),
        status: crane.status,
        restrictedReason: crane.restrictedReason,
        recent: [
          ...reports.map((report) => ({
            kind: 'report' as const,
            label: `${report.documentNumber ?? 'Company inspection'} (approved)`,
            at: report.approvedAt ?? report.createdAt,
          })),
          ...certificates.map((certificate) => ({
            kind: 'certificate' as const,
            label: `${certificate.type}${certificate.certificateNumber ? ` ${certificate.certificateNumber}` : ''} — expires ${certificate.expiryDate ? certificate.expiryDate.toISOString().slice(0, 10) : 'n/a'}`,
            at: certificate.issueDate ?? now,
          })),
        ]
          .sort((a, b) => b.at.getTime() - a.at.getTime())
          .slice(0, 5),
      }
    }),
  )

  const checklist = job.jobType.defaultChecklistTemplateId
    ? await client.checklistItem.findMany({
        where: { templateId: job.jobType.defaultChecklistTemplateId },
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
        select: { section: true, code: true, label: true },
      })
    : []

  const warnings: string[] = []
  for (const crane of cranes) {
    if (crane.status === 'RESTRICTED') {
      warnings.push(`${crane.assetTag} is flagged Do Not Operate${crane.restrictedReason ? `: ${crane.restrictedReason}` : '.'}`)
    }
  }
  if (!job.site.accessNotes) {
    warnings.push('No access notes are recorded for this site.')
  }
  if (!contact?.phone) {
    warnings.push('No phone number is recorded for anybody at this site.')
  }

  return {
    jobId: job.id,
    jobNumber: job.number,
    customerName,
    siteName: job.site.name,
    address: formatAddress(job.site.address),
    accessNotes: job.site.accessNotes,
    inductionRequirements: job.site.inductionRequirements,
    operatingHours: job.site.operatingHours,
    contact,
    scheduledStart: job.scheduledStart,
    scheduledEnd: job.scheduledEnd,
    description: job.description,
    priority: job.priority,
    cranes,
    checklist,
    warnings,
  }
}

/** The JSON address column into one line a technician can paste into a maps app. */
function formatAddress(address: unknown): string | null {
  if (!address || typeof address !== 'object') return null
  const parts = ['line1', 'line2', 'city', 'postalCode']
    .map((key) => (address as Record<string, unknown>)[key])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
  return parts.length ? parts.join(', ') : null
}

/** The dispatch as the technician reads it: a plain-text message, not a database dump. */
export function renderDispatch(pack: DispatchPack, timeZone: string, baseUrl: string): string {
  const lines: string[] = []
  lines.push(`${pack.jobNumber} — ${pack.customerName}`)
  lines.push(`${pack.siteName}${pack.address ? `, ${pack.address}` : ''}`)
  if (pack.scheduledStart) {
    lines.push(
      `Attend ${formatDateTime(pack.scheduledStart, timeZone)}${
        pack.scheduledEnd ? `–${formatDateTime(pack.scheduledEnd, timeZone).slice(-5)}` : ''
      }`,
    )
  }
  lines.push('')

  if (pack.contact) {
    lines.push(
      `Ask for: ${pack.contact.name}${pack.contact.phone ? ` — ${pack.contact.phone}` : ''}`,
    )
  }
  if (pack.accessNotes) lines.push(`Access: ${pack.accessNotes}`)
  if (pack.inductionRequirements) lines.push(`Induction: ${pack.inductionRequirements}`)
  if (pack.operatingHours) lines.push(`Site hours: ${pack.operatingHours}`)
  lines.push('')

  if (pack.description) {
    lines.push('What needs doing:')
    lines.push(pack.description)
    lines.push('')
  }

  if (pack.cranes.length > 0) {
    lines.push('Cranes:')
    for (const crane of pack.cranes) {
      lines.push(
        `- ${crane.assetTag} (${crane.type}, SWL ${crane.swlKg} kg)${crane.status === 'RESTRICTED' ? ' — DO NOT OPERATE' : ''}`,
      )
      for (const entry of crane.recent) {
        lines.push(`    ${entry.label}`)
      }
    }
    lines.push('')
  }

  if (pack.checklist.length > 0) {
    lines.push('Checklist:')
    for (const item of pack.checklist) {
      lines.push(`- [${item.code}] ${item.label}`)
    }
    lines.push('')
  }

  if (pack.warnings.length > 0) {
    lines.push('Before you go:')
    for (const warning of pack.warnings) lines.push(`! ${warning}`)
    lines.push('')
  }

  lines.push(`Open it: ${baseUrl.replace(/\/$/, '')}/m/jobs/${pack.jobId}`)
  return lines.join('\n')
}

export interface DispatchResult {
  jobId: string
  jobNumber: string
  recipients: Array<{ name: string; channel: 'IN_APP' | 'EMAIL'; ok: boolean; error: string | null }>
  warnings: string[]
}

/**
 * Sends the dispatch to every technician on the job and moves it to DISPATCHED.
 *
 * Both channels are recorded per recipient, as with the P1 alert, so a dead mail server cannot hide
 * the in-app copy. The status change, the history row, the notifications and the audit entry commit
 * together.
 */
export async function dispatchJob(
  context: AuthContext,
  jobId: string,
  client: Tx = db,
): Promise<DispatchResult> {
  assertCan(context, 'job.dispatch')

  const pack = await dispatchPack(context, jobId, client)

  return withAudit(
    context,
    async (tx, log) => {
      const job = await tx.job.findFirst({
        where: { id: jobId, ...jobReadWhere(context) },
        select: {
          id: true,
          number: true,
          status: true,
          technicians: {
            select: {
              isLead: true,
              technician: {
                select: { id: true, userId: true, user: { select: { name: true, email: true } } },
              },
            },
          },
        },
      })
      if (!job) throw new NotFoundError('No such job.')
      if (job.technicians.length === 0) {
        throw new RuleError('Nobody is assigned to this job, so there is nobody to dispatch.')
      }
      if (!job.status || !canTransition(job.status, 'DISPATCHED') && job.status !== 'DISPATCHED') {
        throw new RuleError(
          `A job has to be scheduled before it can be dispatched (this one is ${job.status}).`,
        )
      }

      const settings = await getSettings()
      const text = renderDispatch(pack, settings.timezone, env().APP_BASE_URL)
      const subject = `${pack.jobNumber} — ${pack.customerName}, ${pack.siteName}`
      const link = `/m/jobs/${pack.jobId}`

      const results: DispatchResult['recipients'] = []
      const adapter = emailAdapter()

      for (const entry of job.technicians) {
        const user = entry.technician.user

        const inApp = await tx.notification.create({
          data: {
            userId: entry.technician.userId,
            channel: 'IN_APP',
            title: subject,
            body: text,
            jobId: pack.jobId,
            link,
            sentAt: new Date(),
          },
          select: { id: true },
        })

        const emailRow = await tx.notification.create({
          data: {
            userId: entry.technician.userId,
            channel: 'EMAIL',
            title: subject,
            body: text,
            jobId: pack.jobId,
            link,
            sentAt: null,
          },
          select: { id: true },
        })

        let failure: string | null = null
        try {
          const sent = await adapter.send({ to: user.email, subject, text })
          if (!sent.ok) failure = sent.error ?? 'send failed'
        } catch (error) {
          failure = errorMessage(error)
        }

        if (failure) {
          await tx.notification.update({
            where: { id: emailRow.id },
            data: { failedAt: new Date(), error: failure },
          })
          logger.warn('dispatch.email.failed', { jobId: pack.jobId, userId: entry.technician.userId, failure })
        } else {
          await tx.notification.update({
            where: { id: emailRow.id },
            data: { sentAt: new Date() },
          })
        }

        results.push({ name: user.name, channel: 'IN_APP', ok: true, error: null })
        results.push({ name: user.name, channel: 'EMAIL', ok: failure === null, error: failure })
        void inApp
      }

      // Only the first dispatch moves the status. Dispatching an already-dispatched job re-sends the
      // details (a technician who lost the email) without pretending it is a new lifecycle step.
      if (job.status === 'SCHEDULED') {
        await tx.job.update({ where: { id: job.id }, data: { status: 'DISPATCHED' } })
        await tx.jobStatusHistory.create({
          data: {
            jobId: job.id,
            fromStatus: 'SCHEDULED',
            toStatus: 'DISPATCHED',
            reason: `Dispatch sent to ${job.technicians.map((entry) => entry.technician.user.name).join(', ')}.`,
            changedById: context.userId,
          },
        })
      }

      await log({
        entity: 'Job',
        entityId: job.id,
        action: 'UPDATE',
        before: { status: job.status },
        after: {
          status: job.status === 'SCHEDULED' ? 'DISPATCHED' : job.status,
          dispatchedTo: job.technicians.map((entry) => entry.technician.user.name),
          warnings: pack.warnings,
        },
      })

      return {
        jobId: job.id,
        jobNumber: job.number,
        recipients: results,
        warnings: pack.warnings,
      }
    },
    client,
  )
}
