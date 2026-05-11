import "dotenv/config";
import "./use-prod-db";
import {
  getUserId,
  listEventsOp,
  listTodosOp,
  listBigEventsOp,
  listDueDatesOp,
  listCategoriesOp,
  CalendarOpError,
} from "../lib/calendar-ops";

async function main() {
  const uid = await getUserId();
  console.log(`✓ getUserId: ${uid}`);

  const events = await listEventsOp(uid, { from: "2026-05-12", to: "2026-05-12" });
  console.log(`✓ listEventsOp(May 12): ${events.length} events`);

  const todos = await listTodosOp(uid, { from: "2026-05-12", to: "2026-05-13" });
  console.log(`✓ listTodosOp(May 12-13): ${todos.length} todos`);

  const bigs = await listBigEventsOp(uid, { from: "2026-05-12", to: "2026-05-15" });
  console.log(`✓ listBigEventsOp(May 12-15): ${bigs.length} big events`);

  const dues = await listDueDatesOp(uid, { from: "2026-05-12", to: "2026-05-13" });
  console.log(`✓ listDueDatesOp(May 12-13): ${dues.length} due dates`);

  const cats = await listCategoriesOp(uid);
  console.log(`✓ listCategoriesOp: ${cats.length} categories`);
}

main().catch((e) => {
  console.error("✗ test failed:", e instanceof CalendarOpError ? `${e.code}: ${e.message}` : e);
  process.exit(1);
});
