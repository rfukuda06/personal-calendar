import "dotenv/config";
import "./use-prod-db";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/mcp/server.mjs"],
    env: { ...process.env, DATABASE_URL_PROD: process.env.DATABASE_URL_PROD! },
  });
  const client = new Client({ name: "smoke-test", version: "1.0.0" });
  await client.connect(transport);

  const tools = await client.listTools();
  console.log(`✓ ${tools.tools.length} tools registered`);
  if (tools.tools.length < 28) throw new Error(`expected ≥28 tools, got ${tools.tools.length}`);

  const evRes = await client.callTool({
    name: "list_events",
    arguments: { from: "2026-05-12", to: "2026-05-12" },
  });
  const evContent = evRes.content as Array<{ text: string }>;
  const evs = JSON.parse(evContent[0].text);
  if (!Array.isArray(evs)) throw new Error(`list_events returned non-array: ${JSON.stringify(evs)}`);
  console.log(`✓ list_events(May 12): ${evs.length} events`);

  const catRes = await client.callTool({ name: "list_categories", arguments: {} });
  const catContent = catRes.content as Array<{ text: string }>;
  const cats = JSON.parse(catContent[0].text);
  console.log(`✓ list_categories: ${cats.length} categories`);

  // Round-trip: create → list → delete a throwaway event.
  const created = await client.callTool({
    name: "create_event",
    arguments: {
      body: {
        title: "[mcp smoke] DELETE ME",
        startUtc: "2026-12-31T23:00",
        endUtc: "2026-12-31T23:30",
      },
    },
  });
  const createdContent = created.content as Array<{ text: string }>;
  const createdObj = JSON.parse(createdContent[0].text);
  console.log(`✓ create_event: ${createdObj.id}`);

  await client.callTool({ name: "delete_event", arguments: { id: createdObj.id } });
  console.log(`✓ delete_event: ${createdObj.id}`);

  await client.close();
  console.log("✓ all smoke tests passed");
}

main().catch((e) => {
  console.error("✗ smoke test failed:", e);
  process.exit(1);
});
