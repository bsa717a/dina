-- AlterTable
ALTER TABLE "Message" ADD COLUMN "starredAt" DATETIME;

-- CreateIndex
CREATE INDEX "Message_starredAt_idx" ON "Message"("starredAt");
