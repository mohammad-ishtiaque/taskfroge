-- SEC1: bind a password reset to the browser that asked for it.
--
-- Five columns on PasswordResetToken. Order matters for `challengeHash`, which
-- is NOT NULL and lands on a table that may already hold rows.
--
--   challengeHash  sha256 of the secret held by the requesting browser
--   otpHash        sha256 of the 6-digit cross-device code
--   attempts       wrong codes so far; five and the row is burned
--   requestIp      truncated to a /24, enough to recognise your own network
--   requestAgent   "Chrome on Windows", for the "was this you" line

ALTER TABLE "PasswordResetToken"
  ADD COLUMN "otpHash"      TEXT,
  ADD COLUMN "attempts"     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "requestIp"    TEXT,
  ADD COLUMN "requestAgent" TEXT;

-- Nullable first, then filled, then made NOT NULL. Adding it as NOT NULL
-- outright fails on any table with rows, and this one has them in every
-- environment that has ever had someone click "forgot password".
ALTER TABLE "PasswordResetToken" ADD COLUMN "challengeHash" TEXT;

-- Existing tokens were issued under the old single-secret rule and have no
-- challenge to compare against. Rather than invent one, they are marked spent:
-- an outstanding reset link from before this migration stops working, and the
-- person clicks "forgot password" again.
--
-- That is the conservative direction. The alternative — leaving them live with
-- an unmatchable hash — would produce a link that fails with "wrong browser"
-- no matter what the user does, including entering a code that does not exist.
UPDATE "PasswordResetToken"
   SET "challengeHash" = 'superseded-by-sec1',
       "usedAt"        = COALESCE("usedAt", NOW())
 WHERE "challengeHash" IS NULL;

ALTER TABLE "PasswordResetToken" ALTER COLUMN "challengeHash" SET NOT NULL;
