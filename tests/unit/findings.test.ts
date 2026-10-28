import { describe, expect, it } from 'vitest'
import {
  ALLOWED_FINDING_TRANSITIONS,
  FINDING_STATUSES,
  canMoveFinding,
  isFindingOpen,
  isUrgentSeverity,
  nextFindingStatuses,
  priorityForSeverity,
  updateFindingStatusSchema,
} from '@/lib/validation/findings'

/**
 * The finding flow (slice 16), as data. The service proves the database half; this pins the rules a
 * wrong edit would quietly loosen — a declined repair reopening, or a status form posting a decline
 * without the signature that makes it a record.
 */

describe('the finding status flow', () => {
  it('has a transition entry for every status', () => {
    for (const status of FINDING_STATUSES) {
      expect(ALLOWED_FINDING_TRANSITIONS[status], status).toBeDefined()
    }
  })

  it('only ever names statuses that exist', () => {
    for (const targets of Object.values(ALLOWED_FINDING_TRANSITIONS)) {
      for (const target of targets) expect(FINDING_STATUSES).toContain(target)
    }
  })

  it('treats rectified and declined as terminal', () => {
    expect(ALLOWED_FINDING_TRANSITIONS.RECTIFIED).toHaveLength(0)
    expect(ALLOWED_FINDING_TRANSITIONS.DECLINED_BY_CUSTOMER).toHaveLength(0)
  })

  it('lets an open finding go anywhere, and a quoted one to scheduled', () => {
    expect(nextFindingStatuses('OPEN')).toEqual(['QUOTED', 'SCHEDULED', 'RECTIFIED', 'DECLINED_BY_CUSTOMER'])
    expect(canMoveFinding('QUOTED', 'SCHEDULED')).toBe(true)
    expect(canMoveFinding('SCHEDULED', 'RECTIFIED')).toBe(true)
  })

  it('never reopens a closed finding', () => {
    expect(canMoveFinding('RECTIFIED', 'OPEN')).toBe(false)
    expect(canMoveFinding('DECLINED_BY_CUSTOMER', 'SCHEDULED')).toBe(false)
  })

  it('never moves a finding backwards', () => {
    expect(canMoveFinding('SCHEDULED', 'QUOTED')).toBe(false)
    expect(canMoveFinding('RECTIFIED', 'SCHEDULED')).toBe(false)
  })
})

describe('isFindingOpen', () => {
  it('counts quoted and scheduled as still owed an answer', () => {
    expect(isFindingOpen('OPEN')).toBe(true)
    expect(isFindingOpen('QUOTED')).toBe(true)
    expect(isFindingOpen('SCHEDULED')).toBe(true)
  })

  it('closes only on the two terminal states', () => {
    expect(isFindingOpen('RECTIFIED')).toBe(false)
    expect(isFindingOpen('DECLINED_BY_CUSTOMER')).toBe(false)
  })
})

describe('priorityForSeverity', () => {
  it('puts critical and major at P2, never P1', () => {
    // P1 raises a dispatch alert; the inspection that found the defect already returned the crane.
    expect(priorityForSeverity('CRITICAL')).toBe('P2')
    expect(priorityForSeverity('MAJOR')).toBe('P2')
    expect(isUrgentSeverity('CRITICAL')).toBe(true)
  })

  it('puts minor and observation at routine', () => {
    expect(priorityForSeverity('MINOR')).toBe('P3')
    expect(priorityForSeverity('OBSERVATION')).toBe('P3')
    expect(isUrgentSeverity('OBSERVATION')).toBe(false)
  })
})

describe('the status form', () => {
  it('accepts the three moves an office makes', () => {
    for (const status of ['QUOTED', 'SCHEDULED', 'RECTIFIED']) {
      expect(updateFindingStatusSchema.safeParse({ status }).success, status).toBe(true)
    }
  })

  it('refuses a decline, which needs a signature instead', () => {
    expect(updateFindingStatusSchema.safeParse({ status: 'DECLINED_BY_CUSTOMER' }).success).toBe(
      false,
    )
  })
})
