import { PrismaClient } from '@prisma/client'
import { test as base, expect } from '@playwright/test'

/**
 * Every test starts with a clean sign-in throttle.
 *
 * Sign-in is rate limited per address (30 attempts per 15 minutes) and deliberately does not reset
 * that bucket on success, so one valid login cannot buy more guesses. An end-to-end run signs in far
 * more often than a person would, from 127.0.0.1 only, and now takes about as long as the window
 * itself — so a bucket cleared once at the start of the suite runs out before the last tests and
 * fails them on the throttle rather than on anything the application does wrong.
 *
 * This runs outside the app, against the database directly, and touches only the throttle table.
 */
const db = new PrismaClient()

export const test = base.extend<{ throttleReset: void }>({
  throttleReset: [
    async ({}, use) => {
      await db.rateLimitBucket.deleteMany({})
      await use()
    },
    { auto: true },
  ],
})

export { expect }
export type { Page } from '@playwright/test'
