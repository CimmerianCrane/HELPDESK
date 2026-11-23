import { PrismaClient } from '@prisma/client'
import type { Prisma } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { createNodePrisma } from '@/lib/prisma-node'

/**
 * The one Prisma client, in both worlds.
 *
 * Cloudflare: a `PrismaClient` may not be shared across requests — a pooled socket from one request
 * cannot be reused by the next, and a module-level client is exactly that bug. So on the Worker each
 * request gets its own client, built from the Hyperdrive binding with `maxUses: 1` (a `pg` PoolConfig
 * field that retires the connection after one use), keyed on the request's execution context.
 *
 * Everywhere else (next dev, Vitest, `next start`, the Vercel transition build) there is no
 * Cloudflare context, so this falls back to the ordinary Node client the app has always had.
 *
 * The export is a Proxy so all 55 importing files keep calling `db.job`, `db.$transaction` and
 * `db.$queryRaw` unchanged — the client is resolved per property access, per request. Do not turn
 * `db` back into a plain object: that reintroduces the cross-request share on the Worker.
 */

type HyperdriveBinding = { connectionString: string }

type CloudflareBinding = {
  env: { HYPERDRIVE?: HyperdriveBinding }
  // The execution context. Only its identity matters here; it is the per-request key.
  ctx: object
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

/** Node/Vitest/`next start` fallback. Never constructed inside the Worker — see `current()`. */
function nodeClient(): PrismaClient {
  // The dev server hot-reloads modules; without the global it leaks a pool on every reload.
  globalForPrisma.prisma ??= createNodePrisma()
  return globalForPrisma.prisma
}

/**
 * The Cloudflare context, when there is one and it carries a Hyperdrive binding.
 *
 * `getCloudflareContext()` throws outside a Worker request (Vitest, `next start`, the Vercel build);
 * that is the signal to use the Node client, so the throw is the feature, not an error.
 */
function worker(): CloudflareBinding | null {
  try {
    const context = getCloudflareContext() as CloudflareBinding | undefined
    if (context?.env?.HYPERDRIVE?.connectionString) return context
    return null
  } catch {
    return null
  }
}

/** One client per request, reused for the life of that request, discarded with its context. */
const perRequest = new WeakMap<object, PrismaClient>()

function clientFor(binding: CloudflareBinding): PrismaClient {
  let client = perRequest.get(binding.ctx)
  if (!client) {
    client = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: binding.env.HYPERDRIVE!.connectionString,
        // The connection is used once and returned to Hyperdrive's pool. Without this a Worker would
        // reuse a socket across requests, which Workers do not allow.
        maxUses: 1,
      }),
      log: ['error'],
    })
    perRequest.set(binding.ctx, client)
  }
  return client
}

function current(): PrismaClient {
  const binding = worker()
  return binding ? clientFor(binding) : nodeClient()
}

export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = current()
    const value = Reflect.get(client, property)
    // Data-model delegates (`db.job`) read fine unbound. `$transaction` / `$queryRaw` are functions
    // that must keep the client as `this`, or they throw.
    return typeof value === 'function' ? value.bind(client) : value
  },
})

/**
 * A Prisma transaction client. Every service that writes takes one of these, so the mutation and its
 * audit row commit together or not at all.
 */
export type Tx = Prisma.TransactionClient
