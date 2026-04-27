import { MonthView } from "@/components/calendar/MonthView";

export default async function MonthDatePage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  return <MonthView dateISO={date} />;
}
