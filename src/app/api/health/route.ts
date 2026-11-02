import { db } from '@/lib/db'
import { errorMessage, logger } from '@/lib/logger'

// Never cached, never prerendered at build time — this is what a load balancer polls.
export const dynamic = 'force-dynamic'

export async function GET() {
  const startedAt = Date.now()
  try {
    await db.$queryRaw`SELECT 1`
    return Response.json({
      status: 'ok',
      db: 'up',
      latencyMs: Date.now() - startedAt,
      time: new Date().toISOString(),
    })
  } catch (error) {
    // The status is public; the reason is not. A Prisma failure names the host, the database and the
    // constraint that refused — a free reconnaissance report to anyone who can reach this URL.
    logger.error('health.db-down', { error: errorMessage(error) })
    return Response.json(
      {
        status: 'error',
        db: 'down',
        latencyMs: Date.now() - startedAt,
        time: new Date().toISOString(),
      },
      { status: 503 },
    )
  }
}
