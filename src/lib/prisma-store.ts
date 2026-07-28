import { Prisma, PrismaClient } from "@prisma/client";
import type { AssignmentStore, AssignmentTx } from "./assignment";

type PrismaTx = Prisma.TransactionClient;

function txAdapter(tx: PrismaTx): AssignmentTx {
  return {
    async loadEvent(eventId) {
      const event = await tx.event.findUnique({
        where: { id: eventId },
        select: { id: true, isOpen: true, maxPerTeam: true, assignPointer: true },
      });
      return event ?? null;
    },

    async loadTeams(eventId) {
      const teams = await tx.team.findMany({
        where: { eventId },
        orderBy: { teamNumber: "asc" },
        select: {
          id: true,
          teamNumber: true,
          _count: { select: { members: true } },
        },
      });
      return teams.map((t) => ({
        id: t.id,
        teamNumber: t.teamNumber,
        memberCount: t._count.members,
      }));
    },

    async createMember(teamId, name) {
      const member = await tx.member.create({
        data: { teamId, name },
        select: { id: true, name: true, teamId: true },
      });
      return member;
    },

    async setPointer(eventId, pointer) {
      await tx.event.update({
        where: { id: eventId },
        data: { assignPointer: pointer },
      });
    },
  };
}

/**
 * Postgres-backed assignment store.
 *
 * `runExclusive` takes a row-level write lock on the event before reading team
 * sizes, so concurrent joins for the same event queue up behind each other and
 * every one of them sees the counts left by the previous. Joins for *different*
 * events don't contend, since the lock is on that event's row only.
 */
export function createPrismaAssignmentStore(prisma: PrismaClient): AssignmentStore {
  return {
    async runExclusive(eventId, fn) {
      return prisma.$transaction(
        async (tx) => {
          // Serialises concurrent joins for this event. Held until the
          // transaction commits.
          await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${eventId} FOR UPDATE`;
          return fn(txAdapter(tx));
        },
        {
          // Under a burst of signups, later joins wait on the lock — give them
          // more room than Prisma's 5s default before failing.
          maxWait: 15_000,
          timeout: 20_000,
        }
      );
    },
  };
}
