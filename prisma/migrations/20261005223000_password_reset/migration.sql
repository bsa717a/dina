-- AlterTable: inbox used to deliver password reset links
ALTER TABLE "User" ADD COLUMN "email" TEXT;

-- CreateIndex: one account per email
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateTable: single-use password reset tokens (only the hash is stored)
CREATE TABLE "PasswordReset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordReset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PasswordReset_tokenHash_key" ON "PasswordReset"("tokenHash");

CREATE INDEX "PasswordReset_userId_createdAt_idx" ON "PasswordReset"("userId", "createdAt");

ALTER TABLE "PasswordReset" ADD CONSTRAINT "PasswordReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
