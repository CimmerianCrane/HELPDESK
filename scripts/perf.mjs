/**
 * Lighthouse before/after harness for the three pages that matter: the public login, an office
 * screen, and the field app.
 *
 * `/dashboard` and `/m/jobs` redirect to `/login` without a session, so a plain Lighthouse run
 * measures the login page under a different name. The answer is `extraHeaders`: sign in once with
 * Playwright, take the cookie, and hand it to Lighthouse for every request.
 *
 * Plain `.mjs` on purpose. `tsx` injects esbuild's `__name` helper into functions Lighthouse
 * serialises into the page, and the browser has no `__name` — the run dies before the first audit.
 *
 * Run against a production build (`npm run build && npm start`), never `next dev`. The dev server
 * compiles on first hit and those seconds are not the app's.
 *
 *   npm run perf -- baseline
 *   npm run perf -- after
 *
 * Writes `.lighthouse/<label>.json` and prints a markdown table. INP is deliberately absent: it
 * needs real interaction and field data, neither of which a lab run produces. TBT is the proxy.
 */
import { chromium } from '@playwright/test'
import { launch } from 'chrome-launcher'
import lighthouse from 'lighthouse'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.env.PERF_BASE_URL ?? 'http://localhost:3000'
const PASSWORD = process.env.SEED_PASSWORD ?? 'cimmerian-dev-2026'
const RUNS = Number(process.env.PERF_RUNS ?? 3)
const LABEL = process.argv[2] ?? 'baseline'

// The technician account is required for `/m/jobs`: the tech layout sends an office login to
// `/dashboard` when it has no technician record.
const PAGES = [
  { name: 'login', path: '/login', email: null },
  { name: 'dashboard', path: '/dashboard', email: 'admin@cimmeriancrane.example' },
  { name: 'field', path: '/m/jobs', email: 'ahmad@cimmeriancrane.example' },
]

async function sessionCookie(email) {
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(`${BASE}/login`)
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 })
    const { cookies } = await context.storageState()
    return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
  } finally {
    await browser.close()
  }
}

async function measure(path, cookie) {
  // A fresh Chrome per run. Lighthouse clears the page's storage, but a fresh profile also rules
  // out a service worker from the previous run serving the page.
  const chrome = await launch({ chromeFlags: ['--headless=new', '--no-sandbox'] })
  try {
    const result = await lighthouse(`${BASE}${path}`, {
      port: chrome.port,
      output: 'json',
      logLevel: 'error',
      onlyCategories: ['performance'],
      extraHeaders: cookie ? { Cookie: cookie } : {},
    })
    if (!result) throw new Error(`lighthouse returned nothing for ${path}`)

    // A redirect would silently measure the login page three times.
    const landed = new URL(result.lhr.finalDisplayedUrl).pathname
    if (landed !== path) throw new Error(`${path} landed on ${landed} — is the session valid?`)

    const audits = result.lhr.audits
    const value = (id) => {
      const numeric = audits[id]?.numericValue
      if (typeof numeric !== 'number') throw new Error(`missing audit ${id} for ${path}`)
      return numeric
    }

    return {
      lcp: value('largest-contentful-paint'),
      cls: value('cumulative-layout-shift'),
      tbt: value('total-blocking-time'),
      fcp: value('first-contentful-paint'),
      si: value('speed-index'),
      ttfb: value('server-response-time'),
      bytes: value('total-byte-weight'),
      score: (result.lhr.categories.performance?.score ?? 0) * 100,
    }
  } finally {
    await chrome.kill()
  }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function row(page, samples) {
  const m = (pick) => median(samples.map(pick))
  return [
    page,
    `${Math.round(m((s) => s.lcp))} ms`,
    m((s) => s.cls).toFixed(3),
    `${Math.round(m((s) => s.tbt))} ms`,
    `${Math.round(m((s) => s.fcp))} ms`,
    `${Math.round(m((s) => s.si))} ms`,
    `${Math.round(m((s) => s.ttfb))} ms`,
    `${(m((s) => s.bytes) / 1024).toFixed(1)} KB`,
    `${Math.round(m((s) => s.score))}`,
  ].join(' | ')
}

async function main() {
  const cookies = new Map()
  for (const page of PAGES) {
    cookies.set(page.name, page.email ? await sessionCookie(page.email) : null)
  }

  const results = {}
  for (const page of PAGES) {
    results[page.name] = []
    for (let run = 1; run <= RUNS; run++) {
      process.stderr.write(`${page.name} ${run}/${RUNS} … `)
      results[page.name].push(await measure(page.path, cookies.get(page.name) ?? null))
      process.stderr.write('done\n')
    }
  }

  mkdirSync('.lighthouse', { recursive: true })
  writeFileSync(
    join('.lighthouse', `${LABEL}.json`),
    JSON.stringify({ label: LABEL, base: BASE, runs: RUNS, results }, null, 2),
  )

  console.log(`\n### ${LABEL}`)
  console.log('| Page | LCP | CLS | TBT | FCP | Speed Index | TTFB | Bytes | Score |')
  console.log('|---|---|---|---|---|---|---|---|---|')
  for (const page of PAGES) console.log(`| ${row(page.name, results[page.name])} |`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
