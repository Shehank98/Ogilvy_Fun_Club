import { describe, expect, it } from "vitest";
import {
  joinEvent,
  normaliseEmail,
  normaliseName,
  selectTeam,
  type TeamSlot,
} from "../assignment";
import { createMemoryStore, makeDb } from "./memory-store";

const teams = (counts: number[]): TeamSlot[] =>
  counts.map((memberCount, i) => ({
    id: `team-${i + 1}`,
    teamNumber: i + 1,
    memberCount,
  }));

/** The nth seeded guest-list address. */
const player = (n: number) => `player${n}@club.test`;

describe("selectTeam", () => {
  it("assigns to the team the pointer names", () => {
    const result = selectTeam(teams([0, 0, 0, 0]), 2, 5);
    expect(result).toMatchObject({ status: "assigned", nextPointer: 3 });
    expect(result.status === "assigned" && result.team.teamNumber).toBe(3);
  });

  it("wraps the pointer back to the first team", () => {
    const result = selectTeam(teams([1, 1, 1, 1]), 3, 5);
    expect(result).toMatchObject({ status: "assigned", nextPointer: 0 });
    expect(result.status === "assigned" && result.team.teamNumber).toBe(4);
  });

  it("skips full teams and keeps going round", () => {
    // Pointer at team 2; teams 2 and 3 are full, so team 4 gets the person.
    const result = selectTeam(teams([0, 5, 5, 0]), 1, 5);
    expect(result.status === "assigned" && result.team.teamNumber).toBe(4);
    expect(result).toMatchObject({ nextPointer: 0 });
  });

  it("skips full teams across the wrap-around", () => {
    // Pointer at team 3; 3 and 4 are full, so it wraps to team 1.
    const result = selectTeam(teams([0, 0, 5, 5]), 2, 5);
    expect(result.status === "assigned" && result.team.teamNumber).toBe(1);
    expect(result).toMatchObject({ nextPointer: 1 });
  });

  it("reports event_full when every team is at capacity", () => {
    expect(selectTeam(teams([5, 5, 5, 5]), 0, 5)).toEqual({ status: "event_full" });
  });

  it("reports no_teams when nothing is configured", () => {
    expect(selectTeam([], 0, 5)).toEqual({ status: "no_teams" });
  });

  it("treats a non-positive capacity as full rather than assigning", () => {
    expect(selectTeam(teams([0, 0]), 0, 0)).toEqual({ status: "event_full" });
    expect(selectTeam(teams([0, 0]), 0, -3)).toEqual({ status: "event_full" });
  });

  it("normalises out-of-range and negative pointers", () => {
    const stale = selectTeam(teams([0, 0, 0]), 11, 5);
    expect(stale.status === "assigned" && stale.team.teamNumber).toBe(3);

    const negative = selectTeam(teams([0, 0, 0]), -1, 5);
    expect(negative.status === "assigned" && negative.team.teamNumber).toBe(3);

    const nan = selectTeam(teams([0, 0, 0]), Number.NaN, 5);
    expect(nan.status === "assigned" && nan.team.teamNumber).toBe(1);
  });

  it("fills a single team then reports full", () => {
    expect(selectTeam(teams([1]), 0, 2)).toMatchObject({ status: "assigned" });
    expect(selectTeam(teams([2]), 0, 2)).toEqual({ status: "event_full" });
  });
});

describe("normaliseName", () => {
  it("collapses whitespace and trims", () => {
    expect(normaliseName("  Ada   Lovelace \n")).toBe("Ada Lovelace");
  });

  it("caps the length", () => {
    expect(normaliseName("x".repeat(200))).toHaveLength(40);
  });

  it("returns empty for whitespace-only input", () => {
    expect(normaliseName("   \t ")).toBe("");
  });
});

describe("normaliseEmail", () => {
  it("lowercases and trims so the guest list still matches", () => {
    expect(normaliseEmail("  Ada.Lovelace@Club.TEST \n")).toBe("ada.lovelace@club.test");
  });

  it("accepts addresses with plus tags and subdomains", () => {
    expect(normaliseEmail("ada+bowling@mail.club.test")).toBe("ada+bowling@mail.club.test");
  });

  it("rejects obvious non-addresses", () => {
    for (const bad of ["", "   ", "ada", "ada@", "@club.test", "ada@club", "a b@c.test"]) {
      expect(normaliseEmail(bad)).toBe("");
    }
  });

  it("rejects separators that would smuggle in a second address", () => {
    expect(normaliseEmail("a@b.test,c@d.test")).toBe("");
    expect(normaliseEmail("a@b.test;c@d.test")).toBe("");
  });

  it("rejects anything absurdly long", () => {
    expect(normaliseEmail(`${"x".repeat(250)}@club.test`)).toBe("");
  });
});

