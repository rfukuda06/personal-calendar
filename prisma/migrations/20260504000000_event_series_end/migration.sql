-- Add seriesEndUtc to Event so we can prune finished recurring series in SQL
-- without expanding them.
ALTER TABLE "Event" ADD COLUMN "seriesEndUtc" TIMESTAMP(3);
