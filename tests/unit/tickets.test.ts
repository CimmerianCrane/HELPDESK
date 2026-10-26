import { describe, expect, it } from 'vitest'
import {
  closeTicketSchema,
  createTicketSchema,
  ticketFilterSchema,
  triageTicketSchema,
  updateTicketSchema,
} from '@/lib/validation/tickets'

/**
 * Ticket input rules. These run at the trust boundary for every caller — form, action or handler —
 * so the defaults and coercions here are the ones the service actually receives.
 */

const base = {
  source: 'PHONE' as const,
  customerId: 'customer-1',
  description: 'Crane will not hoist above 2 m.',
}

describe('createTicketSchema', () => {
  it('defaults an untriaged ticket to P3 and to no site or crane', () => {
    const parsed = createTicketSchema.parse(base)
    expect(parsed.priority).toBe('P3')
    expect(parsed.siteId).toBeNull()
    expect(parsed.craneId).toBeNull()
    expect(parsed.triageNotes).toBeNull()
  })

  it('treats an empty site or crane string as not provided', () => {
    const parsed = createTicketSchema.parse({ ...base, siteId: '', craneId: '' })
    expect(parsed.siteId).toBeNull()
    expect(parsed.craneId).toBeNull()
  })

  it('requires a description and a customer', () => {
    expect(createTicketSchema.safeParse({ ...base, description: '' }).success).toBe(false)
    expect(createTicketSchema.safeParse({ ...base, description: '   ' }).success).toBe(false)
    expect(createTicketSchema.safeParse({ ...base, customerId: '' }).success).toBe(false)
  })

  it('rejects a source it does not know', () => {
    expect(createTicketSchema.safeParse({ ...base, source: 'CARRIER_PIGEON' }).success).toBe(false)
  })

  it('rejects a priority outside P1–P4', () => {
    expect(createTicketSchema.safeParse({ ...base, priority: 'P0' }).success).toBe(false)
  })
})

describe('triageTicketSchema', () => {
  it('defaults to triaged once a priority is set', () => {
    expect(triageTicketSchema.parse({ priority: 'P2' }).status).toBe('TRIAGED')
  })

  it('allows sending a ticket back to the queue, but not closing it by triage', () => {
    expect(triageTicketSchema.safeParse({ priority: 'P2', status: 'NEW' }).success).toBe(true)
    expect(triageTicketSchema.safeParse({ priority: 'P2', status: 'CLOSED' }).success).toBe(false)
    expect(triageTicketSchema.safeParse({ priority: 'P2', status: 'CONVERTED' }).success).toBe(false)
  })
})

describe('updateTicketSchema', () => {
  it('still requires the description — a ticket with no words is not a record of a call', () => {
    expect(updateTicketSchema.safeParse({ description: '' }).success).toBe(false)
  })
})

describe('closeTicketSchema', () => {
  it('accepts closed or cancelled, and nothing else', () => {
    expect(closeTicketSchema.safeParse({ outcome: 'CLOSED' }).success).toBe(true)
    expect(closeTicketSchema.safeParse({ outcome: 'CANCELLED' }).success).toBe(true)
    expect(closeTicketSchema.safeParse({ outcome: 'TRIAGED' }).success).toBe(false)
  })

  it('makes the note optional and empty means absent', () => {
    expect(closeTicketSchema.parse({ outcome: 'CLOSED', note: '' }).note).toBeNull()
  })
})

describe('ticketFilterSchema', () => {
  it('turns the empty strings a GET form sends into "no filter"', () => {
    const parsed = ticketFilterSchema.parse({ q: '', status: '', priority: '', customerId: '' })
    expect(parsed).toEqual({ q: '', status: null, priority: null, customerId: '' })
  })

  it('keeps a real status and priority', () => {
    const parsed = ticketFilterSchema.parse({ status: 'NEW', priority: 'P1' })
    expect(parsed.status).toBe('NEW')
    expect(parsed.priority).toBe('P1')
  })

  it('rejects a status that is not one of the five', () => {
    expect(ticketFilterSchema.safeParse({ status: 'PENDING' }).success).toBe(false)
  })
})
