# KICKOFF.md — where the build stands, and what is left

**Point a fresh session at this file first.** It holds the current state and the remaining work; the
record behind it is split into the files below so no single one is a wall of text.

| File | Holds |
|---|---|
| `CLAUDE.md` | Conventions, stack, commands, domain glossary, and the rules that must never be violated |
| `docs/PLAN.md` | Architecture, screens, the slice tables, testing strategy, risks |
| `docs/PLAN-TABLET-APP.md` | The Android tablet app, slices 40–45 — **44 built, 45 left** |
| `docs/DATA-MODEL.md` | The full Prisma schema for all four phases, and the index set |
| `docs/PLAN-SLICES.md` | Every slice as built — its fixed decisions, migration and known limits |
| `docs/ASSUMPTIONS.md` | Every assumption where the brief was silent (the Phase 1 set; 62+ in the log) |
| `docs/ASSUMPTIONS-LOG.md` | Assumptions 62–244, in numeric order |
| `README.md` | How to run it, and deploy it |
| `docs/SLICES.md` | What each slice added, and how to try it |
| `docs/HISTORY.md` | The build history, the traps, and the original brief verbatim |
| `docs/UI-REVIEW.md` | The Hi-Vis Industrial direction and its contrast rules — **read this before touching any screen** |
| `docs/UI-REVIEW-FINDINGS.md` | The design review that produced it |

