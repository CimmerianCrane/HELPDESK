import { PrismaClient, type Role } from '@prisma/client'
import { hashPassword } from '../src/server/auth/password'

const db = new PrismaClient()

/**
 * Seeds operational settings and demo accounts. Demo data for other entities (customers, cranes,
 * jobs, parts) is added in the slice that builds each one, so the seed always matches what the app
 * can actually do.
 *
 * Idempotent: safe to run repeatedly. Settings already edited by the office team are left alone, and
 * an existing account's password is never reset by re-running this.
 */

interface DemoUser {
  email: string
  name: string
  role: Role
  employeeNo?: string
}

/**
 * One account per role, and two technicians — two is the minimum that makes the "a technician cannot
 * see another technician's jobs" rule demonstrable by signing in and looking.
 *
 * `.example` is a reserved TLD, so these can never accidentally reach a real mailbox.
 */
const DEMO_USERS: DemoUser[] = [
  { email: 'admin@cimmeriancrane.example', name: 'Alice Tan', role: 'ADMIN' },
  { email: 'dispatch@cimmeriancrane.example', name: 'Bernard Lim', role: 'DISPATCHER' },
  { email: 'ahmad@cimmeriancrane.example', name: 'Ahmad Ismail', role: 'TECHNICIAN', employeeNo: 'T-001' },
  { email: 'raj@cimmeriancrane.example', name: 'Raj Kumar', role: 'TECHNICIAN', employeeNo: 'T-002' },
  { email: 'store@cimmeriancrane.example', name: 'Siti Rahman', role: 'STOREKEEPER' },
  { email: 'finance@cimmeriancrane.example', name: 'Daniel Wong', role: 'FINANCE' },
]

/** Override with SEED_PASSWORD to avoid the well-known demo password. */
const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? 'cimmerian-dev-2026'

/**
 * Is this database on the machine running the seed?
 *
 * The demo password is published in this repository, so it is only harmless somewhere a stranger
 * cannot reach. A URL we cannot parse counts as somewhere else.
 */
function databaseIsLocal(url: string | undefined): boolean {
  if (!url) return false
  try {
    const { hostname } = new URL(url)
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  } catch {
    return false
  }
}

async function seedUsers(): Promise<number> {
  // A known password on a reachable database is a back door. The question is not what NODE_ENV says —
  // `npm run seed` never sets it, so an env check silently passes — but where the data actually
  // lives. Anywhere other than this machine needs somebody to have asked for these accounts by name.
  if (!databaseIsLocal(process.env.DATABASE_URL) && process.env.SEED_DEMO_USERS !== 'true') {
    console.log(
      'Skipping demo accounts: the database is not on this machine.\n' +
        '  They would all share a password published in this repository.\n' +
        '  Set SEED_DEMO_USERS=true if this really is a development database.',
    )
    return 0
  }

  let created = 0

  for (const demo of DEMO_USERS) {
    const existing = await db.user.findUnique({
      where: { email: demo.email },
      select: { id: true },
    })
    if (existing) continue

    const user = await db.user.create({
      data: {
        email: demo.email,
        name: demo.name,
        role: demo.role,
        passwordHash: await hashPassword(DEMO_PASSWORD),
      },
    })

    if (demo.role === 'TECHNICIAN') {
      await db.technician.create({
        data: { userId: user.id, employeeNo: demo.employeeNo, colour: demo.employeeNo === 'T-001' ? '#2563eb' : '#16a34a' },
      })
    }

    created += 1
  }

  if (created > 0) {
    console.log(
      `\n  Seeded ${created} demo account(s). Password for all of them: ${DEMO_PASSWORD}\n` +
        '  These are development accounts. Before this system is used for real work, change every\n' +
        '  password or delete the accounts — a password in a seed file is a published password.\n',
    )
  }

  return created
}

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
  await seedUsers()
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
