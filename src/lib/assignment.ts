/**
 * Round-robin team assignment.
 *
 * The logic is split in two layers so the interesting part is testable without a
 * database:
 *
 *  - `selectTeam` is pure: given the teams, their current sizes, and the rotation
 *    pointer, it decides who gets the next person.
 *  - `joinEvent` wraps that decision in a store-provided exclusive section. The
 *    Prisma store implements it with a `SELECT ... FOR UPDATE` row lock on the
 *    event, which is what makes concurrent submissions safe; the test store
 *    implements it with an in-process mutex.
 *
 * Nothing here knows about Prisma, so the same code path is exercised by the
 * concurrency tests and by production.
 */

export type TeamSlot = {
  id: string;
  teamNumber: number;
  memberCount: number;
};

export type SelectionResult =
  | { status: "assigned"; team: TeamSlot; nextPointer: number }
  | { status: "event_full" }
  | { status: "no_teams" };

/**
 * Pick the next team in rotation that still has room.
 *
 * `teams` must be sorted by `teamNumber` ascending. `pointer` is a 0-based index
 * into that array naming the team to *try first*; it is normalised here so a
 * stale or out-of-range pointer can never crash an assignment.
 *
 * Returns the chosen team plus the pointer to persist for the next join, which
 * is one past the team we landed on (so the rotation keeps moving even when
 * teams were skipped for being full).
 */
export function selectTeam(
  teams: TeamSlot[],
  pointer: number,
  maxPerTeam: number
): SelectionResult {
  if (teams.length === 0) return { status: "no_teams" };
  if (maxPerTeam <= 0) return { status: "event_full" };

  const n = teams.length;
  // Normalise: handles negatives, NaN, and pointers left over from a larger
  // team count after the admin shrank the event.
  const start = Number.isFinite(pointer) ? ((Math.trunc(pointer) % n) + n) % n : 0;

  for (let offset = 0; offset < n; offset++) {
    const index = (start + offset) % n;
    const team = teams[index];
    if (team.memberCount < maxPerTeam) {
      return {
        status: "assigned",
        team,
        nextPointer: (index + 1) % n,
      };
    }
  }

  return { status: "event_full" };
}

export type EventSnapshot = {
  id: string;
  isOpen: boolean;
  maxPerTeam: number;
  assignPointer: number;
};

export type AssignedMember = {
  id: string;
  name: string;
  teamId: string;
};

/**
 * A row from the guest list. `memberId` is the claim: once set, this email has
 * been used and cannot be used again until an organiser removes the member.
 */
export type InviteeRecord = {
  id: string;
  name: string;
  memberId: string | null;
};

/**
 * The slice of persistence the assignment needs, scoped to one exclusive
 * section. Implementations must guarantee that two concurrent `runExclusive`
 * calls for the same event never overlap.
 */
export interface AssignmentTx {
  loadEvent(eventId: string): Promise<EventSnapshot | null>;
  /** Teams for the event, sorted by teamNumber, with live member counts. */
  loadTeams(eventId: string): Promise<TeamSlot[]>;
  /** Guest-list lookup by normalised email, or null if not invited. */
  findInvitee(eventId: string, email: string): Promise<InviteeRecord | null>;
  createMember(teamId: string, name: string): Promise<AssignedMember>;
  /** Mark the guest-list row as used by this member. */
  claimInvitee(inviteeId: string, memberId: string): Promise<void>;
  setPointer(eventId: string, pointer: number): Promise<void>;
}

export interface AssignmentStore {
  runExclusive<T>(eventId: string, fn: (tx: AssignmentTx) => Promise<T>): Promise<T>;
}

export type JoinResult =
  | { status: "assigned"; member: AssignedMember; team: TeamSlot }
  | { status: "already_joined"; memberId: string }
  | { status: "not_invited" }
  | { status: "event_full" }
  | { status: "closed" }
  | { status: "no_teams" }
  | { status: "not_found" }
  | { status: "invalid_email" };

export const MAX_NAME_LENGTH = 40;
export const MAX_EMAIL_LENGTH = 254;

export function normaliseName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
}

/**
 * Lowercase and trim so the guest list matches however someone types their
 * address. Returns "" for anything that isn't a plausible email, which the
 * caller treats as invalid input.
 *
 * Deliberately permissive: the guest list is the real gate, so this only needs
 * to reject obvious typos, not adjudicate RFC 5322.
 */
export function normaliseEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH) return "";
  if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/.test(email)) return "";
  return email;
}

/**
 * Assign one invited person to a team.
 *
 * Identity comes from the guest list: the email resolves to the name an
 * organiser entered, so nobody types their own name and nobody can enter under
 * a second one. The claim check and the claim write both happen inside the
 * store's exclusive section, alongside the team selection, so two simultaneous
 * submissions of the same email can never both produce a member, and two
 * different people can never both take the last slot on a team.
 */
export async function joinEvent(
  store: AssignmentStore,
  eventId: string,
  rawEmail: string
): Promise<JoinResult> {
  const email = normaliseEmail(rawEmail);
  if (!email) return { status: "invalid_email" };

  return store.runExclusive(eventId, async (tx) => {
    const event = await tx.loadEvent(eventId);
    if (!event) return { status: "not_found" } as const;

    const invitee = await tx.findInvitee(eventId, email);
    // Checked before `isOpen` so an uninvited address gets the accurate
    // message rather than being told signups are closed.
    if (!invitee) return { status: "not_invited" } as const;

    // One entry per email, enforced here rather than by a browser cookie.
    if (invitee.memberId) {
      return { status: "already_joined", memberId: invitee.memberId } as const;
    }

    if (!event.isOpen) return { status: "closed" } as const;

    const teams = await tx.loadTeams(eventId);
    const selection = selectTeam(teams, event.assignPointer, event.maxPerTeam);

    if (selection.status !== "assigned") return selection;

    const member = await tx.createMember(selection.team.id, invitee.name);
    await tx.claimInvitee(invitee.id, member.id);
    await tx.setPointer(eventId, selection.nextPointer);

    return {
      status: "assigned",
      member,
      team: {
        ...selection.team,
        memberCount: selection.team.memberCount + 1,
      },
    } as const;
  });
}
