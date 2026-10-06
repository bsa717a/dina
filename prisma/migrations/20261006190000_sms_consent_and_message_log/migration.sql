-- Additive: SMS consent, STOP opt-out, and outbound message audit log.
-- Existing rows stay sendable only after an admin records consent.

ALTER TABLE "User" ADD COLUMN "smsConsentAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "smsConsentByUserId" TEXT;
ALTER TABLE "User" ADD COLUMN "smsConsentMethod" TEXT;
ALTER TABLE "User" ADD COLUMN "smsOptedOutAt" TIMESTAMP(3);

CREATE INDEX "User_smsConsentByUserId_idx" ON "User"("smsConsentByUserId");

ALTER TABLE "User" ADD CONSTRAINT "User_smsConsentByUserId_fkey"
  FOREIGN KEY ("smsConsentByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "SmsMessageLog" (
  "id" TEXT NOT NULL,
  "actorUserId" TEXT,
  "actorKind" TEXT NOT NULL,
  "recipientUserId" TEXT NOT NULL,
  "toPhone" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "telnyxMessageId" TEXT,
  "status" TEXT NOT NULL,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SmsMessageLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SmsMessageLog_recipientUserId_createdAt_idx"
  ON "SmsMessageLog"("recipientUserId", "createdAt");

CREATE INDEX "SmsMessageLog_actorUserId_createdAt_idx"
  ON "SmsMessageLog"("actorUserId", "createdAt");

ALTER TABLE "SmsMessageLog" ADD CONSTRAINT "SmsMessageLog_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SmsMessageLog" ADD CONSTRAINT "SmsMessageLog_recipientUserId_fkey"
  FOREIGN KEY ("recipientUserId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
