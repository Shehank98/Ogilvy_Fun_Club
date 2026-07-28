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

export type MemoryDb = {
  event: EventSnapshot;
  teams: MemoryTeam[];
  members: MemoryMember[];
};

export function makeDb(options: {
  eventId?: string;
  numTeams: number;
  maxPerTeam: number;
  isOpen?: boolean;
  assignPointer?: number;
}): MemoryDb {
  const eventId = options.eventId ?? "event-1";
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
    async createMember(teamId, name) {
      await tick();
      const member = { id: `member-${nextMemberId++}`, name, teamId };
      db.members.push(member);
      const team = db.teams.find((t) => t.id === teamId);
      if (team) team.memberCount += 1;
      return member;
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
