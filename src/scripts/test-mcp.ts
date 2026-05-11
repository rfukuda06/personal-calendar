import "dotenv/config";
import "./use-prod-db";
import { getUserId, CalendarOpError } from "../lib/calendar-ops";

async function main() {
  const uid = await getUserId();
  if (!uid || typeof uid !== "string") {
    throw new Error(`getUserId returned bad value: ${JSON.stringify(uid)}`);
  }
  console.log(`✓ getUserId: ${uid}`);
}

main().catch((e) => {
  console.error("✗ test failed:", e instanceof CalendarOpError ? `${e.code}: ${e.message}` : e);
  process.exit(1);
});
