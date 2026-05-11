import "dotenv/config";
import "./use-prod-db";
import { getUserId, listEventsOp, CalendarOpError } from "../lib/calendar-ops";

async function main() {
  const uid = await getUserId();
  console.log(`✓ getUserId: ${uid}`);

  const events = await listEventsOp(uid, { from: "2026-05-12", to: "2026-05-12" });
  if (!Array.isArray(events)) throw new Error(`listEventsOp returned non-array: ${JSON.stringify(events)}`);
  console.log(`✓ listEventsOp(May 12): ${events.length} events`);
  for (const e of events) console.log(`  - ${e.title} ${e.startUtc} → ${e.endUtc}`);
}

main().catch((e) => {
  console.error("✗ test failed:", e instanceof CalendarOpError ? `${e.code}: ${e.message}` : e);
  process.exit(1);
});
