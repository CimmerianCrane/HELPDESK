type Level = 'debug' | 'info' | 'warn' | 'error'

const RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }

function minLevel(): number {
  const configured = process.env.LOG_LEVEL as Level | undefined
  return RANK[configured ?? 'info'] ?? RANK.info
}

/** Structured logs (brief §11). One JSON object per line, so hosting can index it as-is. */
function write(level: Level, message: string, fields: Record<string, unknown> = {}): void {
  if (RANK[level] < minLevel()) return
  const line = JSON.stringify({ ts: new Date().toISOString(), level, message, ...fields })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const logger = {
  debug: (message: string, fields?: Record<string, unknown>) => write('debug', message, fields),
  info: (message: string, fields?: Record<string, unknown>) => write('info', message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => write('warn', message, fields),
  error: (message: string, fields?: Record<string, unknown>) => write('error', message, fields),
}

/** Normalises a thrown value into something safe to log and, where appropriate, to show a user. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : 'Unknown error'
}
