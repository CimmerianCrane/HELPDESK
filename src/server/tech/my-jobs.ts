import type { Prisma } from '@prisma/client'
import { db, type Tx } from '@/lib/db'
import { templateSchema, type TemplateSchema } from '@/lib/templates/schema'
import { dayKey } from '@/lib/time'
import { ForbiddenError, NotFoundError } from '@/server/auth/errors'
import { assertCan } from '@/server/auth/permissions'
import { jobReadWhere, resourceReadWhere } from '@/server/auth/scope'
import type { AuthContext } from '@/server/auth/types'
import { getSettings } from '@/server/settings/settings'
import { checklistForJob, type ChecklistLine } from '@/server/templates/checklist'

/**
 * What a technician's phone reads.
 *
 * The office screens answer "what is going on across the company"; this answers "what am I doing",
 * and the difference is not only a filter. Everything here is chosen so the phone can work with no
 * signal in the back of a warehouse: the visit, how to get in, who to ask for, what is on the
 * machine already, and the checklist. Nothing that needs a live query to interpret.
 *
 * Row-level scope still does the real work — `jobReadWhere` narrows every query to the jobs this
 * technician is on — so this file cannot be talked into showing somebody else's work by passing an
 * id. The `assertCan` calls are for the capability half of the same rule.
 */

const OPEN_STATUSES = ['TRIAGED', 'SCHEDULED', 'DISPATCHED', 'IN_PROGRESS'] as const

export interface TechCrane {
  /** The report form records one report per crane, so the phone needs the id as well as the tag. */
  id: string
  assetTag: string
  /** The token on the printed label, so the QR scanner can match what the camera read (slice 44). */
  qrValue: string
  type: string
  swlKg: string
  status: string
  restrictedReason: string | null
  /** Newest first, so the phone shows what was last done before what was done before that. */
  recent: Array<{ kind: 'report' | 'certificate'; label: string; at: string }>
}

export interface TechJobSummary {
  id: string
  number: string
  status: string
  priority: string
  jobTypeName: string
  customerName: string
  siteName: string
  address: string | null
  scheduledStart: string | null
  scheduledEnd: string | null
  /** True when this technician is the lead — the one the customer is told to expect. */
  isLead: boolean
  cranes: Array<{ assetTag: string; status: string }>
  restricted: number
}

export type TechChecklistItem = ChecklistLine

export interface TechReportTemplate {
  id: string
  version: number
  name: string
  schema: TemplateSchema
}

export interface TechReportSummary {
  id: string
  craneId: string
  status: string
  submittedAt: string | null
}

export interface TechJobDetail extends TechJobSummary {
  description: string | null
  accessNotes: string | null
  inductionRequirements: string | null
  operatingHours: string | null
  contact: { name: string; role: string; phone: string | null; email: string | null } | null
  /** Other people on the same visit, so the technician knows who to meet. */
  crew: Array<{ name: string; isLead: boolean }>
  cranes: TechCrane[]
  /** The job type's fallback sheet. Kept for a bundle cached before slice 46. */
  checklist: TechChecklistItem[]
  /**
   * The sheet each crane actually uses, keyed by crane id. Optional so a bundle cached before slice
   * 46 still renders from `checklist`.
   */
  checklistByCraneId?: Record<string, TechChecklistItem[]>
  /** The report the technician fills in. Null when the job type has no template attached. */
  reportTemplate: TechReportTemplate | null
  /** A Service Report: every checklist line is graded 1–4 and commented, and it numbers `SR…`. */
  isServiceReport: boolean
  /** Already submitted for this job, so the phone can say so instead of offering a second one. */
  reports: TechReportSummary[]
  /** Everything the phone must say out loud before somebody climbs: restrictions, missing access. */
  warnings: string[]
}

export interface SyncBundle {
  /** When the server built this, so the phone can say how old its copy is. */
  generatedAt: string
  technicianName: string
  /**
   * The operating timezone. Sent with the data because a phone left on the browser's own zone would
   * show a Sydney-located technician different visit times from the office, and the office is right.
   */
  timeZone: string
  /** Full details, not summaries: a job cached without its access notes is not a cached job. */
  jobs: TechJobDetail[]
  /** Cranes on this technician's upcoming work, with what was last done to each. */
  cranes: TechCrane[]
  checklistItems: TechChecklistItem[]
  /**
   * `trackSerialOrBatch` rides along so the report form can require the serial on the parts that are
   * traced (slice 24) — the phone cannot ask the server once it is offline.
   */
  parts: Array<{
    partNumber: string
    description: string
    uom: string
    trackSerialOrBatch: boolean
  }>
  contacts: Array<{
    siteId: string
    name: string
    role: string
    phone: string | null
    email: string | null
  }>
  /**
   * Test weights, load cells and tools with a serial number, so a load test's instrument rows can be
   * checked against the calibration register with the radio off (brief §6.3). Scoped by
   * `resourceReadWhere`: a technician gets what is booked on their own jobs.
   */
  calibrationResources: Array<{
    name: string
    serialNumber: string
    /** `YYYY-MM-DD` in the operating timezone, or null when nobody has recorded one. */
    calibrationDue: string | null
  }>
}

