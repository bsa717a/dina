-- AlterTable: per-user Grok Bot webhook, encrypted sender key, and API token hash
ALTER TABLE "User" ADD COLUMN "grokWebhookUrl" TEXT;
ALTER TABLE "User" ADD COLUMN "grokWebhookSecret" TEXT;
ALTER TABLE "User" ADD COLUMN "grokApiTokenHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_grokApiTokenHash_key" ON "User"("grokApiTokenHash");
