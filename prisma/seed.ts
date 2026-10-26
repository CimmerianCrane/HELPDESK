import { PrismaClient, type Role } from '@prisma/client'
import { hashPassword } from '../src/server/auth/password'
import { DEFAULT_SLA_POLICIES } from '../src/server/sla/sla'
import { seedJobTypesAndTemplates } from './seed-templates'

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

/**
 * Company-wide SLA targets. Contract overrides are created by the office, not by the seed — but every
 * priority needs a default, or a timer would have nothing to count down from.
 *
 * `findFirst` rather than `upsert`: the unique key is `[priority, contractId]` and Postgres treats
 * every NULL `contractId` as distinct, so the database will happily hold two identical "company-wide"
 * rows. Only the first one is meaningful, and a re-run of the seed must not add a second.
 */
async function seedSlaPolicies(): Promise<number> {
  let created = 0
  for (const policy of DEFAULT_SLA_POLICIES) {
    const existing = await db.slaPolicy.findFirst({
      where: { priority: policy.priority, contractId: null },
      select: { id: true },
    })
    if (existing) continue

    await db.slaPolicy.create({
      data: {
        priority: policy.priority,
        contractId: null,
        responseMinutes: policy.responseMinutes,
        resolutionMinutes: policy.resolutionMinutes,
      },
    })
    created += 1
  }
  return created
}

/**
 * What the scheduling demo needs to be worth looking at: technicians who can and cannot do particular
 * work, kit that can be booked, and somebody on call this week.
 *
 * Competencies are attached by employee number rather than by account email, so the demo still works
 * if the office renamed a technician's login. One is seeded already expired on purpose — the board
 * and the assignment form both have an expired-competency state that is otherwise impossible to see.
 */
async function seedScheduling(): Promise<void> {
  const technicians = await db.technician.findMany({
    select: { id: true, employeeNo: true },
  })
  if (technicians.length === 0) return

  const competencies: Record<string, Array<{ name: string; expiryDate: Date | null }>> = {
    'T-001': [
      { name: 'Crane servicing', expiryDate: new Date('2028-06-30T00:00:00.000Z') },
      { name: 'Crane inspection', expiryDate: new Date('2027-11-30T00:00:00.000Z') },
      { name: 'Rigging', expiryDate: new Date('2027-03-31T00:00:00.000Z') },
    ],
    'T-002': [
      { name: 'Crane servicing', expiryDate: new Date('2027-09-30T00:00:00.000Z') },
      // Deliberately in the past: the assignment form should show this, and the setting decides
      // whether it blocks or merely warns.
      { name: 'Load testing', expiryDate: new Date('2025-12-31T00:00:00.000Z') },
    ],
  }

  let added = 0
  for (const technician of technicians) {
    const wanted = competencies[technician.employeeNo ?? ''] ?? []
    const existing = await db.competency.findMany({
      where: { technicianId: technician.id },
      select: { name: true },
    })
    const have = new Set(existing.map((entry) => entry.name))
    for (const competency of wanted) {
      if (have.has(competency.name)) continue
      await db.competency.create({
        data: {
          technicianId: technician.id,
          name: competency.name,
          issuer: 'Demo record — replace with the real certificate',
          expiryDate: competency.expiryDate,
        },
      })
      added += 1
    }
  }
  if (added > 0) console.log(`Seeded ${added} technician competency record(s).`)

  const resources: Array<{
    name: string
    type: 'VEHICLE' | 'TEST_WEIGHT' | 'LOAD_CELL' | 'TOOL'
    serialNumber: string | null
    calibrationDueDate: Date | null
  }> = [
    { name: 'Van 1 — flatbed', type: 'VEHICLE', serialNumber: null, calibrationDueDate: null },
    { name: 'Van 2 — box body', type: 'VEHICLE', serialNumber: null, calibrationDueDate: null },
    {
      name: 'Test weight set — 1 t',
      type: 'TEST_WEIGHT',
      serialNumber: 'TW-1000-04',
      calibrationDueDate: new Date('2027-04-30T00:00:00.000Z'),
    },
    {
      name: 'Test weight set — 5 t',
      type: 'TEST_WEIGHT',
      serialNumber: 'TW-5000-02',
      // Overdue on purpose, so the calibration warning has something to fire on.
      calibrationDueDate: new Date('2026-08-31T00:00:00.000Z'),
    },
    {
      name: 'Load cell — 10 t',
      type: 'LOAD_CELL',
      serialNumber: 'LC-10T-11',
      calibrationDueDate: new Date('2027-01-31T00:00:00.000Z'),
    },
    {
      name: 'Torque wrench set',
      type: 'TOOL',
      serialNumber: 'TWQ-07',
      calibrationDueDate: new Date('2027-02-28T00:00:00.000Z'),
    },
  ]

  let resourceCount = 0
  for (const resource of resources) {
    const existing = await db.resource.findFirst({
      where: { name: resource.name, type: resource.type },
      select: { id: true },
    })
    if (existing) continue
    await db.resource.create({
      data: {
        name: resource.name,
        type: resource.type,
        serialNumber: resource.serialNumber,
        calibrationDueDate: resource.calibrationDueDate,
      },
    })
    resourceCount += 1
  }
  if (resourceCount > 0) console.log(`Seeded ${resourceCount} bookable resource(s).`)

  // On-call: the next seven days, alternating, with a deliberate handover overlap. Only seeded when
  // the roster is empty — a live roster is the office's, not the seed's.
  if ((await db.onCallShift.count()) > 0) return

  const now = new Date()
  const startOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  )
  let shifts = 0
  for (let day = 0; day < 7; day += 1) {
    const technician = technicians[day % technicians.length]
    if (!technician) continue
    const from = new Date(startOfToday.getTime() + (day * 24 + 18) * 3_600_000)
    // An hour of overlap with the next person, so the gap calculation has a real merge to do.
    const to = new Date(startOfToday.getTime() + ((day + 1) * 24 + 19) * 3_600_000)
    await db.onCallShift.create({
      data: { technicianId: technician.id, startAt: from, endAt: to, notes: 'Demo roster' },
    })
    shifts += 1
  }
  console.log(`Seeded ${shifts} on-call shift(s).`)
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
  await seedJobTypesAndTemplates(db)

  const policies = await seedSlaPolicies()
  if (policies > 0) console.log(`Seeded ${policies} SLA policies.`)

  await seedUsers()
  await seedScheduling()
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
