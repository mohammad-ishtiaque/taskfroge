-- M2 — Workspaces, Tasks, Comments, Activity, Notifications
--
-- Hand-written rather than generated, because `Project.workspaceId` is NOT NULL
-- and the table already has rows. Prisma refuses that, correctly: there is no
-- value it could invent. The order below is the answer —
--
--   create the table → create a workspace per organisation → backfill →
--   only then add the constraint
--
-- which is the same shape any production migration adding a required foreign
-- key has to take.

-- ─── New enums ──────────────────────────────────────────────────────────────

CREATE TYPE "Priority" AS ENUM ('URGENT', 'HIGH', 'MEDIUM', 'LOW');
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'DONE');
CREATE TYPE "TaskType" AS ENUM ('TASK', 'BUG', 'STORY', 'CHORE');
CREATE TYPE "ActivityKind" AS ENUM (
  'TASK_CREATED', 'STATUS_CHANGED', 'ASSIGNED', 'COMMENTED',
  'DUE_DATE_CHANGED', 'BLOCKED', 'UNBLOCKED', 'VISIBILITY_CHANGED'
);
CREATE TYPE "NotificationKind" AS ENUM (
  'ASSIGNED', 'MENTIONED', 'STATUS_CHANGED', 'DUE_SOON', 'OVERDUE', 'COMMENT'
);

-- ─── ProjectStatus: ACTIVE|ARCHIVED becomes five states ────────────────────
--
-- PostgreSQL can add enum values but not remove them, so the type is replaced
-- and the column cast across.
--
-- ARCHIVED maps to ACTIVE, which looks wrong and is not. Those rows already
-- have `archivedAt` set — that is now the only thing that records archiving,
-- and every query filters on it. Mapping to COMPLETED or CANCELLED would be
-- inventing a fact about work nobody recorded.

CREATE TYPE "ProjectStatus_new" AS ENUM ('PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED');

ALTER TABLE "Project" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "Project"
  ALTER COLUMN "status" TYPE "ProjectStatus_new"
  USING (CASE WHEN "status"::text = 'ARCHIVED' THEN 'ACTIVE' ELSE "status"::text END)::"ProjectStatus_new";

ALTER TYPE "ProjectStatus" RENAME TO "ProjectStatus_old";
ALTER TYPE "ProjectStatus_new" RENAME TO "ProjectStatus";
DROP TYPE "ProjectStatus_old";

ALTER TABLE "Project" ALTER COLUMN "status" SET DEFAULT 'PLANNING';

-- ─── Workspace ──────────────────────────────────────────────────────────────

