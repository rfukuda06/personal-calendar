-- CreateTable
CREATE TABLE "DueDate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "categoryId" TEXT,
    "title" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "rrule" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DueDate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DueDateException" (
    "id" TEXT NOT NULL,
    "dueDateId" TEXT NOT NULL,
    "originalDueAt" TIMESTAMP(3) NOT NULL,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "overrideTitle" TEXT,
    "overrideDueAt" TIMESTAMP(3),
    "overrideCategoryId" TEXT,

    CONSTRAINT "DueDateException_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DueDate_userId_dueAt_idx" ON "DueDate"("userId", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "DueDateException_dueDateId_originalDueAt_key" ON "DueDateException"("dueDateId", "originalDueAt");

-- AddForeignKey
ALTER TABLE "DueDate" ADD CONSTRAINT "DueDate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DueDate" ADD CONSTRAINT "DueDate_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DueDateException" ADD CONSTRAINT "DueDateException_dueDateId_fkey" FOREIGN KEY ("dueDateId") REFERENCES "DueDate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
