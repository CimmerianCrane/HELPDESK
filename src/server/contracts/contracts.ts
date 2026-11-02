import type { ContractType, Priority, Prisma } from '@prisma/client'
import { db, type Tx } from '@/lib/db'
import {
  createContractSchema,
  renewalState,
  RENEWAL_WINDOW_DAYS,
  slaOverridesFrom,
  updateContractSchema,
  type ContractInput,
  type RenewalState,
  type SlaTarget,
} from '@/lib/validation/contracts'
import { parseInput } from '@/lib/validation/parse'
import { withAudit } from '@/server/audit/audit'
import { NotFoundError, ValidationError } from '@/server/auth/errors'
import { assertCan } from '@/server/auth/permissions'
import { craneReadWhere, customerReadWhere } from '@/server/auth/scope'
import type { AuthContext } from '@/server/auth/types'

/**
 * A customer's contracts (brief §5, §8; Phase 4, slice 29).
 *
 * The contract is where the per-customer SLA numbers live. They are written as `SlaPolicy` rows
 * carrying the contract's id — the table `resolveSlaTargets` already reads at job creation — rather
 * than into `Contract.slaOverrides`, which stays unused: two records of the same negotiated number
 * can only disagree, and a job snapshots its deadline from whichever one it read.
 *
 * Reads follow the customer (`customer.read`), writes are `sla.manage`: a contract is an agreed
 * target, and the capability that has guarded targets since Phase 1 is the one that should guard
 * these. A contract is retired, never deleted, because jobs and tickets keep naming it.
 */

export interface ContractSummary {
  id: string
  type: ContractType
  reference: string | null
  startDate: Date | null
  endDate: Date | null
  renewalDate: Date | null
  renewal: RenewalState
  includedVisits: number | null
  scopeNotes: string | null
  coveredCranes: Array<{ id: string; assetTag: string }>
  /** Only the priorities this contract overrides; anything absent follows the company-wide row. */
  targets: Partial<Record<Priority, SlaTarget>>
}

const contractSelect = {
  id: true,
  type: true,
  reference: true,
  startDate: true,
  endDate: true,
  renewalDate: true,
  includedVisits: true,
  scopeNotes: true,
  coveredCranes: {
    where: { deletedAt: null },
    select: { id: true, assetTag: true },
    orderBy: { assetTag: 'asc' },
  },
} satisfies Prisma.ContractSelect

type ContractRow = Prisma.ContractGetPayload<{ select: typeof contractSelect }>
type Targets = Partial<Record<Priority, SlaTarget>>

function toSummary(
  row: ContractRow,
  targets: Targets,
  now: Date = new Date(),
): ContractSummary {
  return {
    id: row.id,
    type: row.type,
    reference: row.reference,
    startDate: row.startDate,
    endDate: row.endDate,
    renewalDate: row.renewalDate,
    renewal: renewalState(row.renewalDate, now),
    includedVisits: row.includedVisits,
    scopeNotes: row.scopeNotes,
    coveredCranes: row.coveredCranes,
    targets,
  }
}

function auditShape(row: ContractRow, targets: Targets) {
  return {
    type: row.type,
    reference: row.reference,
    startDate: row.startDate,
    endDate: row.endDate,
    renewalDate: row.renewalDate,
    includedVisits: row.includedVisits,
    scopeNotes: row.scopeNotes,
    coveredCranes: row.coveredCranes.map((crane) => crane.assetTag),
    targets,
  }
}

/** The customer must be one the caller may read — the same 404-for-forbidden rule as every read. */
async function assertCustomerVisible(
  client: Tx,
  context: AuthContext,
  customerId: string,
): Promise<void> {
  const customer = await client.customer.findFirst({
    where: { id: customerId, ...customerReadWhere(context) },
    select: { id: true },
  })
  if (!customer) throw new NotFoundError('No such customer.')
}

/**
 * The contract may only cover cranes this customer actually has. Checked against the database, not
 * the form: a tampered `coveredCraneIds` would otherwise attach another customer's crane.
 */
async function liveCraneIds(
  client: Tx,
  context: AuthContext,
  customerId: string,
  ids: readonly string[],
): Promise<string[]> {
  if (ids.length === 0) return []
  const rows = await client.crane.findMany({
    where: { id: { in: [...ids] }, customerId, ...craneReadWhere(context) },
    select: { id: true },
  })
  if (rows.length !== ids.length) {
    throw new ValidationError({
      coveredCraneIds: ['Only this customer’s live cranes can be covered.'],
    })
  }
  return rows.map((row) => row.id)
}

