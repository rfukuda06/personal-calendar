import { EventsHydration } from "@/components/calendar/EventsHydration";
import { WeekView } from "@/components/calendar/WeekView";
import { laDay, weekRange } from "@/lib/time";

export default async function WeekDatePage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  const { start, end } = weekRange(laDay(date));
  return (
    <EventsHydration start={start} end={end}>
      <WeekView dateISO={date} />
    </EventsHydration>
  );
}