CREATE TABLE "Workspace" (
    "id"         UUID NOT NULL,
    "orgId"      UUID NOT NULL,
    "slug"       TEXT NOT NULL,
    "name"       TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Workspace_orgId_slug_key" ON "Workspace"("orgId", "slug");
CREATE INDEX "Workspace_orgId_idx" ON "Workspace"("orgId");

ALTER TABLE "Workspace"
  ADD CONSTRAINT "Workspace_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Project gains its new columns ─────────────────────────────────────────

ALTER TABLE "Project"
  ADD COLUMN "workspaceId" UUID,                                   -- nullable for now
  ADD COLUMN "priority"    "Priority" NOT NULL DEFAULT 'MEDIUM',
  ADD COLUMN "startDate"   TIMESTAMP(3),
  ADD COLUMN "endDate"     TIMESTAMP(3),
  ADD COLUMN "leadId"      UUID;

-- One workspace per organisation, holding whatever already exists. Named after
-- the organisation because that is the only true thing we know at this point;
-- rename it afterwards in the UI.
INSERT INTO "Workspace" ("id", "orgId", "slug", "name", "clientName", "createdAt", "updatedAt")
SELECT gen_random_uuid(), o."id", 'general', o."name", o."name", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Organization" o
WHERE EXISTS (SELECT 1 FROM "Project" p WHERE p."orgId" = o."id");

UPDATE "Project" p
SET "workspaceId" = w."id"
FROM "Workspace" w
WHERE w."orgId" = p."orgId" AND w."slug" = 'general';

-- Every row now has a value, so the constraint can go on.
ALTER TABLE "Project" ALTER COLUMN "workspaceId" SET NOT NULL;

CREATE INDEX "Project_workspaceId_idx" ON "Project"("workspaceId");

ALTER TABLE "Project"
  ADD CONSTRAINT "Project_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Project"
  ADD CONSTRAINT "Project_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Task ───────────────────────────────────────────────────────────────────

CREATE TABLE "Task" (
    "id"              UUID NOT NULL,
    "orgId"           UUID NOT NULL,
    "projectId"       UUID NOT NULL,
    "parentId"        UUID,
    "number"          INTEGER NOT NULL,
    "key"             TEXT NOT NULL,
    "title"           TEXT NOT NULL,
    "description"     TEXT,
    "type"            "TaskType" NOT NULL DEFAULT 'TASK',
    "status"          "TaskStatus" NOT NULL DEFAULT 'TODO',
    "priority"        "Priority" NOT NULL DEFAULT 'MEDIUM',
    "assigneeId"      UUID,
    "reporterId"      UUID NOT NULL,
    "dueDate"         TIMESTAMP(3),
    "estimateHours"   DECIMAL(6,2),
    "loggedHours"     DECIMAL(6,2) NOT NULL DEFAULT 0,
    "blockedReason"   TEXT,
    "clientVisible"   BOOLEAN NOT NULL DEFAULT true,
    "labels"          TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,
    "archivedAt"      TIMESTAMP(3),
    "reminderSentAt"  TIMESTAMP(3),
    "overdueNotified" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Task_projectId_number_key" ON "Task"("projectId", "number");
CREATE UNIQUE INDEX "Task_orgId_key_key" ON "Task"("orgId", "key");
CREATE INDEX "Task_projectId_status_idx" ON "Task"("projectId", "status");
CREATE INDEX "Task_assigneeId_status_idx" ON "Task"("assigneeId", "status");
CREATE INDEX "Task_parentId_idx" ON "Task"("parentId");
-- The nightly deadline job scans on this. Without it that is a full table scan.
CREATE INDEX "Task_dueDate_status_idx" ON "Task"("dueDate", "status");

ALTER TABLE "Task" ADD CONSTRAINT "Task_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeId_fkey"
  FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_reporterId_fkey"
  FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Comment ────────────────────────────────────────────────────────────────

CREATE TABLE "Comment" (
    "id"         UUID NOT NULL,
    "orgId"      UUID NOT NULL,
    "taskId"     UUID NOT NULL,
    "authorId"   UUID NOT NULL,
    "body"       TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3) NOT NULL,
    "deletedAt"  TIMESTAMP(3),

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Comment_taskId_createdAt_idx" ON "Comment"("taskId", "createdAt");

ALTER TABLE "Comment" ADD CONSTRAINT "Comment_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Activity ───────────────────────────────────────────────────────────────

CREATE TABLE "Activity" (
    "id"            UUID NOT NULL,
    "orgId"         UUID NOT NULL,
    "projectId"     UUID NOT NULL,
    "taskId"        UUID,
    "actorId"       UUID NOT NULL,
    "kind"          "ActivityKind" NOT NULL,
    "detail"        JSONB NOT NULL DEFAULT '{}',
    "clientVisible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Activity_projectId_createdAt_idx" ON "Activity"("projectId", "createdAt");
CREATE INDEX "Activity_taskId_idx" ON "Activity"("taskId");

ALTER TABLE "Activity" ADD CONSTRAINT "Activity_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Notification ───────────────────────────────────────────────────────────

CREATE TABLE "Notification" (
    "id"          UUID NOT NULL,
    "orgId"       UUID NOT NULL,
    "recipientId" UUID NOT NULL,
    "actorId"     UUID,
    "kind"        "NotificationKind" NOT NULL,
    "taskId"      UUID,
    "taskKey"     TEXT NOT NULL,
    "taskTitle"   TEXT NOT NULL,
    "projectKey"  TEXT NOT NULL,
    "readAt"      TIMESTAMP(3),
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- Powers the unread badge, which loads on every page.
CREATE INDEX "Notification_recipientId_readAt_idx" ON "Notification"("recipientId", "readAt");

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientId_fkey"
  FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
