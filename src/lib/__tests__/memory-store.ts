import type { AssignmentStore, AssignmentTx, EventSnapshot } from "../assignment";

/**
 * In-memory stand-in for the Postgres store, used by the concurrency tests.
 *
 * Every read/write yields to the event loop first, so concurrent `joinEvent`
 * calls genuinely interleave. `locking: false` builds a deliberately broken
 * store with no mutual exclusion — the tests use it to prove the concurrency
 * assertions actually detect a lost update rather than passing vacuously.
 */

type MemoryTeam = { id: string; teamNumber: number; memberCount: number };
type MemoryMember = { id: string; name: string; teamId: string };
type MemoryInvitee = { id: string; email: string; name: string; memberId: string | null };

export type MemoryDb = {
  event: EventSnapshot;
  teams: MemoryTeam[];
  members: MemoryMember[];
  invitees: MemoryInvitee[];
};

export function makeDb(options: {
  eventId?: string;
  numTeams: number;
  maxPerTeam: number;
  isOpen?: boolean;
  assignPointer?: number;
  /** Guest list. Defaults to `player1@club.test` … `playerN@club.test`. */
  invitees?: { email: string; name: string }[];
  inviteeCount?: number;
}): MemoryDb {
  const eventId = options.eventId ?? "event-1";

  const list =
    options.invitees ??
    Array.from({ length: options.inviteeCount ?? 50 }, (_, i) => ({
      email: `player${i + 1}@club.test`,
      name: `Player ${i + 1}`,
    }));

  return {
    event: {
      id: eventId,
      isOpen: options.isOpen ?? true,
      maxPerTeam: options.maxPerTeam,
      assignPointer: options.assignPointer ?? 0,
    },
    teams: Array.from({ length: options.numTeams }, (_, i) => ({
      id: `team-${i + 1}`,
      teamNumber: i + 1,
      memberCount: 0,
    })),
    members: [],
    invitees: list.map((entry, i) => ({
      id: `invitee-${i + 1}`,
      email: entry.email.toLowerCase(),
      name: entry.name,
      memberId: null,
    })),
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, Math.random() * 3));

export function createMemoryStore(
  db: MemoryDb,
  { locking = true }: { locking?: boolean } = {}
): AssignmentStore {
  let chain: Promise<unknown> = Promise.resolve();
  let nextMemberId = 1;

  const tx: AssignmentTx = {
    async loadEvent(eventId) {
      await tick();
      return db.event.id === eventId ? { ...db.event } : null;
    },
    async loadTeams() {
      await tick();
      return db.teams.map((t) => ({ ...t }));
    },
    async findInvitee(eventId, email) {
      await tick();
      if (db.event.id !== eventId) return null;
      const found = db.invitees.find((i) => i.email === email);
      return found ? { id: found.id, name: found.name, memberId: found.memberId } : null;
    },
    async createMember(teamId, name) {
      await tick();
      const member = { id: `member-${nextMemberId++}`, name, teamId };
      db.members.push(member);
      const team = db.teams.find((t) => t.id === teamId);
      if (team) team.memberCount += 1;
      return member;
    },
    async claimInvitee(inviteeId, memberId) {
      await tick();
      const invitee = db.invitees.find((i) => i.id === inviteeId);
      if (invitee) invitee.memberId = memberId;
    },
    async setPointer(_eventId, pointer) {
      await tick();
      db.event.assignPointer = pointer;
    },
  };

  return {
    async runExclusive(_eventId, fn) {
      if (!locking) return fn(tx);
      // Serialise: each caller waits for the previous section to finish, which
      // is what the Postgres `FOR UPDATE` row lock buys us in production.
      const run = chain.then(() => fn(tx));
      chain = run.catch(() => undefined);
      return run;
    },
  };
}
