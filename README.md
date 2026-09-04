# Salon Virtual Queue

Privacy-first local salon queue platform. Customers discover nearby salons,
see live queue status, join remotely, and get notified as their turn
approaches — no account required. Barbers/salon staff authenticate to run
the queue from a dashboard.

Full product/technical spec: `Salon_Virtual_Queue.txt`.
Build order and working discipline: `INSTRUCTIONS.md`.

## Stack

- **Frontend:** React + Vite + TypeScript + Tailwind CSS + React Router +
  TanStack Query + Socket.IO client
- **Backend:** Node.js + Express + TypeScript + `@supabase/supabase-js` +
  hosted Supabase (PostgreSQL) + Socket.IO + Zod + JWT + bcrypt

## Project structure

```
salon-queue/
├── frontend/     React app (customer + barber UI)
├── backend/      Express API + Socket.IO server
│   └── supabase/ schema.sql (run in Supabase SQL Editor) + seed.ts
└── shared/       Types/constants shared between frontend and backend
```

## A note on database access

The backend talks to Postgres through `@supabase/supabase-js` (PostgREST),
using a hosted Supabase project and the **service role key** — never the
anon key, and never from the frontend. Per spec §6/§20, the frontend must
never access the database directly; only backend API routes do.

**Important:** `supabase-js` does not support client-side multi-statement
transactions the way an ORM like Prisma does. The spec's atomicity
requirements — token generation (§23) and the barber's NEXT logic (§27–28)
— will be implemented as **Postgres functions (RPC)**, called via
`supabase.rpc(...)`, starting in Milestone 2/3. This keeps the database as
the actual source of truth for concurrency-sensitive operations.

There is no `docker-compose.yml` / local Postgres anymore — the database is
hosted on Supabase.

## Local setup

### 1. Create the schema

In your Supabase project dashboard → SQL Editor → New query, paste and run
`backend/supabase/schema.sql`. It's idempotent (safe to re-run). This
creates `salons`, `salon_staff`, `queues`, `queue_entries`, their enums,
indexes, `updated_at` triggers, and enables Row Level Security with no
policies (only the service role key — i.e. only the backend — can read or
write anything).

### 2. Backend

```bash
cd backend
cp .env.example .env
```

Fill in `.env`:
- `SUPABASE_URL` — Project Settings → API → Project URL
- `SUPABASE_SERVICE_ROLE_KEY` — Project Settings → API → service_role key
  (keep this secret; never commit it or send it to the frontend)

```bash
npm install
npm run db:seed    # loads 5 demo salons
npm run dev          # starts on http://localhost:4000
```

Check `GET http://localhost:4000/api/health` — should return
`{ "status": "ok", "db": "connected", ... }`.

### 3. Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev                # starts on http://localhost:5173
```

Visit `http://localhost:5173/health` to confirm the frontend can reach the
backend end-to-end.

## A note on the TypeScript runner

The backend runs via `node --require tsx/cjs`, not the `tsx` CLI directly
and not `ts-node`. Both of those have known Windows/Node-24 resolution bugs
(`ts-node` fails before even reading the file; the bare `tsx` CLI resolves
through Node's ESM loader even though this project is CommonJS). Using
`node -r tsx/cjs <file>` sidesteps both — this is what `npm run dev` and
`npm run db:seed` use.

## Current status

**Milestone 1 — Skeleton.** Monorepo, Supabase schema (`salons`,
`salon_staff`, `queues`, `queue_entries`), Express app with
Helmet/CORS/Zod/error handling, and a health check backed by
`@supabase/supabase-js` are in place. No salon discovery, queue joining,
auth, or real-time features yet — those land in Milestones 2–4 per
`INSTRUCTIONS.md`.