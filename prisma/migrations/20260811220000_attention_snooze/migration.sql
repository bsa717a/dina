-- AlterTable
ALTER TABLE "AttentionItem" ADD COLUMN "snoozedUntil" DATETIME;

-- CreateIndex
CREATE INDEX "AttentionItem_status_snoozedUntil_idx" ON "AttentionItem"("status", "snoozedUntil");
