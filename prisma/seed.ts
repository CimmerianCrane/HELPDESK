import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

/**
 * Seeds operational settings only. Demo data (customers, cranes, jobs, technicians, parts) is added
 * in the slice that builds each entity, so the seed always matches what the app can actually do.
 *
 * Idempotent: safe to run repeatedly. Settings already edited by the office team are left alone.
 */
async function main() {
  const defaults: Array<{ key: string; value: unknown; description: string }> = [
    {
      key: 'timezone',
      value: process.env.DEFAULT_TIMEZONE ?? 'Asia/Singapore',
      description: 'Operating timezone. All timestamps are stored in UTC and displayed in this zone.',
    },
    {
      key: 'currency',
      value: process.env.DEFAULT_CURRENCY ?? 'SGD',
      description: 'Currency used on quotes and invoices.',
    },
    {
      key: 'gstRate',
      value: Number(process.env.DEFAULT_GST_RATE ?? 0.09),
      description: 'GST rate applied to new invoice lines. Snapshotted onto each invoice when issued.',
    },
    {
      key: 'reminderOffsetsDays',
      value: [90, 60, 30],
      description: 'Days before a crane schedule due date that reminders are sent, then overdue.',
    },
    {
      key: 'autoCreateDraftJobs',
      value: false,
      description: 'Create draft jobs automatically when a crane schedule falls due.',
    },
    {
      key: 'gpsCheckIn',
      value: false,
      description: 'Record technician GPS coordinates on check-in and check-out.',
    },
    {
      key: 'blockAssignmentOnExpiredCompetency',
      value: false,
      description:
        'Block assignment of a technician whose required competency has expired. When false, warn only.',
    },
    {
      key: 'complianceNotice',
      value:
        'Rules are configured by your team. Verify against current MOM requirements with your Authorised Examiner.',
      description: 'Standing notice shown on the compliance rules admin screen (brief §7.4).',
    },
  ]

  for (const setting of defaults) {
    await db.setting.upsert({
      where: { key: setting.key },
      create: { key: setting.key, value: setting.value as never, description: setting.description },
      update: { description: setting.description },
    })
  }

  console.log(`Seeded ${defaults.length} settings.`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
