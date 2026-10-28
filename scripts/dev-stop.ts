/**
 * Stop whatever is listening on the dev port, so the next session does not inherit a server it
 * cannot get rid of. Cross-platform by design (CLAUDE.md rule 12): Node + `netstat`/`lsof`, no bash,
 * no dependency.
 *
 *   npm run dev:stop            # port 3000
 *   npm run dev:stop -- 3001    # any other port
 */
import { execFileSync } from 'node:child_process'

/** PIDs listening on `port`, from `netstat -ano` output (Windows). */
export function pidsFromNetstat(listing: string, port: number): number[] {
  const pids = new Set<number>()
  for (const line of listing.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/)
    // proto, local, foreign, state, pid
    if (cols.length === 5 && cols[3] === 'LISTENING' && cols[1]!.endsWith(`:${port}`)) {
      pids.add(Number(cols[4]))
    }
  }
  return [...pids]
}

/** PIDs from `lsof -ti` output (macOS, Linux). */
export function pidsFromLsof(listing: string): number[] {
  return [...new Set(listing.split(/\s+/).filter(Boolean).map(Number))]
}

function run(command: string, args: string[]): string {
  try {
    return execFileSync(command, args, { encoding: 'utf8' })
  } catch {
    // `lsof` exits 1 when nothing matches; that is the "nothing to stop" case, not a failure.
    return ''
  }
}

function main() {
  const port = Number(process.argv[2] ?? process.env.PORT ?? 3000)
  const pids =
    process.platform === 'win32'
      ? pidsFromNetstat(run('netstat', ['-ano', '-p', 'tcp']), port)
      : pidsFromLsof(run('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN']))

  if (pids.length === 0) {
    console.log(`Nothing is listening on port ${port}.`)
    return
  }

  for (const pid of pids) {
    try {
      process.kill(pid)
      console.log(`Stopped PID ${pid} on port ${port}.`)
    } catch {
      console.log(`PID ${pid} on port ${port} refused to stop — it may need an elevated shell.`)
    }
  }
}

// Only when run directly, so the parsers can be imported by the unit test.
if (process.argv[1]?.includes('dev-stop')) main()
