import { describe, expect, it } from 'vitest'
import type { JobStatus } from '@prisma/client'
import {
  ALLOWED_TRANSITIONS,
  JOB_STATUSES,
  ON_HOLD_REASONS,
  canTransition,
  isTerminal,
  nextStatuses,
  requiresOnHoldReason,
  timestampFieldFor,
} from '@/server/jobs/status'
import { JOB_STATUS_LABELS, ON_HOLD_REASON_LABELS } from '@/server/jobs/labels'
import {
  convertTicketSchema,
  createJobSchema,
  jobFilterSchema,
  transitionJobSchema,
} from '@/lib/validation/jobs'

/**
 * The job lifecycle, as rules rather than as a screen. These tests are the reason the transition form
 * can be trusted to offer only legal moves: the same map decides both.
 */

describe('the job lifecycle', () => {
  it('has a rule for every status', () => {
    for (const status of JOB_STATUSES) {
      expect(ALLOWED_TRANSITIONS[status]).toBeDefined()
    }
  })

  it('lets the ordinary path run from new to closed', () => {
    const path: JobStatus[] = [
      'NEW',
      'TRIAGED',
      'SCHEDULED',
      'DISPATCHED',
      'IN_PROGRESS',
      'COMPLETED',
      'REVIEWED',
      'INVOICED',
      'CLOSED',
    ]
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(canTransition(path[i]!, path[i + 1]!)).toBe(true)
    }
  })

  it('allows quote to be skipped for repeat work', () => {
    expect(canTransition('TRIAGED', 'SCHEDULED')).toBe(true)
    expect(canTransition('TRIAGED', 'QUOTED')).toBe(true)
  })

  it('refuses to skip from new straight to closed', () => {
    expect(canTransition('NEW', 'CLOSED')).toBe(false)
    expect(canTransition('NEW', 'COMPLETED')).toBe(false)
  })

  it('refuses to move a closed or cancelled job', () => {
    expect(ALLOWED_TRANSITIONS.CLOSED).toHaveLength(0)
    expect(ALLOWED_TRANSITIONS.CANCELLED).toHaveLength(0)
    expect(isTerminal('CLOSED')).toBe(true)
    expect(isTerminal('CANCELLED')).toBe(true)
    expect(isTerminal('INVOICED')).toBe(false)
  })

  it('reaches on hold from the field and leaves it back to the field', () => {
    expect(canTransition('SCHEDULED', 'ON_HOLD')).toBe(true)
    expect(canTransition('DISPATCHED', 'ON_HOLD')).toBe(true)
    expect(canTransition('IN_PROGRESS', 'ON_HOLD')).toBe(true)
    expect(canTransition('ON_HOLD', 'SCHEDULED')).toBe(true)
    expect(canTransition('ON_HOLD', 'IN_PROGRESS')).toBe(true)
  })

  it('allows rework from completed, but not from invoiced', () => {
    expect(canTransition('COMPLETED', 'IN_PROGRESS')).toBe(true)
    expect(canTransition('INVOICED', 'IN_PROGRESS')).toBe(false)
  })

  it('offers exactly the legal moves, and a status never offers itself', () => {
    for (const status of JOB_STATUSES) {
      const moves = nextStatuses(status)
      expect(moves).not.toContain(status)
      for (const move of moves) expect(canTransition(status, move)).toBe(true)
    }
  })

  it('requires a reason only when going on hold', () => {
    expect(requiresOnHoldReason('ON_HOLD')).toBe(true)
    expect(requiresOnHoldReason('IN_PROGRESS')).toBe(false)
    expect(ON_HOLD_REASONS).toContain('AWAITING_PARTS')
  })

  it('stamps a timestamp for every state that means something happened', () => {
    expect(timestampFieldFor('TRIAGED')).toBe('respondedAt')
    expect(timestampFieldFor('IN_PROGRESS')).toBe('onSiteAt')
    expect(timestampFieldFor('COMPLETED')).toBe('completedAt')
    expect(timestampFieldFor('REVIEWED')).toBe('reviewedAt')
    expect(timestampFieldFor('INVOICED')).toBe('invoicedAt')
    expect(timestampFieldFor('CLOSED')).toBe('closedAt')
    expect(timestampFieldFor('CANCELLED')).toBe('closedAt')
    expect(timestampFieldFor('SCHEDULED')).toBeNull()
    expect(timestampFieldFor('ON_HOLD')).toBeNull()
  })

  it('has a label and a description for every status and hold reason', () => {
    for (const status of JOB_STATUSES) {
      expect(JOB_STATUS_LABELS[status]).toBeTruthy()
    }
    for (const reason of ON_HOLD_REASONS) {
      expect(ON_HOLD_REASON_LABELS[reason]).toBeTruthy()
    }
  })
})

describe('job input', () => {
  it('accepts a job with no cranes and no site, leaving the service to resolve it', () => {
    const parsed = createJobSchema.safeParse({
      customerId: 'customer-1',
      jobTypeId: 'type-1',
      description: 'Annual service',
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.craneIds).toEqual([])
      expect(parsed.data.siteId).toBeNull()
      expect(parsed.data.priority).toBe('P3')
    }
  })

  it('normalises one crane from a single checkbox and deduplicates', () => {
    const parsed = createJobSchema.parse({
      customerId: 'customer-1',
      jobTypeId: 'type-1',
      craneIds: ['crane-1', 'crane-1', ''],
    })
    expect(parsed.craneIds).toEqual(['crane-1'])
  })

  it('requires a hold reason when the target is on hold, and refuses one otherwise', () => {
    const missing = transitionJobSchema.safeParse({ status: 'ON_HOLD' })
    expect(missing.success).toBe(false)

    const present = transitionJobSchema.safeParse({
      status: 'ON_HOLD',
      onHoldReason: 'AWAITING_PARTS',
    })
    expect(present.success).toBe(true)

    const stray = transitionJobSchema.safeParse({
      status: 'IN_PROGRESS',
      onHoldReason: 'WEATHER',
    })
    expect(stray.success).toBe(false)
  })

  it('treats an empty status or priority filter as no filter', () => {
    const parsed = jobFilterSchema.parse({ status: '', priority: '', q: '' })
    expect(parsed.status).toBeNull()
    expect(parsed.priority).toBeNull()
  })

  it('needs at least one job to convert a ticket', () => {
    expect(convertTicketSchema.safeParse({ jobs: [] }).success).toBe(false)
    expect(
      convertTicketSchema.safeParse({
        jobs: [{ jobTypeId: 'type-1', priority: 'P2', description: '' }],
      }).success,
    ).toBe(true)
  })
})
