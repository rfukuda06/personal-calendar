import { DayViewSwitch } from "@/components/calendar/DayViewSwitch";
import { EventsHydration } from "@/components/calendar/EventsHydration";
import { dayRange, laDay } from "@/lib/time";

export default async function DayDatePage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  const { start, end } = dayRange(laDay(date));
  return (
    <EventsHydration start={start} end={end}>
      <DayViewSwitch dateISO={date} />
    </EventsHydration>
  );
}
