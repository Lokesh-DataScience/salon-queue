# Salon Virtual Queue

A privacy-first virtual queue for salons and barber shops. A customer scans the salon's QR code, instantly gets a queue token, and can step away from the shop while the queue moves. The barber runs everything from a one-thumb, two-tab mobile dashboard.

**Live app:** https://salonqueue.onrender.com
(hosted on a free plan, so the first request after a quiet period can take a few seconds)

> **Product principle:** the barber should never have to think about the queue.
> Every feature is judged by one question: *does this save the barber time, taps, or attention during a busy shift?*

---

## How it works

**Customer (no account, no typing)**

1. Scan the salon's QR code, which is printed once and stuck on the shop wall.
2. Get a queue token immediately. No name, no phone number, no signup.
3. Keep the ticket page open or allow notifications, then walk around or wait elsewhere.
4. Get a push notification when your turn is close and when it is your turn.

**Barber / salon owner**

1. Register or log in at `/barber/login`.
2. **Dashboard tab:** see who is being served, who is next and how many are waiting. One big Start then Complete button handles each customer. A **+1** button adds walk-ins who have no smartphone.
3. **Settings tab:** salon profile (name, address, phone, hours, average service time), services, QR code, offers, password and log out.

---

## Features

- **QR-first customer flow:** each salon gets a unique QR code that opens the ticket page directly.
- **Anonymous tickets:** customers are never asked for a name or phone number. A random, opaque access token (sent in a request header, never in the URL) protects each ticket.
- **One-button barber dashboard:** a single state-changing Start / Complete action, pinned above a fixed bottom navigation bar.
- **Walk-in +1:** add a customer without a phone to the queue in one tap.
- **Live updates:** Socket.IO rooms per salon push queue changes to the barber and customer screens with no refreshing.
- **Web Push notifications:** a free, phone-number-independent provider behind a swappable `NotificationService` abstraction. Each customer gets "getting close", "you're next" and "your turn".
- **Lucky-draw offers:** barbers add their own offers (for example, a free head massage a few times a day) and customers who scan may win one at random. The barber claims it with a tap.
- **Barber self-registration:** salons sign themselves up; no admin work needed.
- **Salon settings:** profile, opening hours (India time) and average service time feed directly into wait estimates.
- **Installable app:** works as a mobile app wrapper around the website.

---

## Privacy by design

- No customer accounts, passwords or profiles. Ever.
- No customer name or phone is collected at join. Legacy contact columns are nullable and are wiped by a scheduled cleanup job after the retention window.
- No personal data in logs, URLs or Socket.IO room names.
- Customers can only access their own ticket; ownership violations on the barber side return `404` so entry IDs are not leaked.
- The database is the source of truth. The frontend never talks to the database directly.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React, Vite, TypeScript, Tailwind CSS v4, React Router, TanStack Query, Socket.IO client |
| Backend | Node.js, Express, TypeScript, Socket.IO, Zod, JWT, bcrypt, `express-rate-limit`, Helmet |
| Database | PostgreSQL on Supabase, accessed through `@supabase/supabase-js` |
| Notifications | Web Push (VAPID) via a pluggable provider |
| Testing | Vitest, Supertest, React Testing Library |
| Hosting | Render (single web service serving the API and the built frontend) |

### Concurrency

`supabase-js` has no client-side transactions, so all concurrency-sensitive operations are Postgres functions called with `supabase.rpc(...)`:

- `join_queue`: atomic, row-locked token generation (no duplicate tokens)
- `barber_next` / `advance_queue`: one state transition per press, even on a rapid double tap
- `nearby_salons`: Haversine distance query
- `cleanup_customer_data`: retention cleanup

Complete / skip use optimistic concurrency (compare-and-swap on status).

### Queue state machine

```
WAITING → CALLED → SERVING → COMPLETED
   ├──→ SKIPPED
   └──→ CANCELLED
```

---

## Project structure

```
salon-queue/
├── frontend/     React + Vite app
├── backend/      Express API, Socket.IO, jobs, tests
│   └── supabase/ SQL schema and functions
├── shared/       Shared types
└── README.md
```

Frontend and backend run independently in development. In production a single Express service can also serve the built frontend (`SERVE_FRONTEND=true`), which keeps everything same-origin so `SameSite` cookies work.

---

## Getting started

### Prerequisites

- Node.js 22 or newer
- A Supabase project (use a separate one for tests)

### 1. Clone and install

```bash
git clone https://github.com/Lokesh-DataScience/salon-queue.git
cd salon-queue

cd backend && npm install
cd ../frontend && npm install
```

### 2. Set up the database

Run the SQL in `backend/supabase/` (schema, then functions) in the Supabase SQL editor. Optionally seed demo data:

```bash
cd backend
npm run db:seed
```

### 3. Configure environment variables

Create `backend/.env`:

```bash
PORT=4000
FRONTEND_URL=http://localhost:5173

SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

JWT_SECRET=
JWT_REFRESH_SECRET=
ACCESS_TOKEN_TTL_SECONDS=

# Web Push (generate with: npx web-push generate-vapid-keys)
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:you@example.com

# Production only
TRUST_PROXY=
SERVE_FRONTEND=
```

Never commit `.env` files, and never expose backend secrets through `VITE_*` variables. The service-role key stays on the server only.

### 4. Run in development

```bash
# terminal 1
cd backend && npm run dev

# terminal 2
cd frontend && npm run dev
```

Open http://localhost:5173.

### 5. Create a salon

Salons can register themselves at `/barber/register`. There is also a `create-salon` CLI script in the backend for creating salons manually.

---

## Testing

```bash
cd backend && npm test      # Vitest + Supertest, run against a SEPARATE test Supabase project
cd frontend && npm test     # Vitest + React Testing Library
```

The backend suite covers authentication, ownership, concurrent joins, the barber state machine, notifications, retention cleanup and public-data exposure. A safety guard in the test setup refuses to run against the production database.

---

## Deployment

The app is deployed as a single Render web service:

1. Build the frontend and backend (`npm ci --include=dev`, then the build scripts).
2. Set the environment variables above, with `SERVE_FRONTEND=true` and `TRUST_PROXY` set for the platform.
3. Point the service at your production Supabase project.
4. Use an external pinger on `/api/health` if you are on a free plan that sleeps.

---

## Security

- bcrypt password hashing, JWT access and refresh tokens in HTTP-only cookies, with refresh-token rotation and revocation
- Rate limiting on join, login, registration, nearby and ticket endpoints
- Zod validation on every request body
- Helmet, strict CORS and a Content-Security-Policy
- Every protected route re-verifies auth and salon ownership server-side; `salonId` is always read from the verified session, never from the client

---

## Roadmap

- Services with per-service durations and automatic queue advancement
- Custom domain and a Mumbai-region database
- Wider rollout to salons in small-town markets

---

## Contributing

Issues and pull requests are welcome. Please keep changes small and focused, and run both test suites before opening a PR.

## Author

Built by **Lokesh Kumar**. Portfolio: https://lokesh-datascience.github.io/portfolio/
