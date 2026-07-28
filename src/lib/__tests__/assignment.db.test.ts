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

describeDb("joinEvent against Postgres", () => {
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const store = createPrismaAssignmentStore(prisma);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seedEvent(numTeams: number, maxPerTeam: number) {
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
    for (let i = 0; i < 6; i++) {
      await joinEvent(store, event.id, `Player ${i}`);
    }
    expect(await countsByTeamNumber(event.id)).toEqual([2, 2, 1, 1]);
  });

  it("distributes 20 concurrent submissions evenly across 4 teams of 5", async () => {
    const event = await seedEvent(4, 5);

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => joinEvent(store, event.id, `Player ${i + 1}`))
    );

    expect(results.filter((r) => r.status === "assigned")).toHaveLength(20);
    expect(await countsByTeamNumber(event.id)).toEqual([5, 5, 5, 5]);
    expect(await prisma.member.count()).toBe(20);
  });

  it("never lets two concurrent joins share the last open slot", async () => {
    // 3 teams of 4 = 12 slots, 30 people racing for them.
    const event = await seedEvent(3, 4);

    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) => joinEvent(store, event.id, `P${i}`))
    );

    expect(results.filter((r) => r.status === "assigned")).toHaveLength(12);
    expect(results.filter((r) => r.status === "event_full")).toHaveLength(18);
    expect(await countsByTeamNumber(event.id)).toEqual([4, 4, 4]);
  });

  it("rejects concurrent joins once signups are closed", async () => {
    const event = await seedEvent(2, 5);
    await prisma.event.update({ where: { id: event.id }, data: { isOpen: false } });

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => joinEvent(store, event.id, `P${i}`))
    );

    expect(results.every((r) => r.status === "closed")).toBe(true);
    expect(await prisma.member.count()).toBe(0);
  });

  it("resumes the rotation where it left off after a member is removed", async () => {
    const event = await seedEvent(3, 5);
    for (let i = 0; i < 3; i++) await joinEvent(store, event.id, `P${i}`);

    // Admin removes the person on team 1 (a no-show).
    const team1 = await prisma.team.findFirstOrThrow({
      where: { eventId: event.id, teamNumber: 1 },
      include: { members: true },
    });
    await prisma.member.delete({ where: { id: team1.members[0].id } });

    // The pointer is back at team 1, and team 1 now has the free slot.
    await joinEvent(store, event.id, "Replacement");
    expect(await countsByTeamNumber(event.id)).toEqual([1, 1, 1]);
  });
});
