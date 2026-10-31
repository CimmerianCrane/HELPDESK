/**
 * Renders the technician app's launcher icons from the two SVGs in `public/icons/`.
 *
 *   npx tsx scripts/make-icons.ts
 *
 * Run once and commit the PNGs. This is deliberately not part of a build: a build-time image render
 * would add a Chromium dependency to every deploy for three files that change when the logo does.
 * This script is the record of how they were made.
 *
 * Chromium comes from Playwright, which is already a dev dependency. The maskable variant must keep
 * the mark inside the centre 80% — `tech-icon-maskable.svg` already draws that safe zone, so it is
 * rendered as-is rather than padded here.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from '@playwright/test'

const ROOT = path.join(import.meta.dirname, '..')
const ICONS = path.join(ROOT, 'public', 'icons')

const JOBS = [
  { source: 'tech-icon.svg', output: 'tech-192.png', size: 192 },
  { source: 'tech-icon.svg', output: 'tech-512.png', size: 512 },
  { source: 'tech-icon-maskable.svg', output: 'tech-maskable-512.png', size: 512 },
] as const

async function main() {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    for (const { source, output, size } of JOBS) {
      const svg = await readFile(path.join(ICONS, source), 'utf8')
      await page.setViewportSize({ width: size, height: size })
      await page.setContent(
        `<style>html,body{margin:0;padding:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
      )
      await page.screenshot({ path: path.join(ICONS, output), omitBackground: false })
      console.log(`${output}  ${size}x${size}  from ${source}`)
    }
  } finally {
    await browser.close()
  }
}

// Called, not top-level awaited: the project is CommonJS, where `tsx` cannot run one.
void main()
