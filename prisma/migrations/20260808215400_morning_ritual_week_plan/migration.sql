-- CreateTable
CREATE TABLE "MorningRitualWeekPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lessonKey" TEXT NOT NULL,
    "weekStart" TEXT NOT NULL,
    "planJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "MorningRitualWeekPlan_lessonKey_weekStart_key" ON "MorningRitualWeekPlan"("lessonKey", "weekStart");

-- CreateIndex
CREATE INDEX "MorningRitualWeekPlan_weekStart_idx" ON "MorningRitualWeekPlan"("weekStart");
