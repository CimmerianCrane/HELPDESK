import { describe, expect, it } from 'vitest'
import { pidsFromLsof, pidsFromNetstat } from '../../scripts/dev-stop'

/**
 * The parsers are the only logic in `npm run dev:stop`; stopping the wrong PID from a sloppy match
 * is the one way that script can do damage, so the port matching is pinned here.
 */
describe('dev:stop port matching', () => {
  // Real `netstat -ano -p tcp` lines on Windows, plus the neighbours they must not match.
  const netstat = [
    '  Proto  Local Address          Foreign Address        State           PID',
    '  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       4231',
    '  TCP    [::]:3000              [::]:0                 LISTENING       4231',
    '  TCP    127.0.0.1:30000        0.0.0.0:0              LISTENING       9999',
    '  TCP    127.0.0.1:54321        127.0.0.1:3000         ESTABLISHED     5555',
    '  TCP    0.0.0.0:3001           0.0.0.0:0              LISTENING       7777',
  ].join('\r\n')

  it('finds the listening PIDs on the port, IPv4 and IPv6, and nothing else', () => {
    // 30000 is not 3000 and 3001 is not 3000 — both are the mismatch a naive `includes` would make.
    expect(pidsFromNetstat(netstat, 3000)).toEqual([4231])
  })

  it('ignores an established connection whose remote port is 3000', () => {
    expect(pidsFromNetstat(netstat, 3000)).not.toContain(5555)
  })

  it('returns nothing when the port is free', () => {
    expect(pidsFromNetstat(netstat, 4000)).toEqual([])
  })

  it('reads lsof output, which is bare PIDs', () => {
    expect(pidsFromLsof('4231\n4231\n5555\n')).toEqual([4231, 5555])
    expect(pidsFromLsof('')).toEqual([])
  })
})
