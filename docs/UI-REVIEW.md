# UI-REVIEW.md — design review, 31 October 2026

**Status: steps 1–5 done (31 Oct 2026), restyled to Hi-Vis Industrial.** The feature work
(slices 0–38) is done. This is the gap between "every screen exists and works" and "every screen looks
like the same product". Read this before touching any screen.

### Done — the Hi-Vis Industrial pass (§4 steps 1–5, §5b)

- **The theme now reaches every screen.** `globals.css` was replaced with the Hi-Vis token set and the
  class sweep in §5b moved all 98 files off `slate-*`, `bg-white` and `shadow-sm`. The login screen and
  the technician app wear the same charcoal shell, hazard band and mark as the office.
- **Status colour is semantic.** The nine-hue status palette became four tones (neutral, info,
  waiting, late). Lifecycle states are quiet; only the exception is coloured.
- **The uppercase micro-label is gone** (35 files): sentence case, same size and weight.
- Gate: `npm run verify` (463 unit), `npm run test:integration` (394), `npm run test:e2e` (51 passed,
  2 skipped), `npm run build`. Taste lint: 0 FAIL / 35 WARN, each warning exempt by the lint's own
  wording.

### Done — the sidebar, second revision (31 Oct 2026)

The owner's second look at the sidebar: *"contrast is poor and this entire sidebar feels off."* Both
were true. The first revision kept the five-area structure but left four defects on screen:

