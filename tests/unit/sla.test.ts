import { describe, expect, it } from 'vitest'
import { addMinutes, slaState, ticketSla } from '@/server/sla/sla'

/**
 * SLA arithmetic, with no database and no wall clock. Every boundary here is a boundary somebody
 * will eventually argue about ("we responded at 10:31, not 10:30"), so they are pinned exactly.
 */

const START = new Date('2026-03-02T09:00:00.000Z')

describe('addMinutes', () => {
  it('adds calendar minutes across a day boundary', () => {
    expect(addMinutes(new Date('2026-03-02T23:50:00.000Z'), 30).toISOString()).toBe(
      '2026-03-03T00:20:00.000Z',
    )
  })

  it('returns a new date rather than mutating the input', () => {
    const at = new Date('2026-03-02T09:00:00.000Z')
    addMinutes(at, 60)
    expect(at.toISOString()).toBe('2026-03-02T09:00:00.000Z')
  })
})

describe('slaState', () => {
  const window = { startedAt: START, targetMinutes: 30, metAt: null }

  it('has no clock before anything starts', () => {
    const state = slaState({ ...window, startedAt: null }, START)
    expect(state).toEqual({ dueAt: null, state: 'on-time', remainingMs: null, elapsedMs: null })
  })

  it('is on time well before the deadline', () => {
    const state = slaState(window, new Date('2026-03-02T09:10:00.000Z'))
    expect(state.state).toBe('on-time')
    expect(state.dueAt?.toISOString()).toBe('2026-03-02T09:30:00.000Z')
    expect(state.remainingMs).toBe(20 * 60_000)
  })

  it('turns at risk inside the last fifth of the window', () => {
    // 30-minute target, 20% is six minutes. Six minutes left is at risk; six minutes and a second
    // is not.
    expect(slaState(window, new Date('2026-03-02T09:24:00.000Z')).state).toBe('at-risk')
    expect(slaState(window, new Date('2026-03-02T09:23:59.000Z')).state).toBe('on-time')
  })

  it('is breached the instant the deadline passes, with nothing left to count down', () => {
    const state = slaState(window, new Date('2026-03-02T09:30:00.000Z'))
    expect(state.state).toBe('breached')
    expect(state.remainingMs).toBe(0)
    expect(state.elapsedMs).toBe(0)
  })

  it('is met when the response lands before the deadline', () => {
    const state = slaState(
      { ...window, metAt: new Date('2026-03-02T09:12:00.000Z') },
      new Date('2026-03-02T09:20:00.000Z'),
    )
    expect(state.state).toBe('met')
    expect(state.elapsedMs).toBe(12 * 60_000)
  })

  it('stays breached when the response lands after the deadline', () => {
    // Recording a response does not undo the miss. The target is met or it is not.
    const state = slaState(
      { ...window, metAt: new Date('2026-03-02T09:45:00.000Z') },
      new Date('2026-03-02T10:00:00.000Z'),
    )
    expect(state.state).toBe('breached')
    expect(state.elapsedMs).toBe(45 * 60_000)
  })
})

describe('ticketSla', () => {
  const targets = { responseMinutes: 30, resolutionMinutes: 240 }
  const ticket = {
    priority: 'P1' as const,
    reportedAt: START,
    respondedAt: new Date('2026-03-02T09:20:00.000Z'),
    closedAt: null,
  }

  it('stops the response clock at triage and leaves resolution running', () => {
    const sla = ticketSla(ticket, targets, new Date('2026-03-02T11:00:00.000Z'))
    expect(sla.response.state).toBe('met')
    expect(sla.resolution.state).toBe('on-time')
    expect(sla.resolution.dueAt?.toISOString()).toBe('2026-03-02T13:00:00.000Z')
    expect(sla.targets).toEqual(targets)
  })

  it('stops the resolution clock at close', () => {
    const sla = ticketSla(
      { ...ticket, closedAt: new Date('2026-03-02T12:59:00.000Z') },
      targets,
      new Date('2026-03-03T09:00:00.000Z'),
    )
    expect(sla.resolution.state).toBe('met')
  })

  it('reports a resolution that ran past its target as breached even once closed', () => {
    const sla = ticketSla(
      { ...ticket, closedAt: new Date('2026-03-02T14:00:00.000Z') },
      targets,
      new Date('2026-03-02T15:00:00.000Z'),
    )
    expect(sla.resolution.state).toBe('breached')
  })
})
