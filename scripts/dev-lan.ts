/**
 * Dev server for testing on a real phone or tablet.
 *
 * Next 16 refuses `/_next/*` from an origin it was not started with, so a phone opening the machine by
 * its LAN address gets no JavaScript: the HTML renders and nothing on it works. Server-rendered text
 * looks fine, which is what makes it look like the app is broken rather than the setup. Starting with
 * `--hostname <that address>` puts it in Next's allowlist, and this finds the address for you.
 *
 *   npm run dev:lan              # first 192.168 address, usually the Wi-Fi one
 *   npm run dev:lan -- 10.0.0.8  # name the address yourself
 *
 * Cross-platform by design (CLAUDE.md rule 12): Node only, no dependency.
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { networkInterfaces } from 'node:os'

/** The private address a phone on the same network would type. */
export function lanAddress(): string | undefined {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal && address.address.startsWith('192.168.')) {
        return address.address
      }
    }
  }
  return undefined
}

function main() {
  const hostname = process.argv[2] ?? process.env.DEV_HOSTNAME ?? lanAddress()
  if (!hostname) {
    console.error('No LAN address found. Pass one: npm run dev:lan -- 192.168.0.15')
    process.exit(1)
  }

  console.log(`\n  Phone/tablet on the same network:  http://${hostname}:3000/m/jobs\n`)

  // Node running Next's own entry point: `npx` would need a shell on Windows, and passing arguments
  // through one is the deprecation Node warns about.
  const nextBin = createRequire(import.meta.url).resolve('next/dist/bin/next')
  const child = spawn(
    process.execPath,
    [nextBin, 'dev', '--webpack', '--hostname', hostname],
    { stdio: 'inherit' },
  )
  child.on('exit', (code) => process.exit(code ?? 0))
}

// Only when run directly, so `lanAddress` can be imported by the unit test.
if (process.argv[1]?.includes('dev-lan')) main()