- **Rows were grey, not ink.** Nav labels sat at `on-anchor-muted` (#a8b0b8, 7.2:1). Above five rows
  at once that reads washed rather than quiet. Rows are now full `on-anchor` (14.6:1); the muted grey
  is kept for the meta under a row, where it belongs.
- **Admin floated in the middle of the list.** A settings-shaped area is a utility, and the study puts
  those at the foot of a sidebar. Admin now sits above the account block, which closes the dead band
  the five-row list left above the fold.
- **The areas had no mark.** Collapsed areas were a bare name and a chevron, so the rail had no
  rhythm and a 240px column of five rows read as a void. Every area now carries its initial on a
  chip; the chip of the area you are in is Hi-Vis, so the rail says *where* you are as well as
  *what* you are on. Pages of the current area hang under a ruled left edge.
- **There was no way to find a screen.** Twenty-two pages live one click behind five rows, so a
  finder sits above the list. The rail also collapses to 64px of marks (a remembered desktop
  preference), and the account is pinned to its foot — the phone sheet gets the same foot instead of
  ending in a void.

### Done — steps 1 and 2 (§4)

- **Sidebar** — `shell-nav.tsx` renders five destinations (Today · Work · Register · Money · Admin),
  and only the area you are in shows its pages; the others are one link each, with a dot if anything
  inside is unread. The three §3.2 bugs are fixed: the active row is the accent (longest-prefix match,
  so `/reports/profitability` no longer lights **Reports** too), and the Menu button sits on the ink
  band clear of the brand and the bar.
- **Dashboard** — the finding is the page title, the strip gained "▲ 3 more than yesterday" per
  figure, "Today on the board" (today's visits + who is on call) follows it, empty panels are gone,
  and "System and permissions" moved to `/admin/system`.
- One new aggregate in `src/server/dashboard/dashboard.ts` for the comparisons and today's window;
  `tests/integration/dashboard.test.ts` proves it. No schema, no capability, no service changes
  elsewhere. Gate: `npm run verify` (463 unit), integration, `npm run test:e2e` (51 passed, 2 skipped),
  `npm run build`.

---

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

## 5. Decisions — settled 31 Oct 2026

Asked and answered. **Do not re-litigate these in a fresh session; build them.**

- **Sidebar: collapse to five destinations** — Today, Work, Register, Money, Admin. Each area opens
  its own sub-pages; the capability filter stays. Fewest links visible at once, which is what
  "cluttered" meant. The nav data in `(office)/layout.tsx` gains a level; `ShellNav` renders the
  current area's children.
- **Dashboard: ops board, today first.** The finding sentence becomes the page title (the greeting
  moves into it or goes), the four-tile strip stays as the hero, then "today on the board" (today's
  visits + on-call), then only the panels that have content. Each figure gains a comparison against
  yesterday ("▲ 3 since yesterday"), which needs one new aggregate in `src/server/dashboard/`.
  **"System and permissions" moves to `/admin`** — database status, timezone, clock, capability chips.
- **Technician app** — not decided. Recommended: extend the token set to the phone shell.

### Settled in the build

- Sidebar: the unread count is on the child (`Inbox`), and a dot on the collapsed **Today** area when
  the count is non-zero (as recommended).
- The "yesterday" comparison is the same open-job set read at `now − 24h` through the same `jobSla`
  rule, not a second query with its own definition. Today's visit window is a wall-clock day in
  `settings.timezone` via `wallTimeToUtc`, not UTC midnight.

### Done in the build

- Steps 1–2 (sidebar, dashboard) — see §5.
- Step 3 (§3.4 rows 1–3): **done in the Hi-Vis pass, all 98 files.** `slate-*` → the token set,
  `bg-white` → `field`/`panel`, `shadow-sm` → none, `bg-slate-900` → `bg-accent`, every hand-rolled
  input → `inputClass` + `labelClass` (visible `focus:ring-2 ring-hivis/40`).
- Step 4 (login) and step 5 (technician shell): **done** — both wear the same charcoal chrome,
  hazard band and mark as the office.
- The status palette: every per-status Tailwind hue (sky, indigo, violet, teal, orange) replaced by
  the semantic tones. Lifecycle states are neutral; only the exception (waiting, late, done) is
  coloured, so a list is scanned for the coloured row rather than for a shade.
- The uppercase micro-label: retired in 35 files. Sentence case, same size and weight.

### Done — the phone list (31 Oct 2026)

The jobs table scrolled sideways at 390px, which is what made the SLA badges read as one cramped
sentence ("Response No clock") with the Priority column off-screen. The table now keeps its eight
columns from `md` up, and below it the same rows render as a two-line list — job and customer on the
top line, priority, cranes and visit date under it, the two SLA badges below that with
`whitespace-nowrap` so a label never collides with its value. No field is dropped.

### Still open in the build

- Nothing blocking. The taste lint is at 0 FAIL / 35 WARN; the warnings are monospace on literal
  identifiers, `padStart` on dates, and a loading skeleton's pulse — all exempt by the lint's own
  wording, and each is the right choice here.
- **`inspect.mjs` cannot sign in.** It has no session support, so pointed at `/dashboard` it measures
  the login screen instead (that is where its five WARNs come from). A gate on the office screens
  needs either a route the tool can reach unauthenticated or a temporary bypass; until then the
  before/after evidence is the screenshots, not the inspector.

## 5b. The direction — Hi-Vis Industrial (31 Oct 2026)

The look comes from the supplied taste board (`Hi-Vis Industrial.pdf`), direction 1: safety yellow
`#FFC20E`, charcoal `#1F2328`, steel `#4A5560`, signal orange, cleared green, off-white; Barlow
Condensed for headings, Inter for body, JetBrains Mono for document numbers and asset tags. The
Cimmerian Crane mark (`Cimmerian_Logo_nobg.png`, cropped to `public/cimmerian-mark.png` and
`public/icons/cimmerian-512.png`) sits in the sidebar, the login screen and the app icons.

**The idea:** *on this app, the crane's own hazard marking becomes the chrome.* The signature device
is the hazard band — a 45° stripe of yellow on charcoal — taken from the barriered edge every crane
wears on site, used at the top of the window's chrome and never on content. The dashboard's KPI strip
becomes the "gauge": one charcoal instrument face with a hazard stripe across it, read like a load
indicator on the machine.

**Why the primary action is charcoal, not yellow.** White on safety yellow is 1.62:1 — unusable.
Yellow therefore always takes charcoal text (9.76:1), and it is spent on the current nav row, the
one highest-priority action per screen (`hiVisButtonClass`), the warn tone on the charcoal gauge, and
the classification mark. Everything else uses the charcoal accent.

## 6. Do not

- Do not delete `globals.css` tokens or `ui.tsx` helpers — they are the target, not the problem.
- Do not edit `tests/e2e/happy-path.spec.ts` to make a restyle fit; it is the Phase 1 regression guard.
- Do not add a UI dependency for this. Everything needed is Tailwind classes and the existing tokens.
