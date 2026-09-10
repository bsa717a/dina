-- AlterTable: add optional Slack user id for Regi roster lookup
ALTER TABLE "User" ADD COLUMN "slackUserId" TEXT;

-- CreateIndex: unique Slack user id for fast lookup
CREATE UNIQUE INDEX "User_slackUserId_key" ON "User"("slackUserId");

-- CreateIndex: index for roster lookup queries
CREATE INDEX "User_slackUserId_idx" ON "User"("slackUserId");
