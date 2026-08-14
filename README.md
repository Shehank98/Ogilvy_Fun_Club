# Ogilvy Fun Club — Bowling Champs Team Draw

A mobile-first web app for the club bowling night. Invited people enter the
email their invite was sent to, get dealt into a team in round-robin order, and
watch a full-screen animated reveal that ends on a live team page. An organiser
loads the guest list and configures everything behind a shared PIN.

The event title, intro message and all the other copy are admin-editable, so the
branding here is only the starting default.

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
| `/` | Join page: logo, email field, Join button. Redirects to the result page if this browser has already entered |
| *(post-submit)* | Full-screen reveal sequence, then redirect to the result page |
| `/result/[memberId]` | Persistent team page; polls every 4s for new teammates |
| `/teams` | **Organiser-only** overview of all teams with animated fill bars |
| `/admin` | PIN-protected organiser panel |

Participants see only their own team, on `/result/[memberId]`. The full draw on
`/teams` sits behind the same shared PIN as `/admin`, and `/api/teams` is gated
too — gating the page alone would leave the whole draw one fetch away. Reach the
board from the "Teams board" link in the admin panel.

## Running locally

```bash
npm install
cp .env.example .env          # set DATABASE_URL and ADMIN_PIN
npx prisma migrate dev        # create the schema
npm run dev                   # http://localhost:3000
```

The first request creates a default event (4 teams of 5) so nothing errors on a
fresh database. Open `/admin`, enter your `ADMIN_PIN`, and paste a guest list.
Until at least one address is on that list, nobody can join.

## Tests

```bash
npm test
```

The assignment logic is the part worth testing, so it is split into a pure
decision function and a store-shaped persistence layer that both production and
tests drive:

- **`src/lib/__tests__/assignment.test.ts`** — round-robin ordering, skipping
  full teams, wrap-around, the `event full` state, guest-list lookup, and
  concurrency against an in-memory store. Includes the required scenario: 20
  simultaneous submissions across 4 teams of 5 land exactly 5 per team with no
  overflow, plus one address submitted 10 times at once yielding exactly one
  member. Companion tests run both scenarios against a deliberately unlocked
  store and assert they *do* break, which proves the concurrency assertions
  aren't passing vacuously.
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

## Guest list and one entry per person

There are no accounts. Instead an organiser loads a guest list of
`email, name` pairs in the admin panel, and a person joins by entering the email
their invite was sent to. That address resolves to the name on the list, so
nobody types their own name and nobody can enter under a second one.

Each address can be used exactly once. The `Invitee` row carries a `memberId`
claim with a unique index on it, and the claim is both checked and written
inside the same locked transaction as the team selection. Submitting the same
address twice at once therefore produces one member, not two. Enforcement lives
in the database, so clearing cookies, switching browser or using another device
makes no difference.

An organiser has two ways to give someone another go:

| Action | Effect |
|---|---|
| Remove the member (Roster) | Frees their slot and releases their email to be used again. They keep their place on the guest list. |
| Remove them from the guest list | Also deletes their member if they had joined. That address can no longer join at all. |
| Reset event | Clears every member and releases every claim. The guest list is kept, so the same people can be redrawn. |

Releasing on member deletion is done by the schema: `Invitee.memberId` is a
foreign key with `ON DELETE SET NULL`, so the claim cannot outlive the member it
points at.

Joining also drops a cookie so reopening the emailed link lands on that person's
team rather than the form. That is a convenience only, and the result page
carries a "Not you? Use a different email" link so a shared phone is not stuck
on the first person's team.

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

The same gate covers `/teams` and `/api/teams`, so the full draw is organiser-
only. Note this is one shared secret, not per-person accounts — anyone with the
PIN is an organiser.

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
