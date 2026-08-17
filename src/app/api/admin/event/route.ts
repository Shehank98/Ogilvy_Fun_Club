import { prisma } from "@/lib/prisma";
import { isAdminRequest } from "@/lib/auth";
import {
  getOrCreateEvent,
  loadTeams,
  syncTeams,
  teamsWithMembersAbove,
  toPublicEvent,
} from "@/lib/event";
import { loadInvitees } from "@/lib/invitees";
import { asInt, asString, fail, ok, readJson } from "@/lib/api";
import { TEAM_COLORS } from "@/lib/colors";
import { LOGO_SCALE_MAX, LOGO_SCALE_MIN } from "@/lib/event";

export const dynamic = "force-dynamic";

const MAX_TEAMS = TEAM_COLORS.length * 2;
const MAX_PER_TEAM = 50;

export async function GET() {
  if (!(await isAdminRequest())) return fail("Not authorised.", 401);

  const event = await getOrCreateEvent();
  const teams = await loadTeams(event.id);
  const invitees = await loadInvitees(event.id);
  // assignPointer is admin-only (kept off PublicEvent so the public join page
  // can't reveal which team is next and spoil the draw).
  return ok({
    event: toPublicEvent(event),
    teams,
    invitees,
    assignPointer: event.assignPointer,
  });
}

export async function PUT(request: Request) {
  if (!(await isAdminRequest())) return fail("Not authorised.", 401);

  const body = await readJson(request);
  const event = await getOrCreateEvent();

  const data: Record<string, unknown> = {};

  for (const field of ["title", "introMessage", "date", "time", "venue", "notes"] as const) {
    if (field in body) data[field] = asString(body[field]).slice(0, 2000);
  }

  if ("logoUrl" in body) {
    const url = asString(body.logoUrl).trim();
    data.logoUrl = url === "" ? null : url;
  }

  if ("isOpen" in body) {
    data.isOpen = Boolean(body.isOpen);
  }

  if ("logoScale" in body) {
    const value = asInt(body.logoScale);
    if (value === null || value < LOGO_SCALE_MIN || value > LOGO_SCALE_MAX) {
      return fail(`Logo size must be between ${LOGO_SCALE_MIN} and ${LOGO_SCALE_MAX}.`, 400);
    }
    data.logoScale = value;
  }

  if ("maxPerTeam" in body) {
    const value = asInt(body.maxPerTeam);
    if (value === null || value < 1 || value > MAX_PER_TEAM) {
      return fail(`Max per team must be between 1 and ${MAX_PER_TEAM}.`, 400);
    }
    data.maxPerTeam = value;
  }

  let numTeams: number | null = null;
  if ("numTeams" in body) {
    const value = asInt(body.numTeams);
    if (value === null || value < 1 || value > MAX_TEAMS) {
      return fail(`Number of teams must be between 1 and ${MAX_TEAMS}.`, 400);
    }
    numTeams = value;
    data.numTeams = value;
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (numTeams !== null && numTeams < event.numTeams) {
      // Dropping a team deletes its members. Refuse rather than silently
      // discarding people who already joined.
      const losing = await teamsWithMembersAbove(tx, event.id, numTeams);
      if (losing.length > 0) {
        throw new ShrinkBlocked(losing);
      }
    }

    // Keep the rotation pointer inside the new team range.
    if (numTeams !== null) {
      data.assignPointer = numTeams > 0 ? event.assignPointer % numTeams : 0;
    }

    const result = await tx.event.update({ where: { id: event.id }, data });
    if (numTeams !== null) {
      await syncTeams(tx, event.id, numTeams);
    }
    return result;
  }).catch((error) => {
    if (error instanceof ShrinkBlocked) return error;
    throw error;
  });

  if (updated instanceof ShrinkBlocked) {
    return fail(
      `Team ${updated.teams.join(", ")} still has members. Remove them (or reset the event) before reducing the team count.`,
      409,
      { reason: "teams_have_members", teams: updated.teams }
    );
  }

  const teams = await loadTeams(event.id);
  return ok({
    event: toPublicEvent(updated),
    teams,
    assignPointer: updated.assignPointer,
  });
}

class ShrinkBlocked extends Error {
  constructor(readonly teams: number[]) {
    super("teams_have_members");
  }
}
