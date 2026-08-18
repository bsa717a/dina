-- CreateTable
CREATE TABLE "MorningBriefPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sectionsJson" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'ready',
    "pendingReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MorningBriefPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MorningBriefPreference_userId_key" ON "MorningBriefPreference"("userId");

-- CreateIndex
CREATE INDEX "MorningBriefPreference_status_idx" ON "MorningBriefPreference"("status");

-- AddForeignKey
ALTER TABLE "MorningBriefPreference" ADD CONSTRAINT "MorningBriefPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
