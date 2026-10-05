-- AlterTable: invalidate sessions issued before a password change
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
