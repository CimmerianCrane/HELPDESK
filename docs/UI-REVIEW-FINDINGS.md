# UI-REVIEW-FINDINGS.md — the review of 31 October 2026

Superseded by `docs/UI-REVIEW.md`, and kept because a design review is evidence: what was wrong,
how it was measured, and what was planned in response. Every item below is now built.

## 1. The owner's verdict

> "I am not a fan of how the sidebar looks and it is cluttered. Dashboard's appearance is not what I want."

Those two are the priority. Everything in §3 is the evidence behind them and the rest of the list they
uncovered. **Do not start a new feature slice until §4 steps 1–3 are done.**

## 2. How this review was done

Every office screen rendered at 1440×900 in Chromium against the dev server, signed in as
`admin@cimmeriancrane.example`; the dashboard and the nav at 390×844; the technician list at 390×844.
Screens walked: dashboard, jobs, jobs/:id, schedule, customers, invoices, quotes, parts, cranes,
tickets, inbox, reports, profitability, calibrations, admin/users, plus the login screen.

The reference the built screens cite in comments — `app-screens.md` §2.2, §3.1, §12 — lives at
`../.agents/skills/design-taste-frontend/references/app-screens.md` (note: **outside** the app folder).

## 3. What the review found

### 3.1 The theme exists, but only five files use it

`globals.css` defines a full token set — sage frame, paper sheet, panel tone, ink, muted, faint, one
accent — with the contrast ratios measured and written down. **Five files consume it**: the office
layout, the shell nav, the dashboard, `(office)/loading.tsx`, and `components/office/ui.tsx`.

**98 files still use `slate-*`.** Counted: 470 × `text-slate-900`, 173 × `border-slate-200`,
156 × `bg-white`, 84 × `shadow-sm`. The result is that the shell and dashboard show as a designed app
and every screen you click into shows as a different, older one. This is the root of the owner's
"the dashboard is not the look I want" — the dashboard is the *only* screen that follows the theme, so
it is the one that reads as foreign next to the others.

### 3.2 The sidebar — the owner's first complaint

`src/components/office/shell-nav.tsx` renders **22 links in 5 groups**, in a 228px column with no
collapse, no search and no iconography. "Today / Asset register / Money and stock / Reporting /
Administration" are headings for what a person experiences as one long list. At 900px tall the
Administration group is cut off below the fold (visible in the screenshots). On a phone the same list
is a full-height sheet with no grouping affordance.

Concrete bugs found in the same file:

- **Active state matches parents.** `isCurrent` uses `pathname.startsWith(href + '/')`, so on
  `/reports/profitability` both **Reports** and **Profitability** highlight. Reproduced.
- **The open button overlaps the brand on a phone.** The `Menu`/`Close` button is
  `absolute top-2 left-2` from the layout, and when the sheet is open the brand link sits under it —
  the screenshot shows "Close" printed across "Cimmerian Crane". The button also sits on the paper
  sheet rather than on the ink band, which is why it reads as unstyled.
- The current row is `bg-paper` on a `bg-frame` rail — a 1.27 tone step, which is barely visible at
  a glance. The accent that the theme reserves for exactly this purpose is not used here.

### 3.3 The dashboard — the owner's second complaint

`src/app/(office)/dashboard/page.tsx`, 328 lines. As built it is: a greeting, a one-sentence finding,
a four-cell divided strip, two panels, a "Coming up" list, and a collapsed "System and permissions"
debug block. Issues visible on screen:

- **"System and permissions" is developer scaffolding on the main screen** — the database status,
  the timezone, the clock, and every capability the role holds as a chip list. It belongs in
  `/admin`, not on the dispatcher's first screen.
- **Dead space.** "On hold" and "The next 30 days" are in a 2-column grid where the short panel
  leaves a gap half the page tall. The owner saw an empty page bottom in the phone shot too.
- **"Coming up" is usually empty** — "Nothing scheduled in the next 30 days", which is what a
  system with no future work looks like, but it occupies a full-width panel to say so.
- **The figures have no scale.** `0 / 10 / 5 / 0` in "The next 30 days" — no target, no trend, no
  denominator. A dispatcher cannot tell whether 10 due is good or bad.
- **Date format is inconsistent on the same screen**: `31/10/2026` in the header,
  `28/10/2026, 17:51` in the rows, both from `formatDate`/`formatDateTime`.
- Greeting + finding + tiles say the same "how many are late" thing three times.

There is no chart, no sparkline, and no "what changed since yesterday" anywhere on the page.

### 3.4 Cross-cutting defects

| # | Finding | Evidence | Fix |
|---|---|---|---|
| 1 | **Primary buttons are the wrong colour** | 27 files use `bg-slate-900` as the primary action; only 2 use `bg-accent`. The token says the accent is spent on the primary action. | `bg-slate-900` → `bg-accent` in every action button |
| 2 | **Focus is invisible on most forms** | 46 `focus:outline-none`, 2 `focus:ring`. Tab through Jobs and the cursor disappears. WCAG 2.4.7 failure. `inputClass` does it right; most forms hand-roll their inputs instead. | Route every field through `inputClass` / `labelClass` |
| 3 | **White cards on a tinted sheet** | 156 `bg-white` + `border-slate-200` + `shadow-sm` against the sage paper reads as paper stuck on a table. `cardClass` (tone step, no border, no shadow) is the intended pattern and is already imported by 46 files. | `bg-white … border … shadow-sm` → `cardClass` |
| 4 | **Three radii and two heading scales** | `rounded-md`/`rounded-lg`/`rounded-xl` mixed; 65 × `text-2xl` headings against 1 × `text-title` | One radius (`rounded-lg`), one page-heading token |
| 5 | **The technician app is a third look** | `slate-50` ground, `rounded-xl` cards, `border-slate-200` — matches neither the office theme nor the login screen | Decide: extend the theme to the phone shell, or document it as a deliberate split |
| 6 | **The login screen is not themed at all** | `bg-slate-100`, `bg-white`, `border-slate-200`, `shadow-sm` — the first screen anyone sees is the old look | Port to the token set |

### 3.5 Unverified

Signing in as a technician during the review landed back on `/login` before `/m/jobs` rendered.
Not reproduced by hand. Check this before assuming it is a harness artefact.

---

## 4. The plan, in order

Each step is styling only — no schema, no capabilities, no service changes. Verify by eye against a
screenshot plus `npm run verify`; the e2e suite may catch text/label changes, so run it on any step
that renames a visible string.

1. **Sidebar — the owner's ask.** Collapse the 22 links into a small number of top-level
   destinations with the rest inside them (e.g. Today · Work · Register · Money · Admin), or keep the
   flat list but move it behind an overflow/command search. Fix the three bugs in §3.2 regardless.
   Agree the grouping with the owner first — it is a visible information-architecture change.
2. **Dashboard — the owner's ask.** Remove "System and permissions" to `/admin`. Rework the page so
   the four numbers carry the page without dead space: one strip, then only the panels that have
   content, and give each figure a comparison ("up 3 since yesterday"). **Agree the direction with
   the owner before building** — see §5.
3. **Buttons + focus rings + card surfaces** (§3.4 rows 1–3). Mechanical, file by file, ~10 files a
   session, table pages first (Jobs, Customers, Cranes, Parts).
4. **Login screen** (§3.4 row 6) — small, high-visibility.
5. **Technician shell** (§3.4 row 5) — decide the split first.