describe("joinEvent", () => {
  it("deals invited people round-robin in order", async () => {
    const db = makeDb({ numTeams: 3, maxPerTeam: 4 });
    const store = createMemoryStore(db);

    for (const n of [1, 2, 3, 4]) {
      await joinEvent(store, db.event.id, player(n));
    }

    expect(db.members.map((m) => m.teamId)).toEqual([
      "team-1",
      "team-2",
      "team-3",
      "team-1",
    ]);
  });

  it("assigns the name from the guest list, not anything the person types", async () => {
    const db = makeDb({
      numTeams: 2,
      maxPerTeam: 5,
      invitees: [{ email: "ada@club.test", name: "Ada Lovelace" }],
    });
    const store = createMemoryStore(db);

    const result = await joinEvent(store, db.event.id, "ADA@club.test");

    expect(result.status).toBe("assigned");
    expect(db.members[0].name).toBe("Ada Lovelace");
  });

  it("turns away an email that is not on the guest list", async () => {
    const db = makeDb({ numTeams: 2, maxPerTeam: 5 });
    const store = createMemoryStore(db);

    expect(await joinEvent(store, db.event.id, "gatecrasher@club.test")).toEqual({
      status: "not_invited",
    });
    expect(db.members).toHaveLength(0);
  });

  it("rejects a malformed email without touching the draw", async () => {
    const db = makeDb({ numTeams: 2, maxPerTeam: 2 });
    const store = createMemoryStore(db);

    expect(await joinEvent(store, db.event.id, "not-an-email")).toEqual({
      status: "invalid_email",
    });
    expect(db.members).toHaveLength(0);
  });

  it("refuses a second entry from the same email", async () => {
    const db = makeDb({ numTeams: 3, maxPerTeam: 5 });
    const store = createMemoryStore(db);

    const first = await joinEvent(store, db.event.id, player(1));
    expect(first.status).toBe("assigned");

    const second = await joinEvent(store, db.event.id, player(1));
    expect(second).toEqual({
      status: "already_joined",
      memberId: first.status === "assigned" ? first.member.id : "",
    });
    expect(db.members).toHaveLength(1);
  });

  it("recognises the repeat entry whatever the casing", async () => {
    const db = makeDb({
      numTeams: 2,
      maxPerTeam: 5,
      invitees: [{ email: "ada@club.test", name: "Ada" }],
    });
    const store = createMemoryStore(db);

    await joinEvent(store, db.event.id, "ada@club.test");
    const repeat = await joinEvent(store, db.event.id, "  ADA@CLUB.TEST  ");

    expect(repeat.status).toBe("already_joined");
    expect(db.members).toHaveLength(1);
  });

  it("lets someone back in once an organiser releases their claim", async () => {
    const db = makeDb({ numTeams: 2, maxPerTeam: 5 });
    const store = createMemoryStore(db);

    await joinEvent(store, db.event.id, player(1));
    expect(db.members).toHaveLength(1);

    // Organiser removes the member; the guest-list claim goes with it.
    db.members = [];
    db.teams[0].memberCount = 0;
    db.invitees[0].memberId = null;

    const again = await joinEvent(store, db.event.id, player(1));
    expect(again.status).toBe("assigned");
    expect(db.members).toHaveLength(1);
  });

  it("refuses to assign when signups are closed", async () => {
    const db = makeDb({ numTeams: 2, maxPerTeam: 2, isOpen: false });
    const store = createMemoryStore(db);

    expect(await joinEvent(store, db.event.id, player(1))).toEqual({ status: "closed" });
    expect(db.members).toHaveLength(0);
  });

  it("still shows an already-joined person their team after signups close", async () => {
    const db = makeDb({ numTeams: 2, maxPerTeam: 2 });
    const store = createMemoryStore(db);

    await joinEvent(store, db.event.id, player(1));
    db.event.isOpen = false;

    const repeat = await joinEvent(store, db.event.id, player(1));
    expect(repeat.status).toBe("already_joined");
  });

  it("reports not_found for an unknown event", async () => {
    const db = makeDb({ numTeams: 2, maxPerTeam: 2 });
    const store = createMemoryStore(db);

    expect(await joinEvent(store, "nope", player(1))).toEqual({ status: "not_found" });
  });

  it("returns event_full instead of overflowing", async () => {
    const db = makeDb({ numTeams: 2, maxPerTeam: 1 });
    const store = createMemoryStore(db);

    await joinEvent(store, db.event.id, player(1));
    await joinEvent(store, db.event.id, player(2));
    const overflow = await joinEvent(store, db.event.id, player(3));

    expect(overflow).toEqual({ status: "event_full" });
    expect(db.members).toHaveLength(2);
  });

  it("does not burn the guest-list claim when the event is full", async () => {
    const db = makeDb({ numTeams: 1, maxPerTeam: 1 });
    const store = createMemoryStore(db);

    await joinEvent(store, db.event.id, player(1));
    await joinEvent(store, db.event.id, player(2)); // event_full

    // Player 2 never got a team, so their email must still be usable once an
    // organiser makes room.
    expect(db.invitees[1].memberId).toBeNull();
    db.event.maxPerTeam = 2;
    expect((await joinEvent(store, db.event.id, player(2))).status).toBe("assigned");
  });
});

