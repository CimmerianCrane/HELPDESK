import { PrismaClient } from '@prisma/client'
import type { Prisma } from '@prisma/client'

// Next.js dev server hot-reloads modules; without this the process leaks a new pool on every reload.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

/**
 * A Prisma transaction client. Every service that writes takes one of these, so the mutation and its
 * audit row commit together or not at all.
 */
export type Tx = Prisma.TransactionClient
