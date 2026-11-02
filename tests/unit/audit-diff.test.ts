import { describe, expect, it } from 'vitest'
import { changedFields } from '@/server/audit/diff'

describe('changedFields', () => {
  it('records only the fields that changed', () => {
    const result = changedFields(
      { id: 'j1', status: 'SCHEDULED', priority: 'P3', description: 'Annual service' },
      { id: 'j1', status: 'IN_PROGRESS', priority: 'P3', description: 'Annual service' },
    )

    expect(result).toEqual({
      before: { status: 'SCHEDULED' },
      after: { status: 'IN_PROGRESS' },
    })
  })

  it('ignores updatedAt, which moves on every write', () => {
    const result = changedFields(
      { id: 'j1', updatedAt: new Date('2026-01-01T00:00:00Z') },
      { id: 'j1', updatedAt: new Date('2026-06-01T00:00:00Z') },
    )

    expect(result).toBeNull()
  })

  it('returns null when nothing changed, so no audit row is written', () => {
    expect(changedFields({ status: 'NEW' }, { status: 'NEW' })).toBeNull()
  })

  it('compares dates by value, not identity', () => {
    const result = changedFields(
      { scheduledStart: new Date('2026-03-01T01:00:00Z') },
      { scheduledStart: new Date('2026-03-01T01:00:00Z') },
    )

    expect(result).toBeNull()
  })

  it('detects a changed nested value', () => {
    const result = changedFields(
      { data: { hourMeter: 1200 } },
      { data: { hourMeter: 1240 } },
    )

    expect(result).toEqual({ before: { data: { hourMeter: 1200 } }, after: { data: { hourMeter: 1240 } } })
  })

  it('returns null when either side is missing', () => {
    expect(changedFields(null, { status: 'NEW' })).toBeNull()
    expect(changedFields({ status: 'NEW' }, undefined)).toBeNull()
  })

  it('detects a field being cleared to null', () => {
    const result = changedFields({ onHoldReason: 'WEATHER' }, { onHoldReason: null })

    expect(result).toEqual({ before: { onHoldReason: 'WEATHER' }, after: { onHoldReason: null } })
  })
})
