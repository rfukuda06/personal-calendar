import { prisma } from "@/lib/db";

/**
 * Returns true if the given [startUtc, endUtc) range overlaps any existing
 * non-recurring event for the user, optionally excluding one event id
 * (used on PATCH so an event isn't considered to overlap itself).
 */
export async function hasOverlappingEvent(
  userId: string,
  startUtc: Date,
  endUtc: Date,
  excludeId?: string,
): Promise<boolean> {
  const overlap = await prisma.event.findFirst({
    where: {
      userId,
      rrule: null,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      startUtc: { lt: endUtc },
      endUtc: { gt: startUtc },
    },
    select: { id: true },
  });
  return !!overlap;
}
