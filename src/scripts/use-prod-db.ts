// Preload hook: rewrite DATABASE_URL to DATABASE_URL_PROD before the script
// imports Prisma. Loaded via `tsx -r dotenv/config -r .../use-prod-db.ts`, so
// dotenv has already populated process.env by the time this runs.
if (!process.env.DATABASE_URL_PROD) {
  process.stderr.write(
    JSON.stringify({ error: "DATABASE_URL_PROD is not set in .env" }) + "\n",
  );
  process.exit(1);
}
process.env.DATABASE_URL = process.env.DATABASE_URL_PROD;
