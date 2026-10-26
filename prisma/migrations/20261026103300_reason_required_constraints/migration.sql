-- CHECK constraints that Prisma cannot express in schema.prisma.
--
-- The brief states twice (§4.2, §4.3) that an on-hold job must carry a reason, and that a crane
-- flagged Restricted / Do Not Operate must say why. Both are also validated in the service layer.
-- Enforcing them in the database means no future code path — an import script, a migration, a
-- console session — can produce a row that violates the rule.

ALTER TABLE "Job" ADD CONSTRAINT "job_on_hold_requires_reason"
  CHECK (status <> 'ON_HOLD' OR "onHoldReason" IS NOT NULL);

ALTER TABLE "Crane" ADD CONSTRAINT "crane_restricted_requires_reason"
  CHECK (status <> 'RESTRICTED' OR "restrictedReason" IS NOT NULL);
