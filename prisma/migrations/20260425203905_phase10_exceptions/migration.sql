-- CreateTable
CREATE TABLE "BigEventException" (
    "id" TEXT NOT NULL,
    "bigEventId" TEXT NOT NULL,
    "originalDate" DATE NOT NULL,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "overrideTitle" TEXT,
    "overrideNotes" TEXT,
    "overrideCategoryId" TEXT,

    CONSTRAINT "BigEventException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TodoException" (
    "id" TEXT NOT NULL,
    "todoId" TEXT NOT NULL,
    "occurrenceDate" DATE NOT NULL,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "overrideTitle" TEXT,
    "overrideNotes" TEXT,
    "overrideCategoryId" TEXT,

    CONSTRAINT "TodoException_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BigEventException_bigEventId_originalDate_key" ON "BigEventException"("bigEventId", "originalDate");

-- CreateIndex
CREATE UNIQUE INDEX "TodoException_todoId_occurrenceDate_key" ON "TodoException"("todoId", "occurrenceDate");

-- AddForeignKey
ALTER TABLE "BigEventException" ADD CONSTRAINT "BigEventException_bigEventId_fkey" FOREIGN KEY ("bigEventId") REFERENCES "BigEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TodoException" ADD CONSTRAINT "TodoException_todoId_fkey" FOREIGN KEY ("todoId") REFERENCES "Todo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
