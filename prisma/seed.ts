import {
  PrismaClient,
  type CraneStatus,
  type CraneType,
  type CustomerStatus,
  type Prisma,
  type Priority,
  type Role,
} from '@prisma/client'
import { nextDocumentNumber } from '../src/server/documents/sequence'
import { postMovement } from '../src/server/inventory/stock'
import { hashPassword } from '../src/server/auth/password'
import { DEFAULT_SLA_POLICIES } from '../src/server/sla/sla'
import { wallTimeToUtc } from '../src/lib/time'
import type { TemplateSection } from '../src/lib/templates/schema'
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

/** Demo accounts and the demo book share one answer: is this a development database? */
function demoDataAllowed(): boolean {
  return databaseIsLocal(process.env.DATABASE_URL) || process.env.SEED_DEMO_USERS === 'true'
}

/** Wall-clock time on the given day offset in the operating zone, so "tomorrow at 08:00" means that. */
function atLocal(timeZone: string, dayOffset: number, hour: number, minute = 0): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  const [year, month, day] = parts.split('-').map(Number) as [number, number, number]
  return wallTimeToUtc(year, month, day + dayOffset, hour, minute, timeZone)
}

async function seedUsers(): Promise<number> {
  // A known password on a reachable database is a back door. The question is not what NODE_ENV says —
  // `npm run seed` never sets it, so an env check silently passes — but where the data actually
  // lives. Anywhere other than this machine needs somebody to have asked for these accounts by name.
  if (!demoDataAllowed()) {
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

  const at = (dayOffset: number, hour: number, minute = 0): Date =>
    atLocal(timeZone, dayOffset, hour, minute)

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

// ---------------------------------------------------------------------------
// §13 demo book
// ---------------------------------------------------------------------------

interface DemoCrane {
  assetTag: string
  type: CraneType
  swlKg: number
  brand: string
  locationOnSite: string
  status?: CraneStatus
  restrictedReason?: string
}

interface DemoSite {
  name: string
  address: Record<string, string>
  accessNotes: string
  operatingHours: string
  cranes: DemoCrane[]
}

interface DemoCustomer {
  legalName: string
  tradingName: string
  uen: string
  status: CustomerStatus
  contact: { name: string; phone: string; email: string }
  sites: DemoSite[]
}

/**
 * The two customers `seedWork` already creates appear here only with the extra site each one gains,
 * because `seedWork` still owns their first site and cranes. That keeps this function additive: run
 * the seed twice and the estate is the same.
 */
const DEMO_CUSTOMERS: DemoCustomer[] = [
  {
    legalName: 'Jurong Port Engineering Pte Ltd',
    tradingName: 'Jurong Port Engineering',
    uen: '200812345K',
    status: 'ACTIVE',
    contact: { name: 'Mei Ling Tan', phone: '+65 9123 4567', email: 'meiling.tan@jurongport.example' },
    sites: [
      {
        name: 'Pioneer Yard',
        address: { line1: '45 Pioneer Sector 2', city: 'Singapore', postalCode: '628386' },
        accessNotes: 'Security pass required. Collect at the main gate with photo ID.',
        operatingHours: '08:00–17:00, Monday to Friday',
        cranes: [
          { assetTag: 'JPE-003', type: 'JIB', swlKg: 2000, brand: 'Demag', locationOnSite: 'Workshop bay' },
          { assetTag: 'JPE-004', type: 'OVERHEAD', swlKg: 5000, brand: 'Konecranes', locationOnSite: 'Press shop' },
        ],
      },
    ],
  },
  {
    legalName: 'Tuas Marine Works Pte Ltd',
    tradingName: 'Tuas Marine',
    uen: '201534567A',
    status: 'ACTIVE',
    contact: { name: 'Ramasamy Perumal', phone: '+65 9777 1234', email: 'ram@tuasmarine.example' },
    sites: [
      {
        name: 'Tuas Offshore Yard',
        address: { line1: '22 Tuas Crescent', city: 'Singapore', postalCode: '638732' },
        accessNotes: 'Hard hat, boots and life vest past the barrier.',
        operatingHours: '24 hours',
        cranes: [
          { assetTag: 'TMW-015', type: 'GANTRY', swlKg: 20000, brand: 'Liebherr', locationOnSite: 'Fabrication hall' },
          { assetTag: 'TMW-016', type: 'MOBILE', swlKg: 25000, brand: 'Tadano', locationOnSite: 'Laydown area' },
        ],
      },
    ],
  },
  {
    legalName: 'Sembawang Shipyard Services Pte Ltd',
    tradingName: 'Sembawang Shipyard',
    uen: '199803214D',
    status: 'ACTIVE',
    contact: { name: 'Goh Wei Ming', phone: '+65 9012 7788', email: 'wm.goh@sembawangship.example' },
    sites: [
      {
        name: 'Sembawang North Yard',
        address: { line1: '3 Admiralty Road West', city: 'Singapore', postalCode: '759945' },
        accessNotes: 'Induction at the yard office before the first visit.',
        operatingHours: '07:00–19:00, Monday to Saturday',
        cranes: [
          { assetTag: 'SSW-001', type: 'OVERHEAD', swlKg: 10000, brand: 'Konecranes', locationOnSite: 'Plate shop' },
          { assetTag: 'SSW-002', type: 'JIB', swlKg: 2000, brand: 'Demag', locationOnSite: 'Pipe spool bay' },
        ],
      },
      {
        name: 'Sembawang Dry Dock',
        address: { line1: '5 Admiralty Road West', city: 'Singapore', postalCode: '759946' },
        accessNotes: 'Dock master must be told before entering the dock floor.',
        operatingHours: '24 hours during docking',
        cranes: [
          { assetTag: 'SSW-003', type: 'GANTRY', swlKg: 40000, brand: 'Liebherr', locationOnSite: 'Dock floor' },
        ],
      },
    ],
  },
  {
    legalName: 'Keppel Logistics Hub Pte Ltd',
    tradingName: 'Keppel Logistics',
    uen: '201712345B',
    status: 'ACTIVE',
    contact: { name: 'Nur Aisyah', phone: '+65 8100 4433', email: 'aisyah@keppellogistics.example' },
    sites: [
      {
        name: 'Keppel Distribution Centre',
        address: { line1: '12 Keppel Road', city: 'Singapore', postalCode: '089057' },
        accessNotes: 'Sign in at the warehouse office; high-visibility vest provided.',
        operatingHours: '06:00–22:00 daily',
        cranes: [
          { assetTag: 'KLH-001', type: 'OVERHEAD', swlKg: 5000, brand: 'Konecranes', locationOnSite: 'Aisle 4' },
          { assetTag: 'KLH-002', type: 'OVERHEAD', swlKg: 5000, brand: 'Konecranes', locationOnSite: 'Aisle 9' },
        ],
      },
      {
        name: 'Keppel Container Yard',
        address: { line1: '18 Keppel Road', city: 'Singapore', postalCode: '089058' },
        accessNotes: 'Report to the yard control room. No entry during yard moves.',
        operatingHours: '24 hours',
        cranes: [
          {
            assetTag: 'KLH-003',
            type: 'GANTRY',
            swlKg: 35000,
            brand: 'ZPMC',
            locationOnSite: 'Block C',
            status: 'RESTRICTED',
            restrictedReason: 'Hoist brake overheating. Do not operate until the brake is replaced.',
          },
          { assetTag: 'KLH-004', type: 'MOBILE', swlKg: 16000, brand: 'Tadano', locationOnSite: 'Workshop apron' },
        ],
      },
    ],
  },
  {
    legalName: 'Pioneer Fabrication Pte Ltd',
    tradingName: 'Pioneer Fabrication',
    uen: '200912348E',
    status: 'DORMANT',
    contact: { name: 'Lim Chee Keong', phone: '+65 9333 2211', email: 'ck.lim@pioneerfab.example' },
    sites: [
      {
        name: 'Pioneer Works',
        address: { line1: '67 Pioneer Road', city: 'Singapore', postalCode: '639569' },
        accessNotes: 'Gate code changes monthly; call the contact before travelling.',
        operatingHours: '08:00–17:00, Monday to Friday',
        cranes: [
          { assetTag: 'PNF-001', type: 'OVERHEAD', swlKg: 12000, brand: 'Demag', locationOnSite: 'Main bay' },
          { assetTag: 'PNF-002', type: 'JIB', swlKg: 3000, brand: 'Demag', locationOnSite: 'Welding bay' },
        ],
      },
      {
        name: 'Pioneer Storage',
        address: { line1: '71 Pioneer Road', city: 'Singapore', postalCode: '639570' },
        accessNotes: 'No site office; the storeman signs for attendance.',
        operatingHours: '08:00–17:00, Monday to Friday',
        cranes: [{ assetTag: 'PNF-003', type: 'HOIST', swlKg: 1000, brand: 'Demag', locationOnSite: 'Racking bay' }],
      },
    ],
  },
  {
    legalName: 'Changi Ground Support Pte Ltd',
    tradingName: 'Changi Ground Support',
    uen: '201412349F',
    status: 'ACTIVE',
    contact: { name: 'Farah Abdullah', phone: '+65 8299 5511', email: 'farah@changiground.example' },
    sites: [
      {
        name: 'Changi Apron 3',
        address: { line1: '60 Airport Boulevard', city: 'Singapore', postalCode: '819643' },
        accessNotes: 'Airside pass and escort required. No vehicles past the red line.',
        operatingHours: '05:00–01:00 daily',
        cranes: [
          { assetTag: 'CGS-001', type: 'MOBILE', swlKg: 20000, brand: 'Liebherr', locationOnSite: 'Stand 312' },
          { assetTag: 'CGS-002', type: 'MOBILE', swlKg: 8000, brand: 'Tadano', locationOnSite: 'Stand 306' },
        ],
      },
      {
        name: 'Changi Cargo Terminal',
        address: { line1: '72 Airport Boulevard', city: 'Singapore', postalCode: '819644' },
        accessNotes: 'Sign in at the cargo office for an airside escort.',
        operatingHours: '24 hours',
        cranes: [{ assetTag: 'CGS-003', type: 'TOWER', swlKg: 6000, brand: 'Liebherr', locationOnSite: 'Cargo bay 2' }],
      },
    ],
  },
  {
    legalName: 'Benoi Offshore Engineering Pte Ltd',
    tradingName: 'Benoi Offshore',
    uen: '200512346G',
    status: 'DORMANT',
    contact: { name: 'Tan Kok Seng', phone: '+65 9777 6655', email: 'ks.tan@benoioffshore.example' },
    sites: [
      {
        name: 'Benoi Yard 1',
        address: { line1: '9 Benoi Road', city: 'Singapore', postalCode: '629886' },
        accessNotes: 'Induction card needed at the gate.',
        operatingHours: '07:00–18:00, Monday to Saturday',
        cranes: [
          { assetTag: 'BNO-001', type: 'GANTRY', swlKg: 50000, brand: 'ZPMC', locationOnSite: 'Block assembly' },
          { assetTag: 'BNO-002', type: 'OVERHEAD', swlKg: 15000, brand: 'Konecranes', locationOnSite: 'Pipe shop' },
        ],
      },
      {
        name: 'Benoi Yard 2',
        address: { line1: '11 Benoi Road', city: 'Singapore', postalCode: '629887' },
        accessNotes: 'Shared gate with Benoi Yard 1.',
        operatingHours: '07:00–18:00, Monday to Saturday',
        cranes: [{ assetTag: 'BNO-003', type: 'JIB', swlKg: 5000, brand: 'Demag', locationOnSite: 'Laydown area' }],
      },
      {
        name: 'Benoi Warehouse',
        address: { line1: '15 Benoi Road', city: 'Singapore', postalCode: '629888' },
        accessNotes: 'Forklift traffic; report to the store supervisor.',
        operatingHours: '08:00–17:00, Monday to Friday',
        cranes: [{ assetTag: 'BNO-004', type: 'HOIST', swlKg: 2000, brand: 'Demag', locationOnSite: 'Mezzanine' }],
      },
    ],
  },
  {
    legalName: 'Woodlands Precision Works Pte Ltd',
    tradingName: 'Woodlands Precision',
    uen: '202112347H',
    status: 'PROSPECT',
    contact: { name: 'Chua Hui Ling', phone: '+65 8888 9900', email: 'hl.chua@woodlandsprecision.example' },
    sites: [
      {
        name: 'Woodlands Plant',
        address: { line1: '2 Woodlands Industrial Park E1', city: 'Singapore', postalCode: '757719' },
        accessNotes: 'Prospect visit booked through the sales team.',
        operatingHours: '08:00–17:30, Monday to Friday',
        cranes: [{ assetTag: 'WPW-001', type: 'OVERHEAD', swlKg: 3200, brand: 'Konecranes', locationOnSite: 'Bay 1' }],
      },
      {
        name: 'Woodlands Annexe',
        address: { line1: '4 Woodlands Industrial Park E1', city: 'Singapore', postalCode: '757720' },
        accessNotes: 'Same contact as the plant.',
        operatingHours: '08:00–17:30, Monday to Friday',
        cranes: [{ assetTag: 'WPW-002', type: 'JIB', swlKg: 1000, brand: 'Demag', locationOnSite: 'Tool room' }],
      },
    ],
  },
]

const DEMO_HISTORY_MARKER = 'DEMO-HISTORY-'
const DEMO_HISTORY_JOBS = 30

/** Due dates walk forward by these days, so the compliance board has overdue, soon and distant rows. */
const DEMO_SCHEDULE_OFFSETS = [-21, 9, 24, 38, 55, 70, 96, 120, 150, 200]

/** part number, description, brand, uom, cost, sell, reorder level, opening quantity. */
const DEMO_PARTS: Array<[string, string, string, string, number, number, number, number]> = [
  ['WR-13-6X36', 'Wire rope 13 mm 6x36 IWRC galvanised', 'Bridon', 'm', 5.4, 9.8, 50, 22],
  ['WR-16-6X36', 'Wire rope 16 mm 6x36 IWRC galvanised', 'Bridon', 'm', 7.2, 12.9, 60, 18],
  ['WR-20-6X36', 'Wire rope 20 mm 6x36 IWRC galvanised', 'Bridon', 'm', 9.6, 17.4, 40, 55],
  ['WR-24-6X36', 'Wire rope 24 mm 6x36 IWRC galvanised', 'Bridon', 'm', 13.8, 24.5, 30, 32],
  ['HK-2T', 'Forged hook 2 t with safety latch', 'Gunnebo', 'pc', 88, 165, 6, 9],
  ['HK-5T', 'Forged hook 5 t with safety latch', 'Gunnebo', 'pc', 145, 268, 6, 7],
  ['HK-10T', 'Forged hook 10 t with safety latch', 'Gunnebo', 'pc', 310, 565, 4, 3],
  ['BLK-2T-SN', 'Snatch block 2 t, single sheave', 'Crosby', 'pc', 210, 385, 4, 6],
  ['BLK-5T-SN', 'Snatch block 5 t, single sheave', 'Crosby', 'pc', 395, 720, 3, 4],
  ['SHV-200', 'Sheave 200 mm with sealed bearing', 'Konecranes', 'pc', 64, 118, 8, 12],
  ['BRK-LIN-160', 'Brake lining 160 mm, pair', 'SIBRE', 'pair', 72, 132, 10, 14],
  ['BRK-LIN-200', 'Brake lining 200 mm, pair', 'SIBRE', 'pair', 96, 176, 10, 11],
  ['BRK-LIN-250', 'Brake lining 250 mm, pair', 'SIBRE', 'pair', 128, 235, 8, 2],
  ['BRK-DRUM-200', 'Brake drum 200 mm', 'SIBRE', 'pc', 265, 485, 4, 5],
  ['CON-24V-10', 'Contactor 24 V coil, 10 A', 'Schneider', 'pc', 48, 89, 12, 20],
  ['CON-240V-20', 'Contactor 240 V coil, 20 A', 'Schneider', 'pc', 96, 175, 8, 9],
  ['OLR-10T', 'Overload relay, 10 t hoist', 'Schneider', 'pc', 132, 242, 3, 4],
  ['OLR-25T', 'Overload relay, 25 t hoist', 'Schneider', 'pc', 208, 380, 2, 0],
  ['LS-ROT-1', 'Rotary limit switch 1:50', 'Stromag', 'pc', 186, 340, 4, 5],
  ['LS-LEVER', 'Lever limit switch, IP65', 'Telemecanique', 'pc', 42, 78, 10, 13],
  ['PEN-8B', 'Pendant station, 8 button', 'Konecranes', 'pc', 240, 440, 3, 4],
  ['PEN-6B', 'Pendant station, 6 button', 'Konecranes', 'pc', 198, 365, 3, 2],
  ['FES-WIRE', 'Festoon wire 4x2.5 mm²', 'Nexans', 'm', 11.5, 21, 100, 140],
  ['FES-TROLLEY', 'Festoon trolley 40 mm', 'Nexans', 'pc', 34, 62, 20, 26],
  ['BUF-100', 'Rubber end stop buffer 100 mm', 'Konecranes', 'pc', 18, 34, 20, 30],
  ['BUF-160', 'Rubber end stop buffer 160 mm', 'Konecranes', 'pc', 26, 48, 12, 4],
  ['WHL-250', 'Crane wheel 250 mm', 'Konecranes', 'pc', 320, 585, 4, 6],
  ['WHL-400', 'Crane wheel 400 mm', 'Konecranes', 'pc', 540, 980, 2, 3],
  ['BRG-22216', 'Spherical roller bearing 22216', 'SKF', 'pc', 78, 143, 6, 8],
  ['BRG-22220', 'Spherical roller bearing 22220', 'SKF', 'pc', 118, 215, 4, 1],
  ['GBX-OIL-EP220', 'Gear oil EP220, 20 L drum', 'Shell', 'drum', 96, 165, 4, 6],
  ['GRSE-EP2', 'Grease EP2, 400 g cartridge', 'Shell', 'cartridge', 9.8, 18, 36, 48],
  ['CLN-ELEC', 'Electrical contact cleaner, 500 ml', 'CRC', 'can', 14, 26, 12, 15],
  ['SLING-2T-2M', 'Webbing sling 2 t x 2 m', 'Yale', 'pc', 42, 76, 8, 10],
  ['SHCK-3T', 'Bow shackle 3.25 t, galvanised', 'Crosby', 'pc', 28, 52, 12, 16],
  ['CHAIN-5T', 'Load chain 5 t, per metre', 'Demag', 'm', 68, 124, 10, 12],
  ['REMOTE-4B', 'Radio remote, 4 button with receiver', 'Tele Radio', 'set', 720, 1320, 2, 3],
  ['PANEL-OH', 'Control panel enclosure, overhead crane', 'Konecranes', 'pc', 480, 880, 2, 1],
  ['LS-ROPE', 'Rope-operated limit switch', 'Stromag', 'pc', 96, 176, 6, 7],
  ['CLAMP-RAIL', 'Rail clamp, 40 mm rail', 'Konecranes', 'pc', 54, 98, 10, 11],
]

/** Every form answer a report of this template needs, so a seeded report reads like a real one. */
function demoAnswers(raw: unknown): Record<string, unknown> {
  const data: Record<string, unknown> = { checklist: {}, photoFileIds: [] }
  const schema = raw as { sections?: TemplateSection[] } | null
  for (const section of schema?.sections ?? []) {
    if (section.layout === 'table') {
      data[section.key] = []
      continue
    }
    for (const field of section.fields) {
      if (field.type === 'RADIO') data[field.key] = field.options?.[0] ?? ''
      else if (field.type === 'YES_NO') data[field.key] = 'Yes'
      else if (field.type === 'PASS_FAIL_NA') data[field.key] = 'Pass'
      else if (field.type === 'NUMBER') data[field.key] = 10
      else if (field.type === 'DATE') data[field.key] = '2026-01-15'
      else data[field.key] = 'Checked, adjusted and tested. No defects found.'
    }
  }
  return data
}

/**
 * The rest of the §13 demo estate: 8 customers, ~27 cranes, 30 closed jobs with issued reports, two
 * open P1 tickets and a parts store with a few lines below reorder.
 *
 * It sits on top of `seedWork` rather than replacing it, because `seedWork` only fills an *empty*
 * database and a development database that already has a customer would otherwise never gain the
 * book. Every row is looked up by a natural key (legal name, site name, asset tag, part number, a
 * marker in `internalNotes`) before it is created, so re-running the seed adds nothing twice.
 *
 * One wart, deliberately: the historical reports carry a document number but no stored PDF. The seed
 * runs under `tsx`, which cannot load `@react-pdf/renderer`'s hyphenation data, so there is no render
 * here. Approve one in the app and the PDF appears exactly as a real one would.
 *
 * Gated like the demo accounts: this is invented data and must never land in a real register.
 */
async function seedDemoBook(): Promise<void> {
  if (!demoDataAllowed()) {
    console.log('Skipping the demo book: the database is not on this machine. Set SEED_DEMO_USERS=true.')
    return
  }

  const settings = await db.setting.findUnique({ where: { key: 'timezone' } })
  const timeZone = typeof settings?.value === 'string' ? settings.value : 'Asia/Singapore'

  // --- customers, sites, cranes --------------------------------------------------------------

  let customersAdded = 0
  let cranesAdded = 0
  const craneTags: string[] = []

  for (const demo of DEMO_CUSTOMERS) {
    let customer = await db.customer.findFirst({
      where: { legalName: demo.legalName },
      select: { id: true },
    })
    if (!customer) {
      customer = await db.customer.create({
        data: {
          legalName: demo.legalName,
          tradingName: demo.tradingName,
          uen: demo.uen,
          status: demo.status,
        },
        select: { id: true },
      })
      customersAdded += 1
    }

    let firstSiteId: string | null = null
    for (const siteDemo of demo.sites) {
      let site = await db.site.findFirst({
        where: { customerId: customer.id, name: siteDemo.name },
        select: { id: true },
      })
      if (!site) {
        site = await db.site.create({
          data: {
            customerId: customer.id,
            name: siteDemo.name,
            address: siteDemo.address,
            accessNotes: siteDemo.accessNotes,
            operatingHours: siteDemo.operatingHours,
          },
          select: { id: true },
        })
      }
      firstSiteId ??= site.id

      for (const crane of siteDemo.cranes) {
        craneTags.push(crane.assetTag)
        const existing = await db.crane.findUnique({
          where: { assetTag: crane.assetTag },
          select: { id: true },
        })
        if (existing) continue
        await db.crane.create({
          data: {
            siteId: site.id,
            customerId: customer.id,
            assetTag: crane.assetTag,
            qrValue: crane.assetTag.toLowerCase(),
            type: crane.type,
            swlKg: crane.swlKg,
            brand: crane.brand,
            locationOnSite: crane.locationOnSite,
            status: crane.status ?? 'IN_SERVICE',
            restrictedReason: crane.restrictedReason ?? null,
            restrictedAt: crane.status === 'RESTRICTED' ? new Date() : null,
          },
        })
        cranesAdded += 1
      }
    }

    const contact = await db.contact.findFirst({
      where: { customerId: customer.id, name: demo.contact.name },
      select: { id: true },
    })
    if (!contact) {
      await db.contact.create({
        data: {
          customerId: customer.id,
          siteId: firstSiteId,
          name: demo.contact.name,
          role: 'SITE_CONTACT',
          phone: demo.contact.phone,
          email: demo.contact.email,
          isPrimary: true,
        },
      })
    }
  }

  console.log(
    `Demo book: ${customersAdded} customer(s) and ${cranesAdded} crane(s) added (${craneTags.length} in the book).`,
  )

  const cranes = await db.crane.findMany({
    where: { assetTag: { in: craneTags } },
    orderBy: { assetTag: 'asc' },
    select: { id: true, assetTag: true, siteId: true, customerId: true },
  })

  // --- crane schedules -----------------------------------------------------------------------

  const alreadyScheduled = new Set(
    (
      await db.craneSchedule.findMany({
        where: { craneId: { in: cranes.map((crane) => crane.id) } },
        select: { craneId: true, scheduleType: true },
      })
    ).map((row) => `${row.craneId}:${row.scheduleType}`),
  )

  let schedulesAdded = 0
  for (const [index, crane] of cranes.entries()) {
    const monthDue = atLocal(timeZone, DEMO_SCHEDULE_OFFSETS[index % DEMO_SCHEDULE_OFFSETS.length]!, 8)
    const yearDue = atLocal(
      timeZone,
      DEMO_SCHEDULE_OFFSETS[(index + 5) % DEMO_SCHEDULE_OFFSETS.length]!,
      8,
    )
    const rows = [
      { scheduleType: 'MONTHLY_SERVICE' as const, intervalMonths: 1, due: monthDue },
      { scheduleType: 'ANNUAL_EXAMINATION' as const, intervalMonths: 12, due: yearDue },
    ]
    for (const row of rows) {
      if (alreadyScheduled.has(`${crane.id}:${row.scheduleType}`)) continue
      await db.craneSchedule.create({
        data: {
          craneId: crane.id,
          scheduleType: row.scheduleType,
          intervalMonths: row.intervalMonths,
          lastDoneDate: new Date(row.due.getTime() - row.intervalMonths * 30 * 86_400_000),
          nextDueDate: row.due,
          notes: 'Demo schedule — intervals are configured rules in a real deployment.',
        },
      })
      schedulesAdded += 1
    }
  }
  if (schedulesAdded > 0) console.log(`Demo book: ${schedulesAdded} crane schedule(s).`)

  // --- 30 closed jobs with issued reports ------------------------------------------------------

  const jobTypes = await db.jobType.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    select: { id: true, name: true, defaultReportTemplateId: true },
  })
  const templateIds = jobTypes
    .map((jobType) => jobType.defaultReportTemplateId)
    .filter((id): id is string => Boolean(id))
  const templates = new Map(
    (
      await db.reportTemplate.findMany({
        where: { id: { in: templateIds } },
        select: { id: true, version: true, schema: true },
      })
    ).map((template) => [template.id, template]),
  )
  const technicians = await db.technician.findMany({
    orderBy: { employeeNo: 'asc' },
    select: { id: true, user: { select: { name: true } } },
  })
  const done = new Set(
    (
      await db.job.findMany({
        where: { internalNotes: { startsWith: DEMO_HISTORY_MARKER } },
        select: { internalNotes: true },
      })
    ).map((job) => job.internalNotes),
  )

  const statuses = ['CLOSED', 'INVOICED', 'REVIEWED', 'CLOSED'] as const
  const priorities: Priority[] = ['P3', 'P2', 'P4', 'P1']
  let jobsAdded = 0
  let reportsAdded = 0

  if (cranes.length > 0 && jobTypes.length > 0 && technicians.length > 0) {
    for (let index = 0; index < DEMO_HISTORY_JOBS; index += 1) {
      const marker = `${DEMO_HISTORY_MARKER}${index}`
      if (done.has(marker)) continue

      const jobType = jobTypes[index % jobTypes.length]!
      const crane = cranes[index % cranes.length]!
      const technician = technicians[index % technicians.length]!
      const day = -(12 + index * 8)
      const start = atLocal(timeZone, day, 9)
      const end = atLocal(timeZone, day, 12)
      const finished = atLocal(timeZone, day, 15)
      const status = statuses[index % statuses.length]!

      const number = await nextDocumentNumber(db, 'JOB', { timeZone })
      const job = await db.job.create({
        data: {
          number,
          jobTypeId: jobType.id,
          customerId: crane.customerId,
          siteId: crane.siteId,
          status,
          priority: priorities[index % priorities.length]!,
          description: `${jobType.name} — ${crane.assetTag}.`,
          internalNotes: marker,
          reportedAt: new Date(start.getTime() - 2 * 3_600_000),
          scheduledStart: start,
          scheduledEnd: end,
          slaResponseDue: start,
          slaResolveDue: finished,
          completedAt: finished,
          reviewedAt: finished,
          closedAt: status === 'CLOSED' ? finished : null,
          invoicedAt: status === 'INVOICED' ? finished : null,
        },
      })
      jobsAdded += 1

      await db.jobTechnician.create({
        data: { jobId: job.id, technicianId: technician.id, isLead: true, assignedAt: start },
      })
      await db.jobCrane.create({ data: { jobId: job.id, craneId: crane.id } })
      await db.jobStatusHistory.create({
        data: {
          jobId: job.id,
          fromStatus: 'COMPLETED',
          toStatus: status,
          reason: 'Demo history',
          changedAt: finished,
        },
      })

      const template = templates.get(jobType.defaultReportTemplateId ?? '')
      if (!template) continue
      const documentNumber = await nextDocumentNumber(db, 'REPORT', { timeZone })
      await db.report.create({
        data: {
          jobId: job.id,
          craneId: crane.id,
          templateId: template.id,
          templateVersion: template.version,
          data: demoAnswers(template.schema) as Prisma.InputJsonValue,
          status: 'APPROVED',
          safeToOperate: 'YES',
          documentNumber,
          submittedAt: finished,
          approvedAt: finished,
          technicianSignerName: technician.user.name,
          technicianSignedAt: finished,
          customerSignerName: 'Site supervisor',
          customerSignedAt: finished,
        },
      })
      reportsAdded += 1
    }
  }

  if (jobsAdded > 0) {
    console.log(`Demo book: ${jobsAdded} historical job(s) and ${reportsAdded} issued report(s).`)
  }

  // --- two open P1 tickets ---------------------------------------------------------------------

  const openTickets = [
    {
      assetTag: 'JPE-002',
      minutesAgo: 40,
      status: 'NEW' as const,
      description:
        'Long travel brake failed its test on JPE-002. Crane is tagged out; please attend today.',
      triageNotes: null,
    },
    {
      assetTag: 'KLH-003',
      minutesAgo: 150,
      status: 'TRIAGED' as const,
      description: 'Hoist brake overheating and smelling hot on KLH-003. Operator has stopped the block.',
      triageNotes: 'P1 confirmed. Parts team checking brake lining stock; technician to attend tonight.',
    },
  ]

  let ticketsAdded = 0
  for (const demo of openTickets) {
    // Looked up by tag rather than from `cranes`: one of these is a crane `seedWork` created, so it
    // is not in this function's own list.
    const crane = await db.crane.findUnique({
      where: { assetTag: demo.assetTag },
      select: { id: true, siteId: true, customerId: true },
    })
    if (!crane) continue
    const existing = await db.ticket.findFirst({
      where: { description: demo.description },
      select: { id: true },
    })
    if (existing) continue

    await db.ticket.create({
      data: {
        number: await nextDocumentNumber(db, 'TICKET', { timeZone }),
        source: 'PHONE',
        customerId: crane.customerId,
        siteId: crane.siteId,
        craneId: crane.id,
        description: demo.description,
        priority: 'P1',
        status: demo.status,
        reportedAt: new Date(Date.now() - demo.minutesAgo * 60_000),
        respondedAt: demo.status === 'TRIAGED' ? new Date(Date.now() - demo.minutesAgo * 30_000) : null,
        triageNotes: demo.triageNotes,
      },
    })
    ticketsAdded += 1
  }
  if (ticketsAdded > 0) console.log(`Demo book: ${ticketsAdded} open P1 ticket(s).`)

  // --- parts store -----------------------------------------------------------------------------

  let warehouse = await db.location.findFirst({
    where: { name: 'Main store', type: 'WAREHOUSE' },
    select: { id: true },
  })
  if (!warehouse) {
    warehouse = await db.location.create({
      data: { name: 'Main store', type: 'WAREHOUSE' },
      select: { id: true },
    })
  }

  const partsByNumber = new Map(
    (
      await db.part.findMany({
        where: { partNumber: { in: DEMO_PARTS.map(([partNumber]) => partNumber) } },
        select: { id: true, partNumber: true },
      })
    ).map((part) => [part.partNumber, part.id]),
  )
  const opened = new Set(
    (
      await db.stockMovement.findMany({
        where: { reasonCode: 'DEMO-OPENING' },
        select: { partId: true },
      })
    ).map((movement) => movement.partId),
  )

  let partsAdded = 0
  let belowReorder = 0
  for (const [partNumber, description, brand, uom, cost, sellPrice, reorderLevel, quantity] of DEMO_PARTS) {
    let partId = partsByNumber.get(partNumber)
    if (!partId) {
      const part = await db.part.create({
        data: {
          partNumber,
          description,
          brand,
          uom,
          cost,
          sellPrice,
          reorderLevel,
          reorderQty: reorderLevel * 2,
          leadTimeDays: 14,
          // Rope, hooks and chain are the parts brief §9 names as traced, so the serial screen has
          // something to show on a fresh database.
          trackSerialOrBatch: /^(WR|HK|CHAIN)-/.test(partNumber),
        },
        select: { id: true },
      })
      partId = part.id
      partsAdded += 1
    }

    if (quantity < reorderLevel) belowReorder += 1

    if (opened.has(partId)) continue
    // Through the one stock writer, so the seed opens the ledger and the level the same way the
    // receiving screen does (CLAUDE.md rule 10).
    await db.$transaction((tx) =>
      postMovement(tx, async () => {}, {
        partId,
        toLocationId: warehouse.id,
        quantity,
        type: 'RECEIVE',
        unitCost: cost,
        // A traced part's opening balance is a batch, so the serial trace has a receipt to read.
        serialOrBatch: /^(WR|HK|CHAIN)-/.test(partNumber)
          ? `DEMO-${partNumber}-001`
          : null,
        reasonCode: 'DEMO-OPENING',
        movedAt: atLocal(timeZone, -95, 10),
      }),
    )
  }
  console.log(
    `Demo book: ${partsAdded} part(s) added (${DEMO_PARTS.length} in the catalogue, ${belowReorder} below reorder level).`,
  )
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
  await seedDemoBook()
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
