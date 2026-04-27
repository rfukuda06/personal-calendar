import { redirect } from "next/navigation";
import { laTodayISO } from "@/lib/time";

export default function WeekIndex() {
  redirect(`/calendar/week/${laTodayISO()}`);
}
