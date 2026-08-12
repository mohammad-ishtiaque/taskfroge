-- Web push: one row per browser that has agreed to be notified.
--
-- Keyed on `endpoint` rather than on (userId, device): the endpoint is what a
-- push service issues and what it recognises, and a browser that re-subscribes
-- presents the same one. Making it unique turns "subscribe again" into an
-- update instead of a slow accumulation of dead rows that every send has to
-- try and fail against.

CREATE TABLE "PushSubscription" (
    "id"         UUID         NOT NULL DEFAULT gen_random_uuid(),
    "userId"     UUID         NOT NULL,
    "endpoint"   TEXT         NOT NULL,
    "p256dh"     TEXT         NOT NULL,
    "auth"       TEXT         NOT NULL,
    "label"      TEXT,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- Cascade: a deleted account should not leave a browser subscribed to
-- notifications about work it can no longer see.
ALTER TABLE "PushSubscription"
  ADD CONSTRAINT "PushSubscription_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