/** The contract's targets, replaced in one go: rows for blank priorities are removed, not zeroed. */
async function writeTargets(client: Tx, contractId: string, input: ContractInput): Promise<void> {
  await client.slaPolicy.deleteMany({ where: { contractId } })
  const rows = (Object.entries(slaOverridesFrom(input)) as Array<[Priority, SlaTarget]>).map(
    ([priority, target]) => ({
      priority,
      contractId,
      responseMinutes: target.responseMinutes,
      resolutionMinutes: target.resolutionMinutes,
      isActive: true,
    }),
  )
  if (rows.length > 0) await client.slaPolicy.createMany({ data: rows })
}

async function targetsFor(
  client: Tx,
  contractIds: readonly string[],
): Promise<Map<string, Targets>> {
  const byContract = new Map<string, Targets>()
  if (contractIds.length === 0) return byContract

  const rows = await client.slaPolicy.findMany({
    where: { contractId: { in: [...contractIds] }, isActive: true },
    select: { contractId: true, priority: true, responseMinutes: true, resolutionMinutes: true },
  })
  for (const row of rows) {
    if (!row.contractId) continue
    const targets = byContract.get(row.contractId) ?? {}
    targets[row.priority] = {
      responseMinutes: row.responseMinutes,
      resolutionMinutes: row.resolutionMinutes,
    }
    byContract.set(row.contractId, targets)
  }
  return byContract
}

