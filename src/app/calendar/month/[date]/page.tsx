import { EventsHydration } from "@/components/calendar/EventsHydration";
import { MonthView } from "@/components/calendar/MonthView";
import { MobileRedirectToDay } from "@/components/calendar/mobile/MobileRedirectToDay";
import { laDay, monthGridRange } from "@/lib/time";

export default async function MonthDatePage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  const { start, end } = monthGridRange(laDay(date));
  return (
    <EventsHydration start={start} end={end}>
      <MobileRedirectToDay dateISO={date} />
      <MonthView dateISO={date} />
    </EventsHydration>
  );
}