/** Dates go over the wire as ISO strings: a phone's clock and a server's clock are not the same. */
function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null
}

/** The JSON address column, in one line somebody can paste into a maps app. */
function formatAddress(address: unknown): string | null {
  if (!address || typeof address !== 'object') return null
  const parts = ['line1', 'line2', 'city', 'postalCode']
    .map((key) => (address as Record<string, unknown>)[key])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
  return parts.length ? parts.join(', ') : null
}

const jobSelect = {
  id: true,
  number: true,
  status: true,
  priority: true,
  description: true,
  scheduledStart: true,
  scheduledEnd: true,
  jobType: {
    select: {
      id: true,
      name: true,
      isServiceReport: true,
      defaultChecklistTemplateId: true,
      defaultReportTemplateId: true,
    },
  },
  customer: { select: { legalName: true, tradingName: true } },
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
  cranes: {
    select: {
      crane: {
        select: {
          id: true,
          assetTag: true,
          qrValue: true,
          type: true,
          swlKg: true,
          status: true,
          restrictedReason: true,
        },
      },
    },
    orderBy: { crane: { assetTag: 'asc' } },
  },
  technicians: {
    select: {
      technicianId: true,
      isLead: true,
      technician: { select: { user: { select: { name: true } } } },
    },
  },
} satisfies Prisma.JobSelect

type JobRow = Prisma.JobGetPayload<{ select: typeof jobSelect }>

/**
 * A technician login without a technician record cannot be scoped, so it is refused rather than
 * shown everything. The office roles hit this too — they have the capability but no field identity,
 * and the phone is not their screen.
 */
function technicianOf(context: AuthContext): string {
  assertCan(context, 'job.read.own')
  if (!context.technicianId) {
    throw new ForbiddenError('Only a field technician has a job list on the phone.')
  }
  return context.technicianId
}

async function historyFor(
  client: Tx,
  craneIds: string[],
): Promise<Map<string, TechCrane['recent']>> {
  if (craneIds.length === 0) return new Map()

  // Capped per crane rather than globally: a machine with thirty years of history must not push the
  // others off the phone's cache.
  const [reports, certificates] = await Promise.all([
    client.report.findMany({
      where: { craneId: { in: craneIds } },
      orderBy: { createdAt: 'desc' },
      take: craneIds.length * 5,
      select: { craneId: true, status: true, createdAt: true, template: { select: { name: true } } },
    }),
    client.certificate.findMany({
      where: { craneId: { in: craneIds }, deletedAt: null, issueDate: { not: null } },
      orderBy: { issueDate: 'desc' },
      take: craneIds.length * 5,
      select: { craneId: true, issueDate: true, type: true, certificateNumber: true },
    }),
  ])

  const byCrane = new Map<string, TechCrane['recent']>()
  for (const report of reports) {
    const list = byCrane.get(report.craneId) ?? []
    list.push({
      kind: 'report',
      label: `${report.template.name} — ${report.status.toLowerCase()}`,
      at: report.createdAt.toISOString(),
    })
    byCrane.set(report.craneId, list)
  }
  for (const certificate of certificates) {
    if (!certificate.issueDate) continue
    const list = byCrane.get(certificate.craneId) ?? []
    list.push({
      kind: 'certificate',
      label: `${certificate.type} certificate${certificate.certificateNumber ? ` ${certificate.certificateNumber}` : ''}`,
      at: certificate.issueDate.toISOString(),
    })
    byCrane.set(certificate.craneId, list)
  }
  for (const [craneId, list] of byCrane) {
    byCrane.set(
      craneId,
      list.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5),
    )
  }
  return byCrane
}

