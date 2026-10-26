import { db } from '@/lib/db'
import { errorMessage } from '@/lib/logger'

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
    return Response.json(
      {
        status: 'error',
        db: 'down',
        latencyMs: Date.now() - startedAt,
        time: new Date().toISOString(),
        error: errorMessage(error),
      },
      { status: 503 },
    )
  }
}
