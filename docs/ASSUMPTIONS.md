# ASSUMPTIONS.md

Every assumption made where the brief was silent or ambiguous. Each has the assumption, why, and what it costs if wrong.
**Nothing here blocks Phase 1.** Items marked ⚑ should be confirmed before the phase noted.

## Where the code lives

1. **The app sits in `cimmerian-crane/`, not the folder root.** The sandbox `../CLAUDE.md` says this folder is a
   general-purpose sandbox with no project and that real project work should move into a subfolder. Kept that rule and
   left `../CLAUDE.md` untouched. *If wrong:* move the directory contents up one level — nothing references the path.

## From the brief's open questions (§15)

2. **AE relationship — assume we do not employ an AE; we support AE-led exams.** Work is scheduled, prepared and
   followed up by us; the certificate is issued by an external AE and stored against the crane.
   *Design impact:* `ComplianceRule.requiresAE` and `Certificate.issuer` already model this either way.
   ⚑ Confirm before Phase 2 ships the certificate workflow.
3. **Accounting — assume CSV export first, Xero later.** No accounting API integration in Phase 1 or 2.
   ⚑ Confirm before Phase 2's export adapter is built, since the CSV column shape is vendor-specific.
4. **Technicians use both Android and iOS.** Drives the PWA choice over a native app. *Cost if wrong:* a
   single-platform native app could use the camera and barcode APIs more directly; the PWA already covers both.
5. **Scale — assume ≲ 500 cranes, ≲ 100 customers, ≲ 20 technicians, data arriving as spreadsheets.** Comfortably
   handles single-instance Postgres and the index set in `PLAN.md` §3.10. *If wrong:* hosting and indexing get
   revisited, not the schema.
6. **Hosting — assume a single cloud VM or container host running the Next.js server, the worker and Postgres.**
   This is what makes Playwright/Chromium and pg-boss cheap. ⚑ Confirm before deployment work starts — a
   serverless host would force a different PDF and queue choice.
7. **WhatsApp intake — assume Phase 1 is phone/email/web form only.** `TicketSource` already has a `WHATSAPP` value
   so adding the channel later is an adapter, not a migration.

## Technical assumptions

8. **Auth.js uses JWT sessions (no `Account`/`Session` tables).** Credentials-only login. Role is read from the DB per
   request so a role change takes effect immediately. *Cost if wrong:* adding DB sessions later is one Prisma model
   plus a sweep job.
9. **PDF via Playwright/Chromium** — justified in `PLAN.md` §2. Renders in the worker, so it never blocks a request.
10. **Background jobs via pg-boss** on the existing Postgres. Single worker process (`npm run worker`).
11. **Money as `Decimal(12,2)`, quantities as `Decimal(12,3)`** (parts are measured in metres and kilograms).
12. **Single-tenant, single-company deployment.** No tenant column anywhere. *If wrong:* this is the one assumption
    that would touch every table — worth confirming early, though nothing suggests multi-tenancy is wanted.
13. **IDs are UUID v7** (time-sortable, so index locality stays good) and are **client-generatable**, which the
    offline sync in Phase 1 slice 8 depends on. This is why they are not auto-increment integers.
14. **A `CHECK` constraint enforces `ON_HOLD` requires a reason at the database level**, in addition to service-layer
    validation. The brief states the rule twice; the constraint means no future code path can violate it.
15. **Photographs are compressed client-side before upload** (target ~1600px longest edge) and stored as separate
    files referenced by `File` rows, not inline in `Report.data`.
16. **`StockLevel` is a materialised total reconciled from `StockMovement`.** Movements remain the only way quantities
    change; the level row exists so list screens don't re-aggregate the whole movement history.
17. **GST rate is snapshotted onto the invoice at issue time** rather than read live from settings, so reprinting an
    old invoice shows the rate that applied then.
18. **Report `DRAFT` state is per-technician-per-crane.** A job covering several cranes produces one report per crane,
    which is what makes the crane timeline and the certificate linkage work.

## Not assumed — deliberately left to you

- The **document number formats** (`JOB-2026-0001`, `RPT-2026-0001`, `DO-…`, `INV-…`) are placeholders. They live in
  `DocumentSequence` and are a one-line change each once you confirm the format you want.
- The **SLA minutes per priority** are seeded as plausible defaults only, because the real numbers are contractual.
- The **checklist item wording** for the four Phase 1 templates follows the components named in brief §6.3 and is
  marked for review by your technicians before it is used on a real job.
