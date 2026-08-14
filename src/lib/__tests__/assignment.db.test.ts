import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { joinEvent } from "../assignment";
import { createPrismaAssignmentStore } from "../prisma-store";
import { colorForTeamIndex } from "../colors";

/**
 * Integration tests for the real Postgres store.
 *
 * These exercise the `SELECT ... FOR UPDATE` lock that makes concurrent joins
 * safe — something the in-memory tests can only approximate. They need a
 * throwaway Postgres database; set `TEST_DATABASE_URL` (or `DATABASE_URL`) and
 * run the migrations against it first. Without one, they skip rather than fail,
 * so `npm test` still works on a machine with no database.
 */
const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const describeDb = url ? describe : describe.skip;

const player = (n: number) => `player${n}@club.test`;

describeDb("joinEvent against Postgres", () => {
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const store = createPrismaAssignmentStore(prisma);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seedEvent(numTeams: number, maxPerTeam: number, inviteeCount = 60) {
    await prisma.event.deleteMany({});
    const event = await prisma.event.create({
      data: {
        title: "Test night",
        numTeams,
        maxPerTeam,
        isOpen: true,
        teams: {
          create: Array.from({ length: numTeams }, (_, i) => ({
            teamNumber: i + 1,
            color: colorForTeamIndex(i),
          })),
        },
        invitees: {
          create: Array.from({ length: inviteeCount }, (_, i) => ({
            email: player(i + 1),
            name: `Player ${i + 1}`,
          })),
        },
      },
    });
    return event;
  }

  async function countsByTeamNumber(eventId: string) {
    const teams = await prisma.team.findMany({
      where: { eventId },
      orderBy: { teamNumber: "asc" },
      select: { teamNumber: true, _count: { select: { members: true } } },
    });
    return teams.map((t) => t._count.members);
  }

  beforeEach(async () => {
    await prisma.event.deleteMany({});
  });

  it("deals sequential joins round-robin", async () => {
    const event = await seedEvent(4, 5);
    for (let i = 1; i <= 6; i++) {
      await joinEvent(store, event.id, player(i));
    }
    expect(await countsByTeamNumber(event.id)).toEqual([2, 2, 1, 1]);
  });

  it("uses the name from the guest list", async () => {
    const event = await seedEvent(2, 5);
    await prisma.invitee.create({
      data: { eventId: event.id, email: "ada@club.test", name: "Ada Lovelace" },
    });

    await joinEvent(store, event.id, "ADA@Club.Test");

    const member = await prisma.member.findFirstOrThrow();
    expect(member.name).toBe("Ada Lovelace");
  });

  it("turns away an address that is not on the guest list", async () => {
    const event = await seedEvent(2, 5);
    expect(await joinEvent(store, event.id, "gatecrasher@club.test")).toEqual({
      status: "not_invited",
    });
    expect(await prisma.member.count()).toBe(0);
  });

  it("distributes 20 concurrent submissions evenly across 4 teams of 5", async () => {
    const event = await seedEvent(4, 5);

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => joinEvent(store, event.id, player(i + 1)))
    );

    expect(results.filter((r) => r.status === "assigned")).toHaveLength(20);
    expect(await countsByTeamNumber(event.id)).toEqual([5, 5, 5, 5]);
    expect(await prisma.member.count()).toBe(20);
  });

  it("gives one team to one email even when submitted 10 times at once", async () => {
    const event = await seedEvent(4, 5);

    const results = await Promise.all(
      Array.from({ length: 10 }, () => joinEvent(store, event.id, player(1)))
    );

    expect(results.filter((r) => r.status === "assigned")).toHaveLength(1);
    expect(results.filter((r) => r.status === "already_joined")).toHaveLength(9);
    expect(await prisma.member.count()).toBe(1);
  });

  it("never lets two concurrent joins share the last open slot", async () => {
    // 3 teams of 4 = 12 slots, 30 invited people racing for them.
    const event = await seedEvent(3, 4);

    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) => joinEvent(store, event.id, player(i + 1)))
    );

    expect(results.filter((r) => r.status === "assigned")).toHaveLength(12);
    expect(results.filter((r) => r.status === "event_full")).toHaveLength(18);
    expect(await countsByTeamNumber(event.id)).toEqual([4, 4, 4]);
  });

  it("rejects concurrent joins once signups are closed", async () => {
    const event = await seedEvent(2, 5);
    await prisma.event.update({ where: { id: event.id }, data: { isOpen: false } });

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => joinEvent(store, event.id, player(i + 1)))
    );

    expect(results.every((r) => r.status === "closed")).toBe(true);
    expect(await prisma.member.count()).toBe(0);
  });

  it("releases the guest-list claim when a member is removed", async () => {
    const event = await seedEvent(3, 5);
    const first = await joinEvent(store, event.id, player(1));
    expect(first.status).toBe("assigned");

    const claimed = await prisma.invitee.findFirstOrThrow({
      where: { eventId: event.id, email: player(1) },
    });
    expect(claimed.memberId).not.toBeNull();

    // Organiser removes them. The FK is ON DELETE SET NULL, so the claim goes
    // with the member and that address becomes usable again.
    await prisma.member.delete({ where: { id: claimed.memberId! } });

    const released = await prisma.invitee.findFirstOrThrow({
      where: { eventId: event.id, email: player(1) },
    });
    expect(released.memberId).toBeNull();

    expect((await joinEvent(store, event.id, player(1))).status).toBe("assigned");
  });

  it("frees every claim when the event is reset", async () => {
    const event = await seedEvent(2, 5);
    for (let i = 1; i <= 4; i++) await joinEvent(store, event.id, player(i));
    expect(await prisma.invitee.count({ where: { memberId: { not: null } } })).toBe(4);

    // What the reset endpoint does: wipe members, keep the guest list.
    await prisma.member.deleteMany({ where: { team: { eventId: event.id } } });

    expect(await prisma.invitee.count({ where: { memberId: { not: null } } })).toBe(0);
    expect(await prisma.invitee.count({ where: { eventId: event.id } })).toBeGreaterThan(0);
    expect((await joinEvent(store, event.id, player(1))).status).toBe("assigned");
  });

  it("resumes the rotation where it left off after a member is removed", async () => {
    const event = await seedEvent(3, 5);
    for (let i = 1; i <= 3; i++) await joinEvent(store, event.id, player(i));

    const team1 = await prisma.team.findFirstOrThrow({
      where: { eventId: event.id, teamNumber: 1 },
      include: { members: true },
    });
    await prisma.member.delete({ where: { id: team1.members[0].id } });

    await joinEvent(store, event.id, player(4));
    expect(await countsByTeamNumber(event.id)).toEqual([1, 1, 1]);
  });

  it("keeps one guest list per event without colliding on email", async () => {
    // The unique index is scoped to the event, so the same address can appear
    // in a future event's list without clashing with this one.
    const event = await seedEvent(2, 5, 1);
    const other = await prisma.event.create({ data: { title: "Next month" } });

    await expect(
      prisma.invitee.create({
        data: { eventId: other.id, email: player(1), name: "Player 1" },
      })
    ).resolves.toBeTruthy();

    await expect(
      prisma.invitee.create({
        data: { eventId: event.id, email: player(1), name: "Duplicate" },
      })
    ).rejects.toThrow();
  });
});
