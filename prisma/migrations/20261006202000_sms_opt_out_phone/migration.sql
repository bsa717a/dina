-- Remember which E.164 texted STOP so clearing or replacing the saved
-- number cannot drop that opt-out. START from that number clears it.

ALTER TABLE "User" ADD COLUMN "smsOptedOutPhone" TEXT;

UPDATE "User"
SET "smsOptedOutPhone" = "phoneNumber"
WHERE "smsOptedOutAt" IS NOT NULL
  AND "phoneNumber" IS NOT NULL
  AND "smsOptedOutPhone" IS NULL;
