-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliasesJson" TEXT NOT NULL DEFAULT '[]',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Project_key_key" ON "Project"("key");

-- CreateIndex
CREATE INDEX "Project_archivedAt_idx" ON "Project"("archivedAt");

-- Seed the projects that used to live in code.
INSERT INTO "Project" ("id", "key", "name", "aliasesJson", "createdAt", "updatedAt") VALUES
  ('proj_dina', 'dina', 'Dina', '["dina project"]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('proj_beacon', 'beacon', 'Beacon', '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('proj_4studentlives', '4studentlives', '4StudentLives', '["4 student lives","four student lives","4sl"]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('proj_metabolicos', 'metabolicos', 'MetabolicOS', '["metabolic","metabolic os"]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('proj_hidden_guardians', 'hidden_guardians', 'Hidden Guardians', '["hidden guardians"]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('proj_clifsmama', 'clifsmama', 'ClifsMama', '["clifs mama","cliffsmana"]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('proj_regi', 'regi', 'Regi', '["reggie","regi-app","regi app","regi project"]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
