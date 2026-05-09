-- Drop pre-existing schema drift carried over from prior edits to schema.prisma
-- (Todo.categoryId, TodoException.overrideCategoryId, User.bigEventColor,
-- User.dueDateColor). These were removed from the Prisma schema before any
-- migration was generated; rolling them in here so the DB matches.

-- DropForeignKey
ALTER TABLE "Todo" DROP CONSTRAINT IF EXISTS "Todo_categoryId_fkey";

-- AlterTable
ALTER TABLE "Todo" DROP COLUMN IF EXISTS "categoryId";

-- AlterTable
ALTER TABLE "TodoException" DROP COLUMN IF EXISTS "overrideCategoryId";

-- AlterTable
ALTER TABLE "User" DROP COLUMN IF EXISTS "bigEventColor",
DROP COLUMN IF EXISTS "dueDateColor",
ADD COLUMN "notificationsEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" TEXT,
    "bigEventId" TEXT,
    "dueDateId" TEXT,
    "offsetMinutes" INTEGER,
    "daysBefore" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderSend" (
    "id" TEXT NOT NULL,
    "reminderId" TEXT NOT NULL,
    "occurrenceKey" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReminderSend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TodoDigestSend" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "digestDate" DATE NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TodoDigestSend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Reminder_userId_idx" ON "Reminder"("userId");

-- CreateIndex
CREATE INDEX "Reminder_eventId_idx" ON "Reminder"("eventId");

-- CreateIndex
CREATE INDEX "Reminder_bigEventId_idx" ON "Reminder"("bigEventId");

-- CreateIndex
CREATE INDEX "Reminder_dueDateId_idx" ON "Reminder"("dueDateId");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderSend_reminderId_occurrenceKey_key" ON "ReminderSend"("reminderId", "occurrenceKey");

-- CreateIndex
CREATE UNIQUE INDEX "TodoDigestSend_userId_digestDate_key" ON "TodoDigestSend"("userId", "digestDate");

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_bigEventId_fkey" FOREIGN KEY ("bigEventId") REFERENCES "BigEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_dueDateId_fkey" FOREIGN KEY ("dueDateId") REFERENCES "DueDate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderSend" ADD CONSTRAINT "ReminderSend_reminderId_fkey" FOREIGN KEY ("reminderId") REFERENCES "Reminder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TodoDigestSend" ADD CONSTRAINT "TodoDigestSend_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
