import { auth } from "@/auth";
import { CalendarHeader } from "@/components/calendar/CalendarHeader";

export default async function CalendarLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  return (
    <div className="flex h-screen flex-col">
      <CalendarHeader email={session?.user?.email} />
      <main className="min-h-0 flex-1">{children}</main>
    </div>
  );
}
