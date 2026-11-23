import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

/**
 * A Prisma client for Node-only contexts: the seed, `admin:create`, and the integration tests.
 *
 * The schema is generated with `engineType = "client"` (no Rust binary, which is what lets the app run
 * on Cloudflare Workers), and a client-engine client **requires** a driver adapter — there is no
 * implicit DATABASE_URL path any more. So every `new PrismaClient()` in the repo goes through here.
 *
 * Not for the app runtime: `src/lib/db.ts` owns that client, per request on the Worker.
 */
export function createNodePrisma(connectionString = process.env.DATABASE_URL): PrismaClient {
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to build a Prisma client outside Cloudflare Workers.')
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
}
