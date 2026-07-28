import { describe, expect, it } from "vitest";
import {
  joinEvent,
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
    // A pointer left over from a larger team count must not crash or skip.
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

describe("joinEvent", () => {
  it("deals people round-robin in order", async () => {
    const db = makeDb({ numTeams: 3, maxPerTeam: 4 });
    const store = createMemoryStore(db);

    for (const name of ["A", "B", "C", "D"]) {
      await joinEvent(store, db.event.id, name);
    }

    const byTeam = db.members.map((m) => m.teamId);
    expect(byTeam).toEqual(["team-1", "team-2", "team-3", "team-1"]);
  });

  it("rejects an empty name without touching the draw", async () => {
    const db = makeDb({ numTeams: 2, maxPerTeam: 2 });
    const store = createMemoryStore(db);

    expect(await joinEvent(store, db.event.id, "   ")).toEqual({
      status: "invalid_name",
    });
    expect(db.members).toHaveLength(0);
  });

  it("refuses to assign when signups are closed", async () => {
    const db = makeDb({ numTeams: 2, maxPerTeam: 2, isOpen: false });
    const store = createMemoryStore(db);

    expect(await joinEvent(store, db.event.id, "Ada")).toEqual({ status: "closed" });
    expect(db.members).toHaveLength(0);
  });

  it("reports not_found for an unknown event", async () => {
    const db = makeDb({ numTeams: 2, maxPerTeam: 2 });
    const store = createMemoryStore(db);

    expect(await joinEvent(store, "nope", "Ada")).toEqual({ status: "not_found" });
  });

  it("returns event_full instead of overflowing", async () => {
    const db = makeDb({ numTeams: 2, maxPerTeam: 1 });
    const store = createMemoryStore(db);

    await joinEvent(store, db.event.id, "A");
    await joinEvent(store, db.event.id, "B");
    const overflow = await joinEvent(store, db.event.id, "C");

    expect(overflow).toEqual({ status: "event_full" });
    expect(db.members).toHaveLength(2);
  });
});

describe("joinEvent under concurrency", () => {
  it("distributes 20 simultaneous submissions evenly across 4 teams of 5", async () => {
    const db = makeDb({ numTeams: 4, maxPerTeam: 5 });
    const store = createMemoryStore(db);

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => joinEvent(store, db.event.id, `Player ${i + 1}`))
    );

    expect(results.every((r) => r.status === "assigned")).toBe(true);
    expect(db.members).toHaveLength(20);

    // Every team lands on exactly 5 — no overflow, no starved team.
    for (const team of db.teams) {
      expect(team.memberCount).toBe(5);
    }

    // And the stored counts match the members actually written.
    for (const team of db.teams) {
      const actual = db.members.filter((m) => m.teamId === team.id).length;
      expect(actual).toBe(5);
    }
  });

  it("never overfills a team when more people submit than there are slots", async () => {
    const db = makeDb({ numTeams: 3, maxPerTeam: 4 });
    const store = createMemoryStore(db);

    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) => joinEvent(store, db.event.id, `P${i}`))
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
      await joinEvent(store, db.event.id, `Player ${i}`);
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
      Array.from({ length: 20 }, (_, i) => joinEvent(broken, db.event.id, `Player ${i}`))
    );

    const overfilled = db.teams.some((t) => t.memberCount > 5);
    const uneven = db.teams.some((t) => t.memberCount !== 5);
    expect(overfilled || uneven).toBe(true);
  });
});
