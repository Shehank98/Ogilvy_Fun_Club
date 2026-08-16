import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./prisma";
import { colorForTeamIndex } from "./colors";

/**
 * The app hosts one event at a time. `getOrCreateEvent` returns the oldest
 * event row, creating a default one (with its teams) on first run so a fresh
 * deploy has something to render instead of erroring.
 */
export async function getOrCreateEvent() {
  const existing = await prisma.event.findFirst({ orderBy: { createdAt: "asc" } });
  if (existing) return existing;

  return prisma.$transaction(async (tx) => {
    // Another request may have created it between our read and this write.
    const raced = await tx.event.findFirst({ orderBy: { createdAt: "asc" } });
    if (raced) return raced;

    const event = await tx.event.create({ data: {} });
    await syncTeams(tx, event.id, event.numTeams);
    return event;
  });
}

/**
 * Make the team rows match `numTeams`: create any that are missing, delete any
 * beyond the new count. Teams are numbered 1..numTeams and keep a stable colour
 * derived from their number.
 *
 * Deleting a team cascades to its members, so callers must check
 * `teamsWithMembersAbove` first and refuse to shrink a live draw.
 */
export async function syncTeams(
  tx: Prisma.TransactionClient | PrismaClient,
  eventId: string,
  numTeams: number
) {
  const existing = await tx.team.findMany({
    where: { eventId },
    orderBy: { teamNumber: "asc" },
    select: { id: true, teamNumber: true },
  });

  const wanted = new Set<number>();
  for (let n = 1; n <= numTeams; n++) wanted.add(n);

  const doomed = existing.filter((t) => !wanted.has(t.teamNumber)).map((t) => t.id);
  if (doomed.length > 0) {
    await tx.team.deleteMany({ where: { id: { in: doomed } } });
  }

  const present = new Set(existing.map((t) => t.teamNumber));
  const missing = [...wanted].filter((n) => !present.has(n));
  if (missing.length > 0) {
    await tx.team.createMany({
      data: missing.map((teamNumber) => ({
        eventId,
        teamNumber,
        color: colorForTeamIndex(teamNumber - 1),
      })),
    });
  }
}

/** Team numbers above `numTeams` that still hold members — i.e. would lose people. */
export async function teamsWithMembersAbove(
  tx: Prisma.TransactionClient | PrismaClient,
  eventId: string,
  numTeams: number
): Promise<number[]> {
  const teams = await tx.team.findMany({
    where: { eventId, teamNumber: { gt: numTeams } },
    select: { teamNumber: true, _count: { select: { members: true } } },
  });
  return teams.filter((t) => t._count.members > 0).map((t) => t.teamNumber);
}

export type PublicTeam = {
  id: string;
  teamNumber: number;
  name: string | null;
  color: string;
  logoUrl: string | null;
  members: { id: string; name: string; email: string | null; joinedAt: string }[];
};

/**
 * Teams with their rosters.
 *
 * Includes each member's guest-list email, so every caller must be
 * organiser-only. That holds today: the join page uses this for counts and
 * colours without passing members to the client, and `/api/teams`,
 * `/api/admin/*` are all behind the admin gate. What a participant sees comes
 * from `/api/member/[memberId]`, which returns names only.
 */
export async function loadTeams(eventId: string): Promise<PublicTeam[]> {
  const teams = await prisma.team.findMany({
    where: { eventId },
    orderBy: { teamNumber: "asc" },
    include: {
      members: {
        orderBy: { joinedAt: "asc" },
        include: { invitee: { select: { email: true } } },
      },
    },
  });

  return teams.map((team) => ({
    id: team.id,
    teamNumber: team.teamNumber,
    name: team.name,
    color: team.color,
    logoUrl: team.logoUrl,
    members: team.members.map((m) => ({
      id: m.id,
      name: m.name,
      email: m.invitee?.email ?? null,
      joinedAt: m.joinedAt.toISOString(),
    })),
  }));
}

export type PublicEvent = {
  id: string;
  title: string;
  introMessage: string;
  date: string;
  time: string;
  venue: string;
  notes: string;
  logoUrl: string | null;
  numTeams: number;
  maxPerTeam: number;
  isOpen: boolean;
};

export function toPublicEvent(event: {
  id: string;
  title: string;
  introMessage: string;
  date: string;
  time: string;
  venue: string;
  notes: string;
  logoUrl: string | null;
  numTeams: number;
  maxPerTeam: number;
  isOpen: boolean;
}): PublicEvent {
  return {
    id: event.id,
    title: event.title,
    introMessage: event.introMessage,
    date: event.date,
    time: event.time,
    venue: event.venue,
    notes: event.notes,
    logoUrl: event.logoUrl,
    numTeams: event.numTeams,
    maxPerTeam: event.maxPerTeam,
    isOpen: event.isOpen,
  };
}

export function teamLabel(team: { teamNumber: number; name: string | null }): string {
  return team.name?.trim() ? team.name.trim() : `Team ${team.teamNumber}`;
}
