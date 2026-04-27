import { redirect } from "next/navigation";
import { laTodayISO } from "@/lib/time";

export default function MonthIndex() {
  redirect(`/calendar/month/${laTodayISO()}`);
}
