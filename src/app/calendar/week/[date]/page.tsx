import { WeekView } from "@/components/calendar/WeekView";

export default async function WeekDatePage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  return <WeekView dateISO={date} />;
}
