# Migration — Vercel → Cloudflare Workers

**Status:** complete in code, verified on a real Worker except the database path. Production still runs
on Vercel until you deploy.

Written and implemented 23 Nov 2026.

**Why:** Vercel limit/ban hit.

---

## The one architectural decision, and why

`@react-pdf/renderer` **cannot run on Cloudflare Workers**. Its layout engine (`yoga-layout@3.2.1`)
ships only a base64 WASM build and calls `WebAssembly.instantiate()` at runtime; workerd refuses
runtime-compiled WASM. This was proven, not assumed — see "The spike" below.

So the PDF renderers were **split into a small Node service** (`document-service/`), and the app calls
it over HTTP. Everything else stays on Workers.

```
Worker (app)  ──POST /render/:kind──▶  document-service (Node)
                                          └─ the five existing renderers, unchanged
```

The five renderers themselves did not change. `renderPdf(kind, input)` in
`src/server/documents/render-pdf.ts` is the single seam; it renders locally when
`DOCUMENT_SERVICE_URL` is unset, and calls the service when it is set. That is why dev, Vitest and any
Node deployment behave exactly as before, and why the Worker never loads react-pdf.

---

## What is verified

| Check | Result |
|---|---|
| `npm run verify` (typecheck, lint, unit) | ✅ 531 tests, 0 lint errors |
| `npm run build` (Next, unchanged) | ✅ |
| `npm run cf:build` (OpenNext on Windows) | ✅ |
| Worker bundle | ✅ 17.7 MB raw / 3.9 MB gzip (limit 64 MiB) |
| Serwist service worker | ✅ `sw.js` in `.open-next/assets`, `must-revalidate` from `public/_headers` |
| **The Worker starts** (`wrangler dev`) | ✅ `/login` 200, `/offline` 200, no module-load crash |
| **Document service renders** | ✅ real `%PDF-1.3`; 401 without secret; 404 unknown kind |
| **Remote vs local bytes** | ✅ **byte-identical** (`tests/integration/document-service.test.ts`) |
| **The db Proxy** | ✅ Node fallback, one client per request, new client per request, `$transaction` bound (`tests/unit/db-proxy.test.ts`) |
| **`getCloudflareContext()` resolves inside `scheduled()`** | ✅ invoked via wrangler's local scheduled API; logs show Prisma reaching for the Hyperdrive connection |
| **Wrangler bindings reach `process.env`** | ✅ verified with a temporary debug route: `AUTH_SECRET`/`APP_BASE_URL`/`DOCUMENT_SERVICE_URL` present, `navigator.userAgent === 'Cloudflare-Workers'`, `env.HYPERDRIVE` exposed |
| scrypt N=2^16 on workerd | ✅ (spike) |
| Prisma client generates | ✅ engine-less, `engineType = "client"` |

> **Verified caveat, found the hard way:** `wrangler dev` loads any `.env*` file in the repo and those
> values take precedence over `.dev.vars`. A local test looked like "bindings never reach
> `process.env`" until the stale `.env` was moved aside. Production has no `.env`, so it is not a
> deploy risk — but **never run `cf:deploy` from a machine with a populated `.env`**, and let CI do it.

## What is NOT verified — needs a real database

- **Prisma through Hyperdrive** against Postgres (`/api/health` → `db: up`). Locally the 503 is the
  expected "no database", not a bug.
- **The `scheduled()` cron path** (`wrangler dev --test-scheduled`).
- **The offline field app** on a deployed Worker over HTTPS.

---

## The spike (why the split was necessary)

Run in `wrangler dev` against the real render code, before committing to the design:

| Probe | Result |
|---|---|
| pdfkit module-level `new URL(..., import.meta.url)` | ❌ fixed with a wrangler `define` |
| pdfkit `#standard-fonts` under `createRequire` | ❌ fixed by registering font data |
| `yoga-layout` runtime WASM instantiation | ❌ **fatal, no fix** — this is the split |
| `scrypt` N=2^16 (64 MiB) | ✅ worked; the 128 MiB fear was unfounded |

---

## Repo changes

| File | Change |
|---|---|
| `prisma/schema.prisma` | `engineType = "client"` (no Rust engine). |
| `src/lib/db.ts` | `db` is a **Proxy** resolving a per-request client from `getCloudflareContext().env.HYPERDRIVE` (`maxUses: 1`), Node singleton elsewhere. All 55 importers unchanged. |
| `src/lib/prisma-node.ts` | `createNodePrisma()` — the one Node-side client builder. |
| `src/lib/document-wire.ts` | Lossless codec for render inputs (`Date` and `Uint8Array` survive JSON). |
| `src/server/documents/render-pdf.ts` | **The seam.** Local render (lazy import) or remote POST. |
| `document-service/server.mts` | The Node service: `/render/:kind`, `/health`, bearer secret. |
| `document-service/Dockerfile` | Builds and runs the service. |
| `src/server/{invoices,quotes,delivery-orders,reports/approval,service-reports}` | Call `renderPdf(kind, input)` instead of a renderer directly. |
| `next.config.ts` | Prisma external; tracing excludes for CLI/dev engines. |
| `wrangler.jsonc` | `nodejs_compat`, Hyperdrive, cron, assets, `vars` (incl. `DOCUMENT_SERVICE_URL`). |
| `cloudflare-worker.mjs` | Worker entry: OpenNext `fetch` + `scheduled()` → `/api/cron/daily`. |
| `public/_headers` | Static-asset caching, incl. the `/sw.js` must-revalidate rule. |
| `src/lib/env.ts` | `DATABASE_URL` optional (Hyperdrive); `DOCUMENT_SERVICE_URL`/`_SECRET`; fails a Worker deploy without the service URL. |
| `.github/workflows/deploy-cloudflare.yml` | Linux CI deploy. |
| `eslint.config.mjs` | Ignore `.open-next/`, `.wrangler/`, `document-service/dist/`. |

---

## Deploy order

```bash
# 1. the document service (any Node host; Cloudflare Container, Fly, Railway…)
docker build -f document-service/Dockerfile -t cimmerian-documents .
#   run it with PORT and DOCUMENT_SERVICE_SECRET; note its public host

# 2. the Worker
npx wrangler hyperdrive create cimmerian-crane --connection-string="<supabase pooler string>"
#   paste the id into wrangler.jsonc
#   set DOCUMENT_SERVICE_URL in wrangler.jsonc "vars"

# 3. secrets
npx wrangler secret put AUTH_SECRET
npx wrangler secret put CRON_SECRET
npx wrangler secret put DOCUMENT_SERVICE_SECRET
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put VAPID_PRIVATE_KEY

# 4. ship
npm run cf:deploy          # staging on *.workers.dev against a Supabase BRANCH db first
```

Deploys after the first go through GitHub Actions on `main`.

## Risks

- **Two processes to run.** The document service is a second deploy target with its own hostname. It
  is stateless and cheap, but it is another thing that can be down — and while it is, no document can
  be issued. Monitor `/health` on it.
- **Staging must not share production's database** — the cron trigger would fire reminders against
  live data.
- **Cost** bills per request/CPU-ms on both sides; a PDF render is CPU-heavy on the service.
