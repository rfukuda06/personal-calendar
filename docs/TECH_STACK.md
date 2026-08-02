# Tech Stack

A plain-English walkthrough of every tool we use, what problem it solves, and how it fits into this calendar app.

---

## TypeScript

JavaScript with types. You write `function add(a: number, b: number): number` and the compiler catches mistakes *before* you run the code (e.g., passing a string where a number is expected). In this project, every file is TypeScript — frontend, backend, database queries — so a typo in a column name or a wrong shape for an event object is caught immediately.

## Next.js

A React framework. Plain React only runs in the browser; Next.js lets us write React *plus* a server in one project. Two things it gives us:

1. **Pages** — files in `src/app/` become URLs. `src/app/calendar/day/[date]/page.tsx` is the `/calendar/day/2026-05-01` page.
2. **API routes** — files in `src/app/api/` are server endpoints. `src/app/api/events/route.ts` handles `GET /api/events`. The browser calls these from React code to create/read/update events.

We use the **App Router** (the modern routing system) and **Turbopack** (the fast dev bundler).

## React

The UI library. You build screens out of components (functions that return JSX/HTML). When state changes, React re-renders only what changed. Every file under `src/components/` and `src/app/**/page.tsx` is React.

## Tailwind CSS

Styling via class names instead of separate CSS files. `<div className="flex gap-2 p-4 bg-white">` — that's flexbox, padding, background, all without writing CSS. It keeps styles close to the markup and avoids the usual "which CSS file controls this element?" hunt.

## shadcn/ui

Pre-built, accessible React components (Dialog, Button, Popover, Select, Calendar date picker, etc.) that get **copied into your project** rather than installed as a dependency. This means we own the code and can edit it. Built on top of Radix primitives for accessibility. We'll use it for all dialogs and form controls.

## Postgres

The database. Stores all users, events, todos, categories as rows in tables. Relational (tables with foreign keys between them), ACID (safe transactions), and standard SQL.

## Docker / Docker Compose

A way to run software in isolated containers. Our `docker-compose.yml` spins up a real Postgres server locally with one command (`docker-compose up -d`) — no installing Postgres on your Mac, no polluting your system. Delete the volume and your DB is gone; clean state whenever you want.

## Prisma

An ORM (Object-Relational Mapper). Three jobs:

1. **Schema** — you describe tables in `prisma/schema.prisma` in a simple syntax. Prisma generates the SQL `CREATE TABLE` for you (as "migrations").
2. **Typed client** — you call `prisma.event.findMany({ where: { userId } })` from TypeScript. Autocomplete works, and a typo in a column name fails at compile time.
3. **Migrations** — `prisma migrate dev` turns schema changes into versioned SQL files.

## NextAuth (Auth.js v5)

Authentication library for Next.js. Handles the whole sign-in flow, session cookies, and stores user records in the DB. We configure it with the **Google provider** — user clicks "Sign in with Google," Google returns who they are, NextAuth creates/updates the `User` row and sets a session cookie. We never handle passwords.

## Google OAuth

The protocol behind "Sign in with Google." You register an OAuth client in Google Cloud Console, get a client ID + secret, and drop them in `.env`. NextAuth does the rest.

## rrule (RFC 5545)

A library that implements the iCalendar recurrence-rule standard. Instead of inventing our own schema for "every 2nd Tuesday until December," we store a single string like `FREQ=WEEKLY;BYDAY=TU;INTERVAL=2;UNTIL=20261231T000000Z`. Given a date range, `rrule` expands it into actual occurrence dates. This is the same format Google Calendar / Apple Calendar / Outlook use.

## Luxon

A date/time library that handles timezones correctly. The built-in JS `Date` doesn't understand timezones — it only knows UTC and the user's local browser time. We store events as UTC in the DB, then Luxon converts them to `America/Los_Angeles` for display (so Pacific Time works right across the PST ↔ PDT daylight-savings switch).

## React Hook Form

A library for forms in React. Manages field state, validation, and submission without you writing `useState` for every field. It plays nicely with Zod for validation.

## Zod

A schema / validation library. You write `z.object({ title: z.string().min(1), startUtc: z.coerce.date() })` once, and Zod gives you:

- A TypeScript type (for the form + API response shapes).
- A runtime `parse()` that throws on invalid data.

We reuse the same Zod schema on the client form and the server API route — one source of truth for "what a valid event looks like."

## TanStack Query (React Query)

Data-fetching and caching for React. Instead of juggling `useState` + `useEffect` + loading flags for every API call, you write `useQuery({ queryKey: ['events', range], queryFn: fetchEvents })` and get caching, loading/error states, refetching, and cache invalidation after mutations for free.

## Nodemailer

The email transport. We hand it a `from`, `to`, subject, and HTML/text body and it delivers the message over Gmail's SMTP server, authenticated with a Gmail **App Password** (`GMAIL_USER` / `GMAIL_APP_PASSWORD`). Used by the reminders cron job (`src/scripts/send-reminders.ts`) to send "30 minutes before your event" reminders and the daily 12pm todo digest. Because it sends from a real Gmail account there's no custom sending domain to keep verified — Gmail handles SPF/DKIM. Nodemailer rejects on SMTP errors, so failed sends surface instead of being swallowed (`src/lib/email-result.ts` also guards against a send that reached zero recipients).

## React Email

A small library that lets us write email templates as React components (`src/emails/`) and render them to both HTML and plain-text. We pair it with Nodemailer so the cron job can build a styled email and a text fallback from the same source.

## tsx

Runs TypeScript files directly without a separate compile step. The reminder cron job is a one-shot script (`tsx src/scripts/send-reminders.ts`); using `tsx` keeps it in TypeScript without bolting on `ts-node` or a build pipeline.

---

## How it all fits together

A user clicking on a day to create an event triggers roughly this chain:

1. **React** component opens a **shadcn Dialog**
2. Form fields managed by **React Hook Form**, validated with **Zod**
3. On submit, **TanStack Query** mutation calls `POST /api/events`
4. **Next.js** routes the request to `src/app/api/events/route.ts`
5. **NextAuth** verifies the session and gives us the `userId`
6. The same **Zod** schema re-validates the body on the server
7. **Prisma** inserts the row into **Postgres** (running in **Docker**)
8. **Luxon** + **rrule** handle the timezone and recurrence logic along the way
