# KICKOFF.md — where the build stands, and what is left

**Point a fresh session at this file first.** It holds the current state and the remaining work; the
record behind it is split into the files below so no single one is a wall of text.

| File | Holds |
|---|---|
| `CLAUDE.md` | Conventions, stack, commands, domain glossary, and the rules that must never be violated |
| `docs/PLAN.md` | Architecture, screens, the slice tables, testing strategy, risks |
| `docs/PLAN-TABLET-APP.md` | **The next body of work** — the Android tablet app, slices 40–45 (nothing built yet) |
| `docs/DATA-MODEL.md` | The full Prisma schema for all four phases, and the index set |
| `docs/PLAN-SLICES.md` | Every slice as built — its fixed decisions, migration and known limits |
| `docs/ASSUMPTIONS.md` | Every assumption where the brief was silent (the Phase 1 set; 62+ in the log) |
| `docs/ASSUMPTIONS-LOG.md` | Assumptions 62–244, in numeric order |
| `README.md` | How to run it, and deploy it |
| `docs/SLICES.md` | What each slice added, and how to try it |
| `docs/HISTORY.md` | The build history, the traps, and the original brief verbatim |
| `docs/UI-REVIEW.md` | The Hi-Vis Industrial direction and its contrast rules — **read this before touching any screen** |
| `docs/UI-REVIEW-FINDINGS.md` | The design review that produced it |

> **Where the next session starts — the tablet app.** The owner's next request is to ship the
> technician side as an installable Android tablet app while the office keeps the website. The plan is
> written and approved: **[`docs/PLAN-TABLET-APP.md`](docs/PLAN-TABLET-APP.md)** — slices 40–45
> (tablet shell + manifest, install/update, background sync, push, QR scanning, Play Store TWA).
>
> **Slice 40 is built (31 Oct 2026)** — `npm run verify` (481 unit) and `npm run build` pass, the
> technician phone suite is green (21 passed, 1 skipped: the worker test needs a production build) and
> the new tablet project at 800×1280 is 4/4 green. What landed: the shell widens to
> `max-w-6xl` with two-column job cards and report form, `viewportFit: 'cover'` with safe-area padding,
> `/m/login` + `techSignOutAction` so an expired session and a sign-out stay inside the app, a manifest
> with `id`, `orientation: any`, PNG + maskable icons (`scripts/make-icons.ts`), Cache Storage cleared on
> sign-out, a two-step sign-out when reports are unsent, `navigator.storage.persist()` after the first
> sync, and a storage-specific message when a photo will not fit. **Start at slice 41** (install and
> update without losing work) — it touches the worker, so it also needs `npm run build`.
>
> **Check by eye at 768, 1024 and 1280**, not only in the emulator: `md:` is exactly tablet-portrait
> width. Slice 40 closed the old "review the technician app at 390px" item on this list below; the
> phone project passes, but the earlier restyle items 2–6 on that list are still open.
>
> The earlier feature plan (§7 in `docs/PLAN.md`) is complete through slice 39. **Slice 39 — the Service Report — is built and both
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

**The gates all pass** — `npm run verify` (481 unit, slice 40 included) and `npm run build`. E2E is green
after slice 40: technician project 21 passed / 1 skipped (the worker test needs a production build), tablet
project 4/4. `npm run test:integration` last ran green at slice 39 (403 tests); slice 40 touched no server
code, so it was not re-run.

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
   as dead space.
2. **Review the screens not yet seen at full resolution:** `/cranes`, `/invoices`, `/tickets`,
   `/schedule`, `/reports`, `/admin`, `/quotes`, `/stock-takes`, the `(portal)` screens. (The
   technician app at 390px is covered by the phone project; the tablet at 800×1280 by the tablet
   project — both green as at slice 40. Check 768/1024/1280 by eye.)
3. **Sweep for `text-hivis` on pale surfaces** app-wide. Any yellow running text not on charcoal or on
   a hivis fill is a contrast failure (white/yellow pairing is 1.6:1).
4. **Reconcile the UI docs** — `docs/UI-REVIEW.md` was split on 31 Oct 2026 and its earlier sections
   moved to `docs/UI-REVIEW-FINDINGS.md`, so the old sage-palette contradiction is gone; re-read both
   only if a screen disagrees with them.
5. **Confirm "ADA MORALES"** in the customers table — the office header reads "Alice Tan", so the
   uppercase string looks like seed sample data. Check no CSS `uppercase` is applied to names; if it
   is only seed copy, leave it.
6. **Taste-skill gate** — `lint.mjs` on the changed source is **0 FAIL / 0 WARN**. `inspect.mjs`
   **cannot be run on the office screens**: it has no session support, so pointed at `/dashboard` it
   measures the login screen and warns about *that* (`CRANE SERVICES` micro-label, the void beside the
   sign-in form). Its measurements of the office app still need an authenticated route.

The build history — each slice as it landed, the traps that cost time, and the kickoff brief
verbatim — is in [`docs/HISTORY.md`](docs/HISTORY.md).