/** One job, as the phone shows it. */
async function toDetail(
  row: JobRow,
  technicianId: string,
  client: Tx,
): Promise<TechJobDetail> {
  const history = await historyFor(
    client,
    row.cranes.map((entry) => entry.crane.id),
  )

  const [checklists, templateRow, reports] = await Promise.all([
    checklistForJob(
      client,
      row.jobType,
      row.cranes.map(({ crane }) => crane.type),
    ),
    row.jobType.defaultReportTemplateId
      ? client.reportTemplate.findUnique({
          where: { id: row.jobType.defaultReportTemplateId },
          select: { id: true, version: true, name: true, schema: true },
        })
      : Promise.resolve(null),
    client.report.findMany({
      where: { jobId: row.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, craneId: true, status: true, submittedAt: true },
    }),
  ])

  // A template that no longer parses is shown as absent rather than crashing the whole sync. The
  // form then says the office needs to check it, which is the actionable truth.
  const parsedTemplate = templateRow ? templateSchema.safeParse(templateRow.schema) : null
  const reportTemplate: TechReportTemplate | null =
    templateRow && parsedTemplate?.success
      ? {
          id: templateRow.id,
          version: templateRow.version,
          name: templateRow.name,
          schema: parsedTemplate.data,
        }
      : null

  const cranes: TechCrane[] = row.cranes.map(({ crane }) => ({
    id: crane.id,
    assetTag: crane.assetTag,
    qrValue: crane.qrValue,
    type: crane.type,
    swlKg: crane.swlKg.toString(),
    status: crane.status,
    restrictedReason: crane.restrictedReason,
    recent: history.get(crane.id) ?? [],
  }))

  const warnings: string[] = []
  for (const crane of cranes) {
    if (crane.status === 'RESTRICTED') {
      warnings.push(
        `${crane.assetTag} is flagged Do Not Operate${crane.restrictedReason ? `: ${crane.restrictedReason}` : '.'}`,
      )
    }
  }
  if (!row.site.accessNotes) warnings.push('No access notes are recorded for this site.')
  const contact = row.site.contacts[0] ?? null
  if (!contact?.phone) warnings.push('No phone number is recorded for anybody at this site.')

  const checklistByCraneId: Record<string, TechChecklistItem[]> = {}
  for (const { crane } of row.cranes) {
    checklistByCraneId[crane.id] = checklists.byType.get(crane.type) ?? checklists.fallback
  }

  const mine = row.technicians.find((entry) => entry.technicianId === technicianId)

  return {
    id: row.id,
    number: row.number,
    status: row.status,
    priority: row.priority,
    jobTypeName: row.jobType.name,
    customerName: row.customer.tradingName ?? row.customer.legalName,
    siteName: row.site.name,
    address: formatAddress(row.site.address),
    scheduledStart: iso(row.scheduledStart),
    scheduledEnd: iso(row.scheduledEnd),
    isLead: mine?.isLead ?? false,
    cranes,
    restricted: cranes.filter((crane) => crane.status === 'RESTRICTED').length,
    description: row.description,
    accessNotes: row.site.accessNotes,
    inductionRequirements: row.site.inductionRequirements,
    operatingHours: row.site.operatingHours,
    contact,
    crew: row.technicians.map((entry) => ({
      name: entry.technician.user.name,
      isLead: entry.isLead,
    })),
    checklist: checklists.fallback,
    checklistByCraneId,
    reportTemplate,
    isServiceReport: row.jobType.isServiceReport,
    reports: reports.map((report) => ({
      id: report.id,
      craneId: report.craneId,
      status: report.status,
      submittedAt: iso(report.submittedAt),
    })),
    warnings,
  }
}

/**
 * The technician's own work, open jobs only.
 *
 * Closed and cancelled visits are not fetched: the phone is a work list, not an archive, and a
 * technician's cache should not carry a year of finished jobs it will never read.
 */
export async function myJobs(
  context: AuthContext,
  client: Tx = db,
): Promise<TechJobSummary[]> {
  const technicianId = technicianOf(context)

  const rows = await client.job.findMany({
    where: {
      ...jobReadWhere(context),
      status: { in: [...OPEN_STATUSES] },
    },
    select: jobSelect,
    // Soonest first: the next visit is the one being looked at from the van.
    orderBy: [{ scheduledStart: 'asc' }, { priority: 'asc' }, { createdAt: 'asc' }],
    take: 100,
  })

  return rows.map((row) => {
    const mine = row.technicians.find((entry) => entry.technicianId === technicianId)
    const cranes = row.cranes.map(({ crane }) => crane)
    return {
      id: row.id,
      number: row.number,
      status: row.status,
      priority: row.priority,
      jobTypeName: row.jobType.name,
      customerName: row.customer.tradingName ?? row.customer.legalName,
      siteName: row.site.name,
      address: formatAddress(row.site.address),
      scheduledStart: iso(row.scheduledStart),
      scheduledEnd: iso(row.scheduledEnd),
      isLead: mine?.isLead ?? false,
      cranes: cranes.map((crane) => ({ assetTag: crane.assetTag, status: crane.status })),
      restricted: cranes.filter((crane) => crane.status === 'RESTRICTED').length,
    }
  })
}

