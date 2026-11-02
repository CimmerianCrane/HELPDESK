# UI-REVIEW.md — the direction, and what is settled

**Status: steps 1–5 done (31 Oct 2026). The Hi-Vis Industrial direction is built.** This file is
the direction and its contrast rules — read it before touching a screen. The audit that produced it
is in [`UI-REVIEW-FINDINGS.md`](UI-REVIEW-FINDINGS.md), kept as the record of what was wrong.

## The build record


- **The theme now reaches every screen.** `globals.css` was replaced with the Hi-Vis token set and the
  class sweep in §5b moved all 98 files off `slate-*`, `bg-white` and `shadow-sm`. The login screen and
  the technician app wear the same charcoal shell, hazard band and mark as the office.
- **Status colour is semantic.** The nine-hue status palette became four tones (neutral, info,
  waiting, late). Lifecycle states are quiet; only the exception is coloured.
- **The uppercase micro-label is gone** (35 files): sentence case, same size and weight.
- Gate: `npm run verify` (463 unit), `npm run test:integration` (394), `npm run test:e2e` (51 passed,
  2 skipped), `npm run build`. Taste lint: 0 FAIL / 35 WARN, each warning exempt by the lint's own
  wording.

### the sidebar, second revision (31 Oct 2026)

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

### the one rail, third revision (1 Nov 2026)

The owner reported the sidebar was not standardised across pages. It was: the office and the field
shell shared `ShellNav`, but the **customer portal carried its own light header and a hand-written
link array**, and the old rail showed five areas with only the one you were in expanded. Settled with
the owner: **one rail on every signed-in surface, grouped and fully open.**

- **One component, one list.** `src/components/shell/shell-nav.tsx` and `src/server/auth/nav.ts`,
  rendered by the office, the field shell (browser at `lg`) and the portal. The portal's own array is
  gone. A customer is chosen by audience (`portal.read` without `dashboard.office`), not by a
  capability filter over one combined list — a customer holds `crane.read` and `certificate.read`,
  so filtering would have offered them the office's `/certificates` and `/schedules`.
- **Every section is open**, under a labelled heading: Today · Work · Register · Inventory · Money ·
  Admin. Finding a page no longer means visiting another area first. Admin stays pinned to the foot
  with the account block.
- **One line icon per page** replaces the area-initial chip, so a row says what it opens, and the
  mark is what survives the collapsed rail. Icons are inline SVG in `src/components/shell/icons.tsx`
  — no icon dependency (UI-REVIEW §6).
- **Stock takes moved from Money to a new Inventory group**, beside the parts book it counts.
- **The Menu button moved into each shell's top band** as a normal flex child. It used to float
  absolutely over the header, which forced both headers to carry a hardcoded `pl-24` to keep the
  brand clear; that padding is gone. The rail's open state is an external store read by both the rail
  and the trigger, so there is still no effect.
- **The rail is `lg:h-dvh` sticky** with its own scrolling list, so the account block stays on the
  window with every section open.

### steps 1 and 2 (§4)

- **Sidebar** (superseded by the third revision above) — `shell-nav.tsx` rendered five destinations
  (Today · Work · Register · Money · Admin), and only the area you were in showed its pages; the
  others were one link each, with a dot if anything inside was unread. The three §3.2 bugs are fixed:
  the active row is the accent (longest-prefix match, so `/reports/profitability` no longer lights
  **Reports** too), and the Menu button sat on the ink band clear of the brand and the bar.
- **Dashboard** — the finding is the page title, the strip gained "▲ 3 more than yesterday" per
  figure, "Today on the board" (today's visits + who is on call) follows it, empty panels are gone,
  and "System and permissions" moved to `/admin/system`.
- One new aggregate in `src/server/dashboard/dashboard.ts` for the comparisons and today's window;
  `tests/integration/dashboard.test.ts` proves it. No schema, no capability, no service changes
  elsewhere. Gate: `npm run verify` (463 unit), integration, `npm run test:e2e` (51 passed, 2 skipped),
  `npm run build`.

---

## 5. Decisions — settled 31 Oct 2026

Asked and answered. **Do not re-litigate these in a fresh session; build them.**

- **Sidebar: collapse to five destinations** — Today, Work, Register, Money, Admin. Each area opens
  its own sub-pages; the capability filter stays. Fewest links visible at once, which is what
  "cluttered" meant. The nav data in `(office)/layout.tsx` gains a level; `ShellNav` renders the
  current area's children.
  **Superseded 1 Nov 2026** — the owner found the areas hid too much, and the portal was a second
  shell. Now: one rail on every surface, grouped and fully open (see "the one rail, third revision").
- **Dashboard: ops board, today first.** The finding sentence becomes the page title (the greeting
  moves into it or goes), the four-tile strip stays as the hero, then "today on the board" (today's
  visits + on-call), then only the panels that have content. Each figure gains a comparison against
  yesterday ("▲ 3 since yesterday"), which needs one new aggregate in `src/server/dashboard/`.
  **"System and permissions" moves to `/admin`** — database status, timezone, clock, capability chips.
- **Technician app** — not decided. Recommended: extend the token set to the phone shell.

### Settled in the build

- Sidebar: the unread count is on the child (`Inbox`), and a dot on the collapsed **Today** area when
  the count is non-zero (as recommended). (The dot was removed with the area chips in the third
  revision; the count badge on Inbox is the only unread signal, and it is on the row itself.)
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

The look comes from the supplied taste board (`docs/assets/hi-vis-industrial.pdf`), direction 1: safety yellow
`#FFC20E`, charcoal `#1F2328`, steel `#4A5560`, signal orange, cleared green, off-white; Barlow
Condensed for headings, Inter for body, JetBrains Mono for document numbers and asset tags. The
Cimmerian Crane mark (`docs/assets/cimmerian-logo.png`, cropped to `public/cimmerian-mark.png` and
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
