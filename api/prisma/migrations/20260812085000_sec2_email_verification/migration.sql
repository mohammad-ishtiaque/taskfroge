-- Email verification: the column and the table.
--
-- Both have been in schema.prisma for some time with no migration behind them,
-- which is why `prisma generate` and the database disagreed — the generated
-- client selected `User.emailVerifiedAt` on every user read and Postgres had
-- never heard of it. Every test that touched a user failed with the same line.
--
-- Numbered before the SEC1 migration on purpose: this is the older debt, and
-- ordering it first keeps the two related auth migrations adjacent in the log.
--
-- The service that uses `EmailVerification` is still to come (SEC2). Creating
-- the table now is deliberate: a schema that lies about the database is worse
-- than a table with no reader, and the lie is what broke the suite.

ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

CREATE TABLE "EmailVerification" (
    "id"            UUID         NOT NULL DEFAULT gen_random_uuid(),
    "userId"        UUID         NOT NULL,
    "email"         TEXT         NOT NULL,
    -- The clickable link.
    "tokenHash"     TEXT         NOT NULL,
    -- The 6-digit code, for typing in. Hashed, because it is a credential.
    "otpHash"       TEXT         NOT NULL,
    -- Binds the flow to the browser that started it. Same reasoning as SEC1.
    "challengeHash" TEXT         NOT NULL,
    "attempts"      INTEGER      NOT NULL DEFAULT 0,
    -- Enforces the resend cooldown without needing a second table.
    "lastSentAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sendCount"     INTEGER      NOT NULL DEFAULT 1,
    "expiresAt"     TIMESTAMP(3) NOT NULL,
    "usedAt"        TIMESTAMP(3),
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailVerification_tokenHash_key" ON "EmailVerification"("tokenHash");
CREATE INDEX "EmailVerification_userId_usedAt_idx" ON "EmailVerification"("userId", "usedAt");
CREATE INDEX "EmailVerification_expiresAt_idx" ON "EmailVerification"("expiresAt");

ALTER TABLE "EmailVerification"
  ADD CONSTRAINT "EmailVerification_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Everyone who already has an account got it before verification existed, and
-- they proved control of the address by being invited to it or by resetting a
-- password through it. Marking them verified rather than locking them out is
-- the only defensible reading of "existing user".
UPDATE "User" SET "emailVerifiedAt" = "createdAt" WHERE "emailVerifiedAt" IS NULL;
