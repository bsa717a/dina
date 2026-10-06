-- Attach tasks to sections without deleting tasks when a section is removed.
-- Orphan ids are ungrouped first so the foreign key can be added on existing data.

UPDATE "ProjectTask"
SET "sectionId" = NULL
WHERE "sectionId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "ProjectSection" WHERE "ProjectSection"."id" = "ProjectTask"."sectionId"
  );

ALTER TABLE "ProjectTask"
ADD CONSTRAINT "ProjectTask_sectionId_fkey"
FOREIGN KEY ("sectionId") REFERENCES "ProjectSection"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
