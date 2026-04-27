@AGENTS.md

# Personal Calendar

A multi-user Google Calendar clone built in TypeScript. Day / week / month views, timed events, all-day "big events," daily todos with rollover, and RRULE-based recurrence.

## Stack (see `docs/TECH_STACK.md` for details)

Next.js 15 (App Router) · TypeScript · Postgres 16 (Docker) · Prisma · NextAuth v5 (Google OAuth) · Tailwind · shadcn/ui · React Hook Form + Zod · TanStack Query · Luxon · rrule

## Run it locally

```bash
docker-compose up -d           # start Postgres
npx prisma migrate dev         # apply schema
npm run dev                    # http://localhost:3000
```

You'll also need real values in `.env` for `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` (see `.env.example`).

## Where things live

See `docs/PROJECT_STRUCTURE.md`. Short version: pages and API routes under `src/app/`, feature components in `src/components/calendar/`, shadcn primitives in `src/components/ui/`, pure logic in `src/lib/`, shared Zod schemas in `src/schemas/`.

## Key conventions

- **Times:** store UTC in the DB, display in `America/Los_Angeles` via Luxon. Never use the raw JS `Date` for timezone math.
- **Recurrence:** RRULE strings only, parsed with the `rrule` library. No hand-rolled repeat fields.
- **Validation:** one Zod schema per entity in `src/schemas/`, shared between the form and the API route.
- **Prisma client:** always import from `@/lib/db`, never construct a new `PrismaClient()`.

---

## Documentation upkeep (important)

Three docs under `docs/` explain the project for a beginner programmer:

- `docs/TECH_STACK.md` — what each library is and does
- `docs/PROJECT_STRUCTURE.md` — what each folder is for
- `docs/DESIGN_DECISIONS.md` — why things are built the way they are

**When making changes to the code, update these three files when the change is important.** Specifically:

- Added or removed a library → update `TECH_STACK.md`
- Added, moved, or repurposed a folder → update `PROJECT_STRUCTURE.md`
- Made or reversed a design decision → add/update an entry in `DESIGN_DECISIONS.md`

**Do not** update these docs for routine edits, bug fixes, small refactors, or adding ordinary feature code that follows existing patterns. The docs are a high-level map, not a changelog.
