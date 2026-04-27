import Link from "next/link";
import { CategoriesManager } from "@/components/calendar/CategoriesManager";

export default function CategoriesPage() {
  return (
    <div className="mx-auto max-w-2xl p-8">
      <nav className="mb-6 text-sm">
        <Link href="/calendar/week" className="text-muted-foreground hover:underline">
          ← Back to calendar
        </Link>
      </nav>
      <h1 className="mb-6 text-2xl font-semibold">Categories</h1>
      <CategoriesManager />
    </div>
  );
}
