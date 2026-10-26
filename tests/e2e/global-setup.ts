import { PrismaClient } from '@prisma/client'

/**
 * Clears the sign-in throttle before the suite runs.
 *
 * Sign-in is rate limited per address (30 attempts per 15 minutes) and deliberately does not reset
 * that bucket on success, so that one valid login cannot be used to buy more guesses. An end-to-end
 * run signs in far more often than a person ever would, all from 127.0.0.1: back-to-back runs inside
 * one window therefore start from a nearly spent bucket, and once it is spent every sign-in is
 * refused. The suite then fails on the throttle instead of on anything the application does wrong.
 *
 * This runs outside the app, against the database directly, and touches only the throttle table.
 */
export default async function globalSetup(): Promise<void> {
  const db = new PrismaClient()
  try {
    await db.rateLimitBucket.deleteMany({})
  } finally {
    await db.$disconnect()
  }
}
