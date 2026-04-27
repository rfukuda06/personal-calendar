import { DayView } from "@/components/calendar/DayView";

export default async function DayDatePage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  return <DayView dateISO={date} />;
}
