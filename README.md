# Ogilvy Fun Club — Pool Night Team Draw

A mobile-first web app for a club event. People type their name, get dealt into
a team in round-robin order, and watch a full-screen animated reveal that ends
on a live team page. An organiser configures everything behind a shared PIN.

## Stack

| | |
|---|---|
| Framework | Next.js 15 (App Router) + TypeScript |
| Styling | Tailwind CSS |
| Database | PostgreSQL via Prisma |
| Animation | `framer-motion`, `canvas-confetti` (lazy-loaded) |
| Tests | Vitest |
| Deploy target | Railway |

## Pages

| Route | What it is |
|---|---|
| `/` | Join page — logo, name field, Join button |
| *(post-submit)* | Full-screen reveal sequence, then redirect to the result page |
| `/result/[memberId]` | Persistent team page; polls every 4s for new teammates |
| `/teams` | Public overview of all teams with animated fill bars |
| `/admin` | PIN-protected organiser panel |

## Running locally

```bash
npm install
cp .env.example .env          # set DATABASE_URL and ADMIN_PIN
npx prisma migrate dev        # create the schema
npm run dev                   # http://localhost:3000
```

The first request creates a default event (4 teams of 5) so nothing errors on a
fresh database. Open `/admin` and enter your `ADMIN_PIN` to configure it.

## Tests

```bash
npm test
```

The assignment logic is the part worth testing, so it is split into a pure
decision function and a store-shaped persistence layer that both production and
tests drive:

- **`src/lib/__tests__/assignment.test.ts`** — round-robin ordering, skipping
  full teams, wrap-around, the `event full` state, and concurrency against an
  in-memory store. Includes the required scenario: 20 simultaneous submissions
  across 4 teams of 5 land exactly 5 per team with no overflow. A companion test
  runs the same scenario against a deliberately unlocked store and asserts the
  distribution *does* break, which proves the concurrency assertions aren't
  passing vacuously.
- **`src/lib/__tests__/assignment.db.test.ts`** — the same guarantees against
  real Postgres, exercising the `SELECT … FOR UPDATE` row lock. These skip
  automatically unless `TEST_DATABASE_URL` (or `DATABASE_URL`) is set:

  ```bash
  createdb ofc_test
  export TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ofc_test"
  npx prisma migrate deploy
  npm test
  ```

  These tests delete all event rows — point them at a throwaway database, never
  production.
- **`src/lib/__tests__/reveal-steps.test.ts`** — the reveal sequence is built
  from the Event record, so these cover step order and the skipping of blank
  fields (notes, and any other detail the admin leaves empty).

## How the assignment works

A rotating pointer (`Event.assignPointer`) names the team to try first. On each
join the app takes a row-level write lock on the event, reads the live member
counts, walks forward from the pointer to the first team with room, writes the
member, and advances the pointer past the team it landed on — so full teams are
skipped without stalling the rotation. If no team has room, nothing is written
and the join returns an `event full` state.

Because the whole read-decide-write happens inside one transaction holding the
event's row lock, concurrent submissions queue behind each other and each sees
the previous one's result. Two people submitting at the same instant can never
both take the last slot on a team. Joins for different events don't contend, as
the lock is scoped to the event row.

The draw is plain round-robin in submission order — there is no weighting or
hidden seeding, so the distribution is inspectable by anyone on `/teams`.

## Deploying to Railway

1. Create a Railway project and add the **Postgres** plugin.
2. Add this repo as a service.
3. Set the service variables:
   - `DATABASE_URL` → `${{Postgres.DATABASE_URL}}`
   - `ADMIN_PIN` → a long shared secret
   - optionally `CLOUDINARY_CLOUD_NAME` + `CLOUDINARY_UPLOAD_PRESET`
4. Deploy. `railway.json` runs `scripts/start.sh`, which applies migrations
   before serving, so schema changes land on every release.

`DATABASE_URL` is not optional — without it `scripts/start.sh` exits
immediately with an explanation rather than starting a server that cannot
work. If a deploy fails its health check, the deploy log will name the cause.

The health check points at `/api/health`, which returns 200 whenever the
process is serving and reports database reachability in the body instead of the
status code. This is deliberate: a check that fails on a slow or briefly
unavailable database gets the container killed and restarted when the container
itself was fine.

### Logo storage

Railway's container filesystem is wiped on redeploy, so a logo written to disk
disappears unless it is on a volume. Two supported options:

- **Cloudinary (recommended).** Set `CLOUDINARY_CLOUD_NAME` and
  `CLOUDINARY_UPLOAD_PRESET` (an *unsigned* preset). Uploads go straight there
  and only the returned URL is stored.
- **Railway volume.** Mount a volume and set `UPLOAD_DIR` to its mount path
  (e.g. `/data/uploads`). Files are served back through `/api/uploads/[file]`.

The admin panel also accepts a pasted image URL if the logo is already hosted
somewhere.

## Admin access

`/admin` is gated on the single `ADMIN_PIN` env var — no accounts, no user
table. A correct PIN sets an httpOnly cookie holding an HMAC derived from the
PIN, so sessions are verifiable without being stored and the PIN itself is never
in the cookie. Changing `ADMIN_PIN` invalidates every existing session.

From the panel an organiser can set the team count and size, edit every field
that feeds the reveal, upload a logo, open or close signups, remove individual
members, and reset the event. Reducing the team count is refused while the
teams being dropped still have members, rather than silently deleting people.

## Accessibility & performance notes

- `prefers-reduced-motion` is honoured throughout: framer-motion transitions
  collapse to zero duration, the roster stagger is dropped, confetti is
  suppressed, and the CSS backdrop animation is frozen.
- Animations use only `transform` and `opacity` so they stay on the compositor.
- `canvas-confetti` is dynamically imported on the reveal step, keeping it out
  of the initial bundle.
- Sound is off by default and synthesised with WebAudio — no audio assets to
  download — with a mute toggle on the join page.
