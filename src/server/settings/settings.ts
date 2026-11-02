import type { Prisma } from '@prisma/client'
import { db, type Tx } from '@/lib/db'
import { env } from '@/lib/env'

export interface Settings {
  timezone: string
  currency: string
  gstRate: number
  reminderOffsetsDays: number[]
  autoCreateDraftJobs: boolean
  gpsCheckIn: boolean
  blockAssignmentOnExpiredCompetency: boolean
  complianceNotice: string
}

/**
 * Operational settings. These are deliberately rows rather than constants: timezone, currency and the
 * GST rate must be changeable by the office team, and the compliance notice must be editable without
 * a deploy (brief §1, §7.4).
 */
export const SETTING_DEFAULTS: Settings = {
  timezone: 'Asia/Singapore',
  currency: 'SGD',
  gstRate: 0.09,
  reminderOffsetsDays: [90, 60, 30],
  autoCreateDraftJobs: false,
  gpsCheckIn: false,
  blockAssignmentOnExpiredCompetency: false,
  complianceNotice:
    'Rules are configured by your team. Verify against current MOM requirements with your Authorised Examiner.',
}

export type SettingKey = keyof Settings

export const COMPLIANCE_NOTICE_KEY: SettingKey = 'complianceNotice'

/** Defaults resolved from env where env supplies one, so a deployment can differ per environment. */
export function defaultSettings(): Settings {
  const e = env()
  return {
    ...SETTING_DEFAULTS,
    timezone: e.DEFAULT_TIMEZONE,
    currency: e.DEFAULT_CURRENCY,
    gstRate: e.DEFAULT_GST_RATE,
    reminderOffsetsDays: [...SETTING_DEFAULTS.reminderOffsetsDays],
  }
}

/**
 * All settings, with any missing key falling back to its default.
 *
 * Takes the client because callers inside `withAudit` must pass their `tx`: the runtime URL is the
 * Supabase transaction pooler with `connection_limit=1`, so a read through `db` while a transaction
 * is open waits for a second connection that never arrives and dies on the pool timeout.
 */
export async function getSettings(client: Tx = db): Promise<Settings> {
  const rows = await client.setting.findMany()
  const stored = Object.fromEntries(rows.map((row) => [row.key, row.value]))
  return { ...defaultSettings(), ...stored } as Settings
}

export async function getSetting<K extends SettingKey>(key: K): Promise<Settings[K]> {
  const row = await db.setting.findUnique({ where: { key } })
  return (row ? row.value : defaultSettings()[key]) as Settings[K]
}

export async function setSetting<K extends SettingKey>(
  key: K,
  value: Settings[K],
  updatedById?: string,
): Promise<void> {
  const json = value as unknown as Prisma.InputJsonValue
  await db.setting.upsert({
    where: { key },
    create: { key, value: json, updatedById },
    update: { value: json, updatedById },
  })
}