/** One job. A job this technician is not on does not exist as far as this call is concerned. */
export async function technicianJob(
  context: AuthContext,
  jobId: string,
  client: Tx = db,
): Promise<TechJobDetail> {
  const technicianId = technicianOf(context)

  const row = await client.job.findFirst({
    where: { id: jobId, ...jobReadWhere(context) },
    select: jobSelect,
  })
  // Named plainly rather than "forbidden": a technician's phone should not confirm that a job they
  // are not on exists, which is a small thing and free to get right.
  if (!row) throw new NotFoundError('No such job.')

  return toDetail(row, technicianId, client)
}

/**
 * Everything the phone caches in one call.
 *
 * One request rather than six: a technician opening the app at a barrier wants it to have finished
 * before they have walked to the office. The parts list is deliberately small — a field technician
 * needs to identify a part, not to see the warehouse valuation — and contacts are limited to the
 * sites they are actually attending.
 */
export async function syncBundle(context: AuthContext, client: Tx = db): Promise<SyncBundle> {
  const technicianId = technicianOf(context)

  const rows = await client.job.findMany({
    where: {
      ...jobReadWhere(context),
      status: { in: [...OPEN_STATUSES] },
    },
    select: jobSelect,
    orderBy: [{ scheduledStart: 'asc' }, { priority: 'asc' }, { createdAt: 'asc' }],
    take: 100,
  })

  const details = await Promise.all(rows.map((row) => toDetail(row, technicianId, client)))

  const craneById = new Map<string, TechCrane>()
  for (const detail of details) {
    for (const crane of detail.cranes) craneById.set(crane.assetTag, crane)
  }

  const siteIds = [...new Set(rows.map((row) => row.site.id))]
  const [settings, parts, contacts, resources] = await Promise.all([
    getSettings(client),
    client.part.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: { partNumber: 'asc' },
      take: 300,
      select: {
        partNumber: true,
        description: true,
        uom: true,
        trackSerialOrBatch: true,
      },
    }),
    siteIds.length > 0
      ? client.contact.findMany({
          where: { siteId: { in: siteIds }, deletedAt: null },
          orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
          select: { siteId: true, name: true, role: true, phone: true, email: true },
        })
      : Promise.resolve([]),
    client.resource.findMany({
      where: {
        ...resourceReadWhere(context),
        type: { in: ['TEST_WEIGHT', 'LOAD_CELL', 'TOOL'] },
        serialNumber: { not: null },
        status: { not: 'RETIRED' },
      },
      orderBy: { name: 'asc' },
      take: 200,
      select: { name: true, serialNumber: true, calibrationDueDate: true },
    }),
  ])

  // Several jobs share a sheet — send each item once. The per-crane lists carry the crane-specific
  // sheets, which the fallback alone would miss.
  const checklistByCode = new Map<string, TechChecklistItem>()
  for (const detail of details) {
    for (const item of detail.checklist) checklistByCode.set(item.code, item)
    for (const list of Object.values(detail.checklistByCraneId ?? {})) {
      for (const item of list) checklistByCode.set(item.code, item)
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    technicianName: context.name,
    timeZone: settings.timezone,
    jobs: details,
    cranes: [...craneById.values()],
    checklistItems: [...checklistByCode.values()],
    parts,
    contacts: contacts.map((contact) => ({
      siteId: contact.siteId ?? '',
      name: contact.name,
      role: contact.role,
      phone: contact.phone,
      email: contact.email,
    })),
    calibrationResources: resources.map((resource) => ({
      name: resource.name,
      serialNumber: resource.serialNumber!,
      // A calibration date is a day, not an instant: read in the office's zone so a +8 date does not
      // print as the day before, the same way every other date on the phone is formatted.
      calibrationDue: resource.calibrationDueDate
        ? dayKey(resource.calibrationDueDate, settings.timezone)
        : null,
    })),
  }
}

/** How many jobs are still open on this technician — the number on the badge. */
export async function myJobCount(context: AuthContext, client: Tx = db): Promise<number> {
  technicianOf(context)
  return client.job.count({
    where: { ...jobReadWhere(context), status: { in: [...OPEN_STATUSES] } },
  })
}
