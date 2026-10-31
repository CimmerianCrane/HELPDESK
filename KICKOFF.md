# KICKOFF.md — where the build stands, and what is left

**Point a fresh session at this file first.** It holds the current state and the remaining work; the
record behind it is split into the files below so no single one is a wall of text.

| File | Holds |
|---|---|
| `CLAUDE.md` | Conventions, stack, commands, domain glossary, and the rules that must never be violated |
| `docs/PLAN.md` | Architecture, screens, the slice tables, testing strategy, risks |
| `docs/DATA-MODEL.md` | The full Prisma schema for all four phases, and the index set |
| `docs/PLAN-SLICES.md` | Every slice as built — its fixed decisions, migration and known limits |
| `docs/ASSUMPTIONS.md` | Every assumption where the brief was silent (the Phase 1 set; 62+ in the log) |
| `docs/ASSUMPTIONS-LOG.md` | Assumptions 62–239, in numeric order |
| `README.md` | How to run it, and deploy it |
| `docs/SLICES.md` | What each slice added, and how to try it |
| `docs/HISTORY.md` | The build history, the traps, and the original brief verbatim |
| `docs/UI-REVIEW.md` | The Hi-Vis Industrial direction and its contrast rules — **read this before touching any screen** |
| `docs/UI-REVIEW-FINDINGS.md` | The design review that produced it |

> **Where the next session starts: finish the styling pass, then new feature work.** The feature plan
> (§7 in `docs/PLAN.md`) is complete through slice 39. **Slice 39 — the Service Report — is built but neither
> migration is deployed**: `npx prisma migrate deploy` (or `npm run db:deploy`) must apply both
> `20261031100000_service_report_grades` (adds `JobType.isServiceReport`, flips `PM`) and
> `20261031110000_service_report_documents` (adds the `ServiceReport` table), and the service-report integration
> tests will fail with *"The column `isServiceReport` does not exist in the current database"* until it runs. The owner reviewed every screen on 31 October
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

**The gates all pass** — `npm run verify` (477 unit), `npm run build`. Integration (394 before slice 39, 405 after)
and e2e were last green on the previous schema; slice 39's two migrations are undeployed (see above), so its 11 new
integration tests are the only ones expected to fail until then.

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
   `/schedule`, `/reports`, `/admin`, `/quotes`, `/stock-takes`, the `(portal)` screens and the
   technician app at 390px.
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
