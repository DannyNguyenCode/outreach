-- Enforce at most one active (unconsumed) token per user and purpose.
-- Defense in depth alongside advisory-locked issuance transactions.
CREATE UNIQUE INDEX "AuthToken_userId_purpose_active_key"
ON "AuthToken" ("userId", "purpose")
WHERE "consumedAt" IS NULL;
