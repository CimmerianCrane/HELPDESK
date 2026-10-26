import { PrismaClient, type Role } from '@prisma/client'
import { nextDocumentNumber } from '../src/server/documents/sequence'
import { hashPassword } from '../src/server/auth/password'
import { DEFAULT_SLA_POLICIES } from '../src/server/sla/sla'
import { wallTimeToUtc } from '../src/lib/time'
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

/**
 * A day's worth of real work for the demo: customers, sites, cranes, contacts and scheduled jobs.
 *
 * Only ever seeded into an *empty* database. Once the office has entered a customer of its own,
 * anything this function added would be indistinguishable from their data — a demo crane at a demo
 * site, sitting in with the real register. The count is the guard, not a flag somebody can forget to
 * remove.
 *
 * Dates are relative to the day the seed runs, in the operating timezone, so the phone and the
 * board are never empty no matter when somebody first opens the app.
 */
async function seedWork(): Promise<void> {
  if ((await db.customer.count()) > 0) return

  const technicians = await db.technician.findMany({
    select: { id: true, employeeNo: true },
  })
  const ahmad = technicians.find((entry) => entry.employeeNo === 'T-001')
  const raj = technicians.find((entry) => entry.employeeNo === 'T-002')
  if (!ahmad || !raj) return

  const settings = await db.setting.findUnique({ where: { key: 'timezone' } })
  const timeZone = typeof settings?.value === 'string' ? settings.value : 'Asia/Singapore'

  const jobType = async (code: string) => {
    const row = await db.jobType.findUnique({ where: { code }, select: { id: true } })
    if (!row) throw new Error(`Seed needs the ${code} job type; run the template seed first.`)
    return row.id
  }

  const pmType = await jobType('PM')
  const breakdownType = await jobType('BREAKDOWN')
  const inspectionType = await jobType('VISUAL_INSPECTION')
  const loadTestType = await jobType('LOAD_TEST')

  const customers = [
    {
      legalName: 'Jurong Port Engineering Pte Ltd',
      tradingName: 'Jurong Port Engineering',
      uen: '200812345K',
      site: {
        name: 'Jurong Pier Works',
        address: { line1: '31 Jurong Pier Road', city: 'Singapore', postalCode: '619195' },
        accessNotes: 'Report to the guardhouse on the left of the gate. Bring photo ID.',
        inductionRequirements: 'Site induction (15 min) before the first visit.',
        operatingHours: '07:00–18:00, Monday to Saturday',
      },
      contact: {
        name: 'Mei Ling Tan',
        role: 'SITE_CONTACT' as const,
        phone: '+65 9123 4567',
        email: 'meiling.tan@jurongport.example',
      },
      cranes: [
        {
          assetTag: 'JPE-001',
          type: 'OVERHEAD' as const,
          swlKg: 10000,
          brand: 'Konecranes',
          locationOnSite: 'Bay 3, north aisle',
          status: 'IN_SERVICE' as const,
        },
        {
          assetTag: 'JPE-002',
          type: 'GANTRY' as const,
          swlKg: 25000,
          brand: 'Demag',
          locationOnSite: 'Container yard',
          status: 'RESTRICTED' as const,
          restrictedReason: 'Long travel brake failed its test. Do not operate until rectified.',
        },
      ],
    },
    {
      legalName: 'Tuas Marine Works Pte Ltd',
      tradingName: 'Tuas Marine',
      uen: '201534567A',
      site: {
        name: 'Tuas Yard',
        address: { line1: '8 Tuas Avenue 12', city: 'Singapore', postalCode: '639601' },
        accessNotes: 'Hard hat and safety boots required past the barrier.',
        inductionRequirements: null,
        operatingHours: '24 hours',
      },
      contact: {
        name: 'Ramasamy Perumal',
        role: 'SITE_CONTACT' as const,
        phone: '+65 9777 1234',
        email: 'ram@tuasmarine.example',
      },
      cranes: [
        {
          assetTag: 'TMW-014',
          type: 'MOBILE' as const,
          swlKg: 40000,
          brand: 'Liebherr',
          locationOnSite: 'Quay 2',
          status: 'IN_SERVICE' as const,
        },
      ],
    },
  ]

  const created: Array<{ craneIds: string[]; siteId: string; customerId: string }> = []

  for (const customer of customers) {
    const customerRow = await db.customer.create({
      data: {
        legalName: customer.legalName,
        tradingName: customer.tradingName,
        uen: customer.uen,
        status: 'ACTIVE',
      },
    })

    const site = await db.site.create({
      data: {
        customerId: customerRow.id,
        name: customer.site.name,
        address: customer.site.address,
        accessNotes: customer.site.accessNotes,
        inductionRequirements: customer.site.inductionRequirements,
        operatingHours: customer.site.operatingHours,
      },
    })

    await db.contact.create({
      data: {
        customerId: customerRow.id,
        siteId: site.id,
        name: customer.contact.name,
        role: customer.contact.role,
        phone: customer.contact.phone,
        email: customer.contact.email,
        isPrimary: true,
      },
    })

    const craneIds: string[] = []
    for (const crane of customer.cranes) {
      const craneRow = await db.crane.create({
        data: {
          siteId: site.id,
          customerId: customerRow.id,
          assetTag: crane.assetTag,
          qrValue: crane.assetTag.toLowerCase(),
          type: crane.type,
          swlKg: crane.swlKg,
          brand: crane.brand,
          locationOnSite: crane.locationOnSite,
          status: crane.status,
          restrictedReason: 'restrictedReason' in crane ? crane.restrictedReason : null,
          restrictedAt: crane.status === 'RESTRICTED' ? new Date() : null,
        },
      })
      craneIds.push(craneRow.id)
    }

    created.push({ craneIds, siteId: site.id, customerId: customerRow.id })
  }

  // Wall-clock times in the operating zone on the given day offset, so "tomorrow at 08:00" means
  // that wherever the seed is run from.
  const at = (dayOffset: number, hour: number, minute = 0): Date => {
    const today = new Date()
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(today)
    const [year, month, day] = parts.split('-').map(Number) as [number, number, number]
    return wallTimeToUtc(year, month, day + dayOffset, hour, minute, timeZone)
  }

  const jobs = [
    {
      customer: 0,
      craneIndex: 0,
      jobTypeId: pmType,
      technicianId: ahmad.id,
      status: 'SCHEDULED' as const,
      priority: 'P3' as const,
      description:
        'Annual PM on the bay 3 overhead crane: brake adjustment, wire rope inspection, limit switches.',
      start: at(1, 8),
      end: at(1, 11),
    },
    {
      customer: 1,
      craneIndex: 0,
      jobTypeId: breakdownType,
      technicianId: ahmad.id,
      status: 'DISPATCHED' as const,
      priority: 'P1' as const,
      description:
        'Hoist will not lift above half load. Operator reports a burning smell from the panel.',
      start: at(0, 14),
      end: at(0, 17),
    },
    {
      customer: 0,
      craneIndex: 0,
      jobTypeId: inspectionType,
      technicianId: raj.id,
      status: 'SCHEDULED' as const,
      priority: 'P4' as const,
      description: 'Six-monthly visual inspection, crane 1.',
      start: at(2, 9),
      end: at(2, 11),
    },
    {
      customer: 1,
      craneIndex: 0,
      jobTypeId: loadTestType,
      technicianId: raj.id,
      status: 'SCHEDULED' as const,
      priority: 'P3' as const,
      description: 'Proof load test at 125% SWL with the 40 t weight set.',
      start: at(3, 9),
      end: at(3, 13),
    },
  ]

  for (const job of jobs) {
    const target = created[job.customer]
    if (!target) continue
    const craneId = target.craneIds[job.craneIndex]

    const number = await nextDocumentNumber(db, 'JOB', { timeZone })
    const jobRow = await db.job.create({
      data: {
        number,
        jobTypeId: job.jobTypeId,
        customerId: target.customerId,
        siteId: target.siteId,
        status: job.status,
        priority: job.priority,
        description: job.description,
        scheduledStart: job.start,
        scheduledEnd: job.end,
      },
    })

    await db.jobTechnician.create({
      data: { jobId: jobRow.id, technicianId: job.technicianId, isLead: true },
    })

    if (craneId) {
      await db.jobCrane.create({ data: { jobId: jobRow.id, craneId } })
    }
  }

  console.log(`Seeded ${customers.length} demo customer(s) and ${jobs.length} demo job(s).`)
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
  await seedWork()
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
