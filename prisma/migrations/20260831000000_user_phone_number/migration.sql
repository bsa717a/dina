-- AlterTable: add optional phone number for RCS/SMS roster lookup
ALTER TABLE "User" ADD COLUMN "phoneNumber" TEXT;

-- CreateIndex: unique phone number for fast lookup
CREATE UNIQUE INDEX "User_phoneNumber_key" ON "User"("phoneNumber");

-- CreateIndex: index for roster lookup queries
CREATE INDEX "User_phoneNumber_idx" ON "User"("phoneNumber");
