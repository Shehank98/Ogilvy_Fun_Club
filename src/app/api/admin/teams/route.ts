import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isAdminRequest } from "@/lib/auth";
import { getOrCreateEvent, loadTeams } from "@/lib/event";
import { asString, fail, ok, readJson } from "@/lib/api";

export const dynamic = "force-dynamic";

const MAX_NAME_LENGTH = 60;
const MAX_URL_LENGTH = 2000;

/**
 * Set the display name and/or logo of teams.
 *
 * A team with a name shows it in the draw and on every board; a team left blank
 * falls back to "Team N" (see `teamLabel`), so clearing a name is how an
 * organiser returns to the default numbering. A team's logo (a direct image
 * URL) shows next to its name wherever the team is revealed; clearing it drops
 * back to no logo.
 *
 * Body: `{ names?: { [teamId]: string }, logos?: { [teamId]: string } }`. Only
 * teams belonging to the current event are touched; unknown ids are ignored.
 */
export async function PUT(request: Request) {
  if (!(await isAdminRequest())) return fail("Not authorised.", 401);

  const body = await readJson(request);
  const names = isRecord(body.names) ? body.names : null;
  const logos = isRecord(body.logos) ? body.logos : null;
  if (!names && !logos) {
    return fail("Expected a names or logos object.", 400);
  }

  const event = await getOrCreateEvent();
  const teams = await prisma.team.findMany({
    where: { eventId: event.id },
    select: { id: true },
  });
  const owned = new Set(teams.map((t) => t.id));

  // Merge name and logo edits per team so each team is a single update.
  const patches = new Map<string, Prisma.TeamUpdateInput>();
  const patchFor = (id: string) => {
    let p = patches.get(id);
    if (!p) {
      p = {};
      patches.set(id, p);
    }
    return p;
  };

  if (names) {
    for (const [id, raw] of Object.entries(names)) {
      if (!owned.has(id)) continue;
      const trimmed = asString(raw).trim().slice(0, MAX_NAME_LENGTH);
      patchFor(id).name = trimmed === "" ? null : trimmed;
    }
  }

  if (logos) {
    for (const [id, raw] of Object.entries(logos)) {
      if (!owned.has(id)) continue;
      const trimmed = asString(raw).trim().slice(0, MAX_URL_LENGTH);
      patchFor(id).logoUrl = trimmed === "" ? null : trimmed;
    }
  }

  if (patches.size > 0) {
    await prisma.$transaction(
      [...patches].map(([id, data]) =>
        prisma.team.update({ where: { id }, data })
      )
    );
  }

  return ok({ teams: await loadTeams(event.id) });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