/** The one contract row a write is allowed to touch, or 404 if it is not this customer's. */
async function findContract(
  client: Tx,
  context: AuthContext,
  customerId: string,
  contractId: string,
): Promise<ContractRow> {
  const row = await client.contract.findFirst({
    where: {
      id: contractId,
      customerId,
      deletedAt: null,
      customer: customerReadWhere(context),
    },
    select: contractSelect,
  })
  if (!row) throw new NotFoundError('No such contract.')
  return row
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The customer's live contracts, newest term first — the Contracts panel on the customer page. */
export async function listCustomerContracts(
  context: AuthContext,
  customerId: string,
  client: Tx = db,
  now: Date = new Date(),
): Promise<ContractSummary[]> {
  assertCan(context, 'customer.read')

  const rows = await client.contract.findMany({
    where: { customerId, deletedAt: null, customer: customerReadWhere(context) },
    select: contractSelect,
    // An undated contract sorts below the dated ones rather than above them (Postgres puts NULL first
    // in DESC).
    orderBy: [{ startDate: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
  })
  const targets = await targetsFor(client, rows.map((row) => row.id))

  return rows.map((row) => toSummary(row, targets.get(row.id) ?? {}, now))
}

/** The cranes a contract may cover: this customer's live cranes the caller can see. */
export async function contractCraneOptions(
  context: AuthContext,
  customerId: string,
  client: Tx = db,
): Promise<Array<{ id: string; assetTag: string }>> {
  assertCan(context, 'customer.read')

  return client.crane.findMany({
    where: { customerId, ...craneReadWhere(context) },
    select: { id: true, assetTag: true },
    orderBy: { assetTag: 'asc' },
  })
}

export interface RenewalRow {
  id: string
  type: ContractType
  reference: string | null
  renewalDate: Date
  /** Whole UTC days until the renewal; negative once it has passed. */
  daysUntil: number
  state: Exclude<RenewalState, 'none'>
  customer: { id: string; legalName: string }
}

/**
 * Every live contract renewing inside the window or already overdue, soonest first — the queue that
 * answers "what runs out next" (slice 30, brief §8).
 *
 * The renewal date is a stored fact; "due" and "overdue" are the derived opinion `renewalState`
 * already gives the customer page, so the two screens cannot disagree about the same contract. The
 * window is applied in the query as well as by `renewalState` so a long-lived contract never enters
 * the list just to be filtered out.
 *
 * Scoped by `customerReadWhere` like every other customer read. It rides on `customer.read` because
 * it sits on the customer list; a role without that capability is refused outright by `assertCan`,
 * as `listCustomers` is, rather than silently seeing an empty board.
 */
export async function listUpcomingRenewals(
  context: AuthContext,
  client: Tx = db,
  now: Date = new Date(),
): Promise<RenewalRow[]> {
  assertCan(context, 'customer.read')

  const horizon = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) +
      RENEWAL_WINDOW_DAYS * 86_400_000,
  )

  const rows = await client.contract.findMany({
    where: {
      deletedAt: null,
      renewalDate: { not: null, lte: horizon },
      customer: customerReadWhere(context),
    },
    select: {
      id: true,
      type: true,
      reference: true,
      renewalDate: true,
      customer: { select: { id: true, legalName: true } },
    },
    orderBy: { renewalDate: 'asc' },
  })

  return rows.flatMap((row) => {
    const renewalDate = row.renewalDate!
    const state = renewalState(renewalDate, now)
    if (state === 'none') return []
    return [
      {
        id: row.id,
        type: row.type,
        reference: row.reference,
        renewalDate,
        state,
        daysUntil: Math.round(
          (Date.UTC(
            renewalDate.getUTCFullYear(),
            renewalDate.getUTCMonth(),
            renewalDate.getUTCDate(),
          ) -
            Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) /
            86_400_000,
        ),
        customer: row.customer,
      },
    ]
  })
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createContract(
  context: AuthContext,
  customerId: string,
  raw: unknown,
  client: Tx = db,
): Promise<ContractSummary> {
  assertCan(context, 'sla.manage')
  const input = parseInput(createContractSchema, raw)

  return withAudit(
    context,
    async (tx, log) => {
      await assertCustomerVisible(tx, context, customerId)
      const craneIds = await liveCraneIds(tx, context, customerId, input.coveredCraneIds)

      const row = await tx.contract.create({
        data: {
          customerId,
          type: input.type,
          reference: input.reference,
          startDate: input.startDate,
          endDate: input.endDate,
          renewalDate: input.renewalDate,
          includedVisits: input.includedVisits,
          scopeNotes: input.scopeNotes,
          coveredCranes: { connect: craneIds.map((id) => ({ id })) },
        },
        select: contractSelect,
      })
      await writeTargets(tx, row.id, input)

      const targets = slaOverridesFrom(input)
      await log({
        entity: 'Contract',
        entityId: row.id,
        action: 'CREATE',
        after: auditShape(row, targets),
      })
      return toSummary(row, targets)
    },
    client,
  )
}

export async function updateContract(
  context: AuthContext,
  customerId: string,
  contractId: string,
  raw: unknown,
  client: Tx = db,
): Promise<ContractSummary> {
  assertCan(context, 'sla.manage')
  const input = parseInput(updateContractSchema, raw)

  return withAudit(
    context,
    async (tx, log) => {
      const before = await findContract(tx, context, customerId, contractId)
      const craneIds = await liveCraneIds(tx, context, customerId, input.coveredCraneIds)
      const beforeTargets = (await targetsFor(tx, [before.id])).get(before.id) ?? {}

      const row = await tx.contract.update({
        where: { id: before.id },
        data: {
          type: input.type,
          reference: input.reference,
          startDate: input.startDate,
          endDate: input.endDate,
          renewalDate: input.renewalDate,
          includedVisits: input.includedVisits,
          scopeNotes: input.scopeNotes,
          coveredCranes: { set: craneIds.map((id) => ({ id })) },
        },
        select: contractSelect,
      })
      await writeTargets(tx, row.id, input)

      const targets = slaOverridesFrom(input)
      await log({
        entity: 'Contract',
        entityId: row.id,
        action: 'UPDATE',
        before: auditShape(before, beforeTargets),
        after: auditShape(row, targets),
      })
      return toSummary(row, targets)
    },
    client,
  )
}

/**
 * Retire, never delete: jobs and tickets raised under this contract keep naming it. A retired
 * contract stops being picked for new jobs (`insertJob` filters `deletedAt: null`), so its SLA rows
 * are left in place as the record of what was agreed.
 */
export async function retireContract(
  context: AuthContext,
  customerId: string,
  contractId: string,
  client: Tx = db,
): Promise<void> {
  assertCan(context, 'sla.manage')

  await withAudit(
    context,
    async (tx, log) => {
      const before = await findContract(tx, context, customerId, contractId)
      const beforeTargets = (await targetsFor(tx, [before.id])).get(before.id) ?? {}

      await tx.contract.update({
        where: { id: before.id },
        data: { deletedAt: new Date() },
      })
      await log({
        entity: 'Contract',
        entityId: before.id,
        action: 'DELETE',
        before: auditShape(before, beforeTargets),
      })
    },
    client,
  )
}
