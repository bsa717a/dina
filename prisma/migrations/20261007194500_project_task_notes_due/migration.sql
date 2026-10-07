-- Additive whiteboard fields. Existing columns are unchanged.
ALTER TABLE "ProjectTask" ADD COLUMN "notes" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ProjectTask" ADD COLUMN "dueAt" TIMESTAMP(3);
