import { EventsHydration } from "@/components/calendar/EventsHydration";
import { WeekView } from "@/components/calendar/WeekView";
import { MobileRedirectToDay } from "@/components/calendar/mobile/MobileRedirectToDay";
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
      <MobileRedirectToDay dateISO={date} />
      <WeekView dateISO={date} />
    </EventsHydration>
  );
}
