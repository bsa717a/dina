-- AlterTable
ALTER TABLE "User" ADD COLUMN "username" TEXT;
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "assistantKey" TEXT;

UPDATE "User"
SET
  "username" = CASE
    WHEN "role" = 'owner' THEN 'derek'
    ELSE lower(regexp_replace(coalesce("name", 'user'), '[^a-zA-Z0-9]+', '', 'g')) || substr("id", 1, 4)
  END,
  "passwordHash" = "accessCodeHash",
  "mustChangePassword" = CASE WHEN "role" = 'owner' THEN false ELSE true END,
  "assistantKey" = CASE WHEN "role" = 'owner' THEN 'dina' ELSE NULL END;

ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;
ALTER TABLE "User" ALTER COLUMN "passwordHash" SET NOT NULL;

CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

ALTER TABLE "User" DROP COLUMN "accessCodeHash";
