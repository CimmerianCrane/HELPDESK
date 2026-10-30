import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (see .env.example)'),
  DIRECT_URL: z.string().min(1).optional(),

  APP_BASE_URL: z.string().min(1).default('http://localhost:3000'),
  AUTH_SECRET: z.string().min(1).optional(),

  // Seeded into the Setting table on first run. After that the office team edits them in Admin —
  // these are defaults, not the source of truth (brief §1).
  DEFAULT_TIMEZONE: z.string().default('Asia/Singapore'),
  DEFAULT_CURRENCY: z.string().default('SGD'),
  DEFAULT_GST_RATE: z.coerce.number().min(0).max(1).default(0.09),

  // Vercel has no durable local disk, so production uses Supabase Storage. `disk` remains the
  // default for local development, where it needs no credentials.
  STORAGE_DRIVER: z.enum(['disk', 'supabase']).default('disk'),
  STORAGE_DISK_PATH: z.string().default('./storage'),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SUPABASE_STORAGE_BUCKET: z.string().default('cimmerian-files'),

  EMAIL_DRIVER: z.enum(['console', 'smtp']).default('console'),
  EMAIL_FROM: z.string().default('helpdesk@cimmeriancrane.example'),

  // SMS and WhatsApp (slice 36). Like `smtp` above, the named production drivers are declared and
  // not yet implemented: naming one falls back to console with a warning rather than refusing to
  // send the alert.
  SMS_DRIVER: z.enum(['console', 'twilio']).default('console'),
  WHATSAPP_DRIVER: z.enum(['console', 'meta']).default('console'),

  // Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Required in production; see
  // src/app/api/cron/daily/route.ts.
  CRON_SECRET: z.string().min(1).optional(),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
})

export type Env = z.infer<typeof schema>

let cached: Env | undefined

/**
 * Validated environment. Lazy on purpose: `next build` imports route modules without a database
 * present, and we only want this to throw when something actually tries to use the env.
 */
export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env)
    if (!parsed.success) {
      const problems = JSON.stringify(parsed.error.flatten().fieldErrors, null, 2)
      throw new Error(`Invalid environment configuration:\n${problems}`)
    }
    cached = parsed.data
  }
  return cached
}