> **Slice 46 is built (3 Nov 2026) — the first paper checklist reaches the phone.** A PM job on an
> overhead, gantry or jib crane now opens the **Crane and Monorail** sheet: 57 lines in six sections,
> transcribed from the owner's xlsx, graded with the paper's four words (4 Good · 3 Monitor ·
> 2 Replacement · 1 Unsafe). The machine now chooses the sheet: `ChecklistTemplate.craneTypes` sits
> beside `jobTypeId`, and `src/server/templates/checklist.ts` is the single resolver used by the phone
> bundle, report submission and the dispatch pack. A mobile-crane PM keeps the generic servicing list.
> The grade scale moved 1–5 → 1–4 (old reports still read); the offline outbox's dropped `grades` was
> fixed on the way. Migration `20261103043308_checklist_template_crane_types` is applied;
> `npm run seed` twice is idempotent. Gate: `npm run verify` (522 unit) and `npm run test:integration`
> (415) pass. **Still to do:** the manual 390px/offline check, and the other four sheets are later data
> entries — Chain Block, Dock Leveler and Cargo Hoist need new `CraneType` values first. Details:
> `docs/SLICES.md` "Slice 46" and `docs/PLAN-SLICES.md` §7.26.
>
> **The customer portal was removed (3 Nov 2026).** Customer logins existed only to show a
> read-only copy of records the office already emails, and carried the cost of external accounts
> with no self-service password reset. Gone with it: the `CUSTOMER` role, `User.customerId`,
> `portal.read`, the `(portal)` screens and `src/server/portal/`, the demo portal login, and the
> `PORTAL` ticket source. Migration `20261103000000_drop_portal_login`. Customers now receive
> issued reports and certificates by email.
>
> **Where the next session starts — the tablet app is code-complete.** The owner's request was to
> ship the technician side as an installable Android tablet app while the office keeps the website.
> Slices 40–45 are all built; the plan is **[`docs/PLAN-TABLET-APP.md`](docs/PLAN-TABLET-APP.md)**.
> Nothing in the app is waiting on code. What is left is operational: set the three VAPID vars for
> push (see slice 43) and run the Play Store steps (slice 45).
>
> **Play Store wrapper deferred (3 Nov 2026).** The owner paused the Play Console half of slice 45
> until the app has had real field use — Google rejects a wrapper that is "just a website", and the
> offline mode, push and QR scanner are what answer that. The app-side half is built and returns 404
> until `ANDROID_PACKAGE_NAME` / `ANDROID_SHA256_FINGERPRINTS` are set. Runbook: README "Play Store".
>
> **First admin on a clean database (3 Nov 2026).** `npm run admin:create` (`scripts/create-admin.ts`)
> closes a gap found while planning the first production deploy: `/admin/users` needs an admin to sign
> in first, and `prisma/seed.ts` skips demo accounts wherever `DATABASE_URL` is not localhost, so a
> fresh Supabase project had no way in at all. The script writes the same `User` row and `AuditLog`
> CREATE entry `createUser` would. The deploy order is now `db:deploy` → `seed` → `admin:create`
> (README "Deployment"). Typecheck, lint and `npm run build` pass; it has not yet been run against a
> live Postgres.
>
> **Security hardening (2 Nov 2026)** — an eighteen-point audit, then the fixes it found. The code
> was already strong on authorization, SQL, storage and password hashing; what was missing was
> configuration and edge cases. Shipped: a full security header set and CSP in `next.config.ts`
> (nonce-less on purpose — a nonce forces every page dynamic and costs the static `/offline`
> Serwist precaches), the `//evil.com` open redirect closed by one shared `safeNext` in
> `src/lib/safe-next.ts`, `internalError()` replacing six routes that returned the raw error text at
> 500, DB-backed rate limits on the three repeatable write endpoints, a constant-time cron secret,
> a production-only env fail-fast, scrypt raised to N=2^16, a self-service **Change password** screen
> at `/account/password`, CSV formula-injection defusing, five missing scope filters, and production
> log hygiene for the console email/SMS adapters. Gate: `npm run verify` (516 unit),
> `npm run test:integration` (418) and `npm run build` pass, and the headers, cron 401/401/200 and
> the unauthenticated `/account/password` redirect were checked against `next start`.
>
> **Before the first deploy of this change:** `AUTH_SECRET`, `CRON_SECRET` and a non-localhost
> `APP_BASE_URL` must all be set in Vercel, or the app refuses to start. That is the intent, but it
> is a deploy-time failure, not a runtime one. Generate a secret with
> `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
>
> **Deferred dependency upgrades** — one task, not four surprises. All four need a major and none is
> reachable at runtime today, so they were deliberately left for a dedicated pass:
> `zod` 3 → 4 (the only runtime-reachable advisory; fixed in 4.6.6+), `vitest` 2 → 5 (two criticals,
> but they live in the Vitest UI server, which `npm run test` never starts), `@serwist/next` 9
> (npm's offered "fix" is a downgrade to 8.4.4) and `prisma` 6 → 7.10.1+ (build-time CLI only).
> **Do not run `npm audit fix`**: its non-forced plan downgrades Prisma 6.19.3 → 6.12.0 to dodge an
> advisory that covers 6.13.0–7.10.0, trading seven minor releases for a build-time-only issue.
>
> **One navigation everywhere (1 Nov 2026)** — the owner reported the sidebar was not standardised
> across pages and asked for a single, intuitive one for all users and all pages. The office and the
> field shell already shared `ShellNav`; the **customer portal did not** — it carried its own light
> header and a hand-written link array. Now `src/components/shell/shell-nav.tsx` is rendered by all
> three, fed by one capability-filtered list in `src/server/auth/nav.ts` (the portal's own array is
> gone; a customer is picked by audience, not by filtering a combined list, because they hold
> `crane.read` too). The rail is **grouped and fully open** — Today · Work · Register · Inventory ·
> Money · Admin, one line icon per page, Admin pinned to the foot with the account — replacing the
> five-area model where only the area you were in expanded. Stock takes moved to **Inventory** beside
> the parts book. The Menu button moved into each shell's top band as a flex child, retiring the
> hardcoded `pl-24` both headers carried to dodge it, and the rail is `lg:h-dvh` sticky so the account
> block stays on the window. No schema change, no new dependency (icons are inline SVG). Gate:
> `npm run verify` (506 unit, 9 of them new in `tests/unit/nav.test.ts`) and `npm run build` pass;
> auth, portal, inbox, jobs, technician and tablet e2e are green. The new nav test caught a real bug
> on the way: concatenating the office and portal lists handed customers the office `/certificates`
> and `/schedules`. Direction notes are in `docs/UI-REVIEW.md` ("the one rail, third revision").
>
> **Field navigation fixed (1 Nov 2026)** — the owner found that a technician inside the field app had
> **no navigation at all**: one bar with one item ("My jobs") at every width, while every office
> screen had the charcoal rail. Both shells now read one nav list in `src/server/auth/nav.ts`; a
> phone gets a bottom bar of four destinations and a **browser** at `lg` gets the same capability-
> filtered rail the office uses. The rail stays hidden in the **installed** app at every width — its
> office links leave `/m/`, and opening Chrome from an installed app is what slice 40 prevents. The
> bottom bar is named "Field" so it is not a second "Main" landmark. The report form's submit bar
> would have covered the rail's foot; the header padding fix is now superseded by the Menu button
> living in the band. No schema change, no new dependency. `npm run verify` (497 unit) and
> `npm run build` pass; field, auth, inbox and smoke e2e are green against both the dev server and
> `npm start`. Details in `docs/PLAN-TABLET-APP.md` ("Field navigation").
>
> **Servicing is one tap per line (2 Nov 2026)** — a servicing line used to be answered twice: once
> Pass/Fail/N/A and again 1–5. Now the grade *is* the answer: five one-word buttons (New · Good · OK ·
> Repair · Fail) set the checklist result through `checklistResultForGrade`, and only **Fail** fails a
> line — "repair soon" is still operable. A **Not fitted** button marks N/A and clears the grade,
> which `applyReport` now accepts instead of demanding a grade for every answer. Sections fold with
> a done count, the header shows n / total, and a missing grade is named by line and section rather
> than by its code. `buildServiceReportContent` returns an empty document for a job with nothing
> graded — the empty state the screen already had — instead of throwing and taking the job page down.
> The report form's submit bar is `sticky` above `lg` so it follows a collapsed rail. Gate:
> `npm run verify` (506 unit, incl. the new `checklistResultForGrade` case; integration `report-approval`
> covers the N/A path) and `npm run build` pass. No schema change, no new dependency.
>
> **Slice 45 is built (31 Oct 2026)** — the app-side half of a Play Store listing. Digital Asset
> Links are served at `/.well-known/assetlinks.json` (a `rewrites()` entry to `/api/assetlinks`, since
> a dotted directory breaks the App Router) from `ANDROID_PACKAGE_NAME` and
> `ANDROID_SHA256_FINGERPRINTS`; unset is a 404, malformed is a 500. The pure builder is
> `src/lib/assetlinks.ts` (a route file may only export HTTP methods — exporting it from the route
> failed the build). `twa-manifest.json` is committed as the build config with placeholder host;
> the keystore and generated `android/` project are gitignored. Verified by hand against `next start`
> (200 with the statement list, 404 unset); `npm run verify` (495 unit) and `npm run build` pass. The
> rest is console and signing work — the runbook is the README's "Play Store (slice 45)".
>
> **Slice 44 is built (31 Oct 2026)** — scan a crane QR label. A technician points the tablet at the
> printed label and lands on that crane's report instead of typing an asset tag. What landed: the
> token's pattern and payload parser in `src/lib/cranes/qr.ts` (shared by the server's label generator
> and the tablet — the server module is `node:crypto`, so the parser could not live there), a
> `QrScanner` component over `BarcodeDetector` + the rear camera with a typed-in fallback, a **Scan
> crane** action on the job sheet that opens the crane's report or jumps to the other visit it is
> cached under, and **Verify crane label** in the report header (it confirms, it never switches crane).
> `TechCrane` gained `qrValue`, so the Dexie cache needs a fresh sync after deploying — an old cached
> crane has no token and scans nothing. No schema change and no new dependency. `npm run verify` (492
> unit) and `npm run build` pass. Camera behaviour is a manual device check on HTTPS, in airplane mode
> too. **Start at slice 45** (Play Store TWA).
>
> **Slice 43 is built (31 Oct 2026)** — push when a job is dispatched. A technician's tablet chimes
> with the job and site, even with the app closed; tapping it focuses the open app on that job.
> What landed: `PushSubscription` (one migration: the table plus `WEB_PUSH` on `NotificationChannel`),
> `web-push` + three optional VAPID env vars (push is silently off until all three are set),
> `POST/DELETE /api/push/subscribe` through `subscribePush` / `unsubscribePush` in
> `src/server/notify/push.ts` (a subscription always belongs to the caller; an endpoint re-registered
> from a shared tablet is reassigned), the dispatch writing a `WEB_PUSH` row per tablet reached, `push`
> and `notificationclick` in `src/app/sw.ts` (only `/m/` links open, `tag` is the job id so a
> re-dispatch collapses), a **Job alerts on this tablet** card on `/m/jobs`, and sign-out dropping the
> subscription. `web-push` is installed and `20261031120000_slice43_web_push` is applied.
> `npm run verify` (488 unit) and `npm run build` pass; `tests/integration/push.test.ts` and
> `schedule.test.ts` are green (41). **Push stays off until VAPID is set** — generate keys with
> `npx web-push generate-vapid-keys` and put the three values in `.env` / Vercel; real delivery is a
> manual device check. Slice 44 (scanning) followed it; slice 45 is next.
>
> **Slice 42 is built (31 Oct 2026)** — offline that keeps working, and uploads that finish on their
> own. `npm run verify` (486 unit) and `npm run build` pass. The worker now sends any same-origin `GET`
> outside `/m/` and `/_next/` straight to the network (it had been caching `/api/tech/sync` and office
> pages), and runs the outbox on a Background Sync `tech-outbox` event using the same `flushOutbox` the
> page uses, serialised across contexts with a Web Lock. It rejects the event only for a retryable
> failure (network, 5xx, 429) and resolves on a 401/403 or a refused report.
>
> **Slice 41 is built (31 Oct 2026)** — install and update without losing work. What landed: an **Install on this tablet** card on `/m/jobs`
> (fed by `beforeinstallprompt`, captured by an inline script before React hydrates; it points at
> Chrome's own menu when the event never fires; dismissal lasts 30 days), an **update banner** in the
> tech layout backed by `skipWaiting: false` plus a `SKIP_WAITING` message in `src/app/sw.ts`,
> `reloadOnOnline: false`, the report draft flushed on `pagehide`/`visibilitychange`, a dead session
> from the outbox reported as "Session ended · Sign in again" (linked to `/m/login`) instead of burning
> the report's retry count, and a 24h session. **Start at slice 42** (offline that keeps working,
> and uploads that finish on their own) — it touches the worker, so it also needs `npm run build`.
>
> **Check by eye at 768, 1024 and 1280**, not only in the emulator: `md:` is exactly tablet-portrait
> width. Slice 40 closed the old "review the technician app at 390px" item on this list below; the
> phone project passes, but the earlier restyle items 2–6 on that list are still open.
>
> The earlier feature plan (§7 in `docs/PLAN.md`) is complete through slice 39, plus slice 46 (the
> Crane and Monorail checklist). **Slice 39 — the Service Report — is built and both
> migrations are applied (31 Oct 2026)**: `20261031100000_service_report_grades` (added `JobType.isServiceReport`,
> flipped `PM`) and `20261031110000_service_report_documents` (added the `ServiceReport` table). The owner reviewed every screen on 31 October
> 2026 and rejected two things outright: **the sidebar is cluttered** and **the dashboard is not the
> look they want**. Both were fixed, and the whole app was then restyled to the **Hi-Vis Industrial**
> direction taken from the owner's taste board: charcoal chrome, a hazard-stripe band as the signature
> device, safety yellow spent only on the active nav row and the one primary action, Barlow Condensed
> headings, and the Cimmerian mark in the shell, login and app icons. The direction and its contrast
> rules are in [`docs/UI-REVIEW.md`](docs/UI-REVIEW.md) — read it before touching any screen.
> See `docs/UI-REVIEW.md` §5b
> for the settled direction, and §6 for its contrast rules.
>
> The restyle itself added no capabilities and no schema changes — styling, layout and information architecture only.

### What is left to be done (as at 31 Oct 2026)

**Read this before testing the technician app on a real phone.** Two faults made every phone screen
dead, and both were found on 31 Oct 2026 (see `docs/HISTORY.md`):

- **`crypto.randomUUID` needs a secure context.** The report form hung on "Reading the draft…" when
  the phone opened the dev machine over the LAN. Fixed — client ids now use `newId()` in
  `src/lib/id.ts`. But **plain HTTP is still not a supported way to run this**: no secure context also
  means **no service worker and no offline mode**. Give the dev machine HTTPS (or test against the
  deployed URL) before checking field behaviour.
- **Next 16 needs the server started on the LAN address.** Without it `/_next/*` is refused cross-origin
  and React never hydrates, so every client component is dead while the HTML looks fine. **Fixed**: use
  `npm run dev:lan` — it finds the machine's address and starts `next dev --hostname <it>`; it prints the
  URL to open on the phone. `npm run dev` is still right for desktop-only work.

**The gates all pass** — `npm run verify` (522 unit as at 3 Nov 2026) and `npm run build` re-run after
the nav and servicing-checklist work. E2E is green
after slice 42 against the production server: technician + tablet projects **27 passed, 0 skipped**. The
offline worker test had been skipping itself even under a build — it navigated before the sign-in
redirect landed — and now runs for real. `npm run test:integration` is green complete at slice 46
(415 tests).

**Next.js 16.4.3 (31 Oct 2026).** Upgraded from 15.5.28. What it forced:

- **Both scripts pass `--webpack`.** `@serwist/next` integrates through a `webpack(config)` hook, and
  Next 16 fails a build that finds one unless you opt out of its new Turbopack default.
- **`eslint.config.mjs` spreads the flat config directly.** `eslint-config-next@16` ships native flat
  config; the old `FlatCompat` wrapper threw "Converting circular structure to JSON". `@eslint/eslintrc`
  is no longer a dependency.
- **`next.config.ts` lost its `distDir` switch.** Next 16 already puts dev in `.next/dev` and build in
  `.next`, which is what that switch existed to fake. The concurrency comment it carried is gone with
  it — the framework now holds a lock that refuses a second dev server itself.
- **Three `react-hooks/set-state-in-effect` errors**, new in the v16 rule set, fixed rather than
  silenced: the nav's rail preference and the phone's connection state are now `useSyncExternalStore`
  (they were mirroring an external store into state), and the sheet's open flag is derived from the
  route it was opened on instead of being reset by an effect.
- **One dev-server lock**, so only one `next dev` can run per project. `npm run dev:stop` still works.
- `tsconfig.json` was rewritten by `next dev` (`jsx: react-jsx`, extra `.next/dev` include paths) and
  `AGENTS.md` was generated. Both are framework-owned; keep them.

Work through this in order:

1. **Look at the dashboard at 1440** — the two-card row under "Today on the board" had ragged bottom
   edges; `items-start` was removed from the grid in `src/app/(office)/dashboard/page.tsx`, so the
   cards should now share a bottom edge. Confirm by eye and check the shorter panel does not now read
   as dead space. **Confirmed 2 Nov 2026** — the row is one panel with a single bottom edge, and the
   shorter column does not read as empty.
2. **Review the screens not yet seen at full resolution:** `/cranes`, `/invoices`, `/tickets`,
   `/schedule`, `/reports`, `/admin`, `/quotes`, `/stock-takes`. (The
   technician app at 390px is covered by the phone project; the tablet at 800×1280 by the tablet
   project — both green as at slice 41. Check 768/1024/1280 by eye.) **Checked programmatically
   2 Nov 2026** — all ten at 1440: no console errors, no horizontal overflow. A taste pass is still
   the owner's.
3. **Sweep for `text-hivis` on pale surfaces** app-wide. Any yellow running text not on charcoal or on
   a hivis fill is a contrast failure (white/yellow pairing is 1.6:1). **Swept 2 Nov 2026** — every
   use sits on charcoal (`bg-anchor`/`bg-black`) or is a hover state; none on a pale surface.
4. **Reconcile the UI docs** — `docs/UI-REVIEW.md` was split on 31 Oct 2026 and its earlier sections
   moved to `docs/UI-REVIEW-FINDINGS.md`, so the old sage-palette contradiction is gone; re-read both
   only if a screen disagrees with them.
5. **Confirm "ADA MORALES"** in the customers table — the office header reads "Alice Tan", so the
   uppercase string looks like seed sample data. Check no CSS `uppercase` is applied to names; if it
   is only seed copy, leave it. **Checked 2 Nov 2026** — no `Morales` string and no CSS `uppercase`
   in the source; that row was seed copy and is no longer there.
6. **Taste-skill gate** — `lint.mjs` on the changed source is **0 FAIL / 0 WARN**. `inspect.mjs`
   **cannot be run on the office screens**: it has no session support, so pointed at `/dashboard` it
   measures the login screen and warns about *that* (`CRANE SERVICES` micro-label, the void beside the
   sign-in form). Its measurements of the office app still need an authenticated route.

The build history — each slice as it landed, the traps that cost time, and the kickoff brief
verbatim — is in [`docs/HISTORY.md`](docs/HISTORY.md).