describe("joinEvent under concurrency", () => {
  it("distributes 20 simultaneous submissions evenly across 4 teams of 5", async () => {
    const db = makeDb({ numTeams: 4, maxPerTeam: 5 });
    const store = createMemoryStore(db);

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => joinEvent(store, db.event.id, player(i + 1)))
    );

    expect(results.every((r) => r.status === "assigned")).toBe(true);
    expect(db.members).toHaveLength(20);

    // Every team lands on exactly 5 — no overflow, no starved team.
    for (const team of db.teams) {
      expect(team.memberCount).toBe(5);
    }

    for (const team of db.teams) {
      const actual = db.members.filter((m) => m.teamId === team.id).length;
      expect(actual).toBe(5);
    }
  });

  it("gives one team to one email even when it is submitted 10 times at once", async () => {
    const db = makeDb({ numTeams: 4, maxPerTeam: 5 });
    const store = createMemoryStore(db);

    const results = await Promise.all(
      Array.from({ length: 10 }, () => joinEvent(store, db.event.id, player(1)))
    );

    expect(results.filter((r) => r.status === "assigned")).toHaveLength(1);
    expect(results.filter((r) => r.status === "already_joined")).toHaveLength(9);
    expect(db.members).toHaveLength(1);

    // Every rejection points at the one member that was actually created.
    const memberId = db.members[0].id;
    for (const result of results) {
      if (result.status === "already_joined") expect(result.memberId).toBe(memberId);
    }
  });

  it("never overfills a team when more people submit than there are slots", async () => {
    const db = makeDb({ numTeams: 3, maxPerTeam: 4 });
    const store = createMemoryStore(db);

    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) => joinEvent(store, db.event.id, player(i + 1)))
    );

    const assigned = results.filter((r) => r.status === "assigned");
    const full = results.filter((r) => r.status === "event_full");

    expect(assigned).toHaveLength(12);
    expect(full).toHaveLength(28);
    expect(db.members).toHaveLength(12);
    for (const team of db.teams) {
      expect(team.memberCount).toBe(4);
    }
  });

  it("keeps distribution even when submissions trickle in over time", async () => {
    const db = makeDb({ numTeams: 4, maxPerTeam: 5 });
    const store = createMemoryStore(db);

    for (let i = 0; i < 20; i++) {
      await joinEvent(store, db.event.id, player(i + 1));
      await new Promise((r) => setTimeout(r, 1));
    }

    for (const team of db.teams) {
      expect(team.memberCount).toBe(5);
    }
  });

  it("the concurrency assertions genuinely detect a lost update", async () => {
    // Same 20-across-4x5 scenario against a store with no mutual exclusion.
    // Without the lock, joins read stale counts and the distribution breaks —
    // which is what proves the test above is not passing vacuously.
    const db = makeDb({ numTeams: 4, maxPerTeam: 5 });
    const broken = createMemoryStore(db, { locking: false });

    await Promise.all(
      Array.from({ length: 20 }, (_, i) => joinEvent(broken, db.event.id, player(i + 1)))
    );

    const overfilled = db.teams.some((t) => t.memberCount > 5);
    const uneven = db.teams.some((t) => t.memberCount !== 5);
    expect(overfilled || uneven).toBe(true);
  });

  it("the duplicate-email guard also depends on the lock", async () => {
    // Without mutual exclusion the same email slips through more than once,
    // confirming the one-entry test above is testing the lock, not luck.
    const db = makeDb({ numTeams: 4, maxPerTeam: 5 });
    const broken = createMemoryStore(db, { locking: false });

    await Promise.all(
      Array.from({ length: 10 }, () => joinEvent(broken, db.event.id, player(1)))
    );

    expect(db.members.length).toBeGreaterThan(1);
  });
});
