import { db } from '@/lib/db'
import { errorMessage, logger } from '@/lib/logger'
import { emailAdapter } from '@/server/email/email'

/**
 * The retry pass for the one thing approval does outside its transaction: the customer email.
 *
 * `approvedAt` set and `emailedToCustomerAt` null is the complete definition of "approved but not
 * told". Nothing else queues this work, and the daily cron is the only caller — there is no worker
 * process on Vercel (CLAUDE.md, deployment notes).
 */
export async function resendUnemailedReports(limit = 20): Promise<number> {
  const reports = await db.report.findMany({
    where: {
      status: { in: ['APPROVED', 'AMENDED'] },
      approvedAt: { not: null },
      emailedToCustomerAt: null,
    },
    orderBy: { approvedAt: 'asc' },
    take: limit,
    select: {
      id: true,
      documentNumber: true,
      approvedAt: true,
      job: {
        select: {
          number: true,
          customer: {
            select: {
              legalName: true,
              tradingName: true,
              contacts: {
                where: { deletedAt: null, email: { not: null } },
                orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
                select: { email: true },
                take: 1,
              },
            },
          },
        },
      },
    },
  })

  const adapter = emailAdapter()
  let sent = 0

  for (const report of reports) {
    const to = report.job.customer.contacts[0]?.email
    if (!to) continue

    try {
      const result = await adapter.send({
        to,
        subject: `Report ${report.documentNumber} — ${report.job.number}`,
        text: [
          `${report.job.customer.tradingName ?? report.job.customer.legalName},`,
          '',
          `The report for job ${report.job.number} has been approved and issued.`,
          `Document number: ${report.documentNumber}.`,
          '',
          'This is a company inspection report; it is not a statutory certificate of test and examination.',
        ].join('\n'),
      })
      if (!result.ok) continue

      await db.report.update({
        where: { id: report.id },
        data: { emailedToCustomerAt: new Date() },
      })
      sent += 1
    } catch (error) {
      logger.warn('report.email-retry.failed', { reportId: report.id, error: errorMessage(error) })
    }
  }

  return sent
}
