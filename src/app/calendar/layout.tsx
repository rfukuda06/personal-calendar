import { auth } from "@/auth";
import { HeaderSwitch } from "@/components/calendar/HeaderSwitch";

export default async function CalendarLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  return (
    <div className="flex h-screen flex-col">
      <HeaderSwitch email={session?.user?.email} />
      <main className="min-h-0 flex-1">{children}</main>
    </div>
  );
}
