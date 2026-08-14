import { prisma } from "@/lib/prisma";
import { isAdminRequest } from "@/lib/auth";
import { getOrCreateEvent, loadTeams } from "@/lib/event";
import { asString, fail, ok, readJson } from "@/lib/api";

export const dynamic = "force-dynamic";

const MAX_NAME_LENGTH = 60;

/**
 * Set the display names of teams. A team with a name shows it in the draw and
 * on every board; a team left blank falls back to "Team N" (see `teamLabel`),
 * so clearing a name is how an organiser returns to the default numbering.
 *
 * Body: `{ names: { [teamId]: string } }`. Only teams belonging to the current
 * event are touched; unknown ids are ignored.
 */
export async function PUT(request: Request) {
  if (!(await isAdminRequest())) return fail("Not authorised.", 401);

  const body = await readJson(request);
  const names = body.names;
  if (!names || typeof names !== "object") {
    return fail("Expected a names object.", 400);
  }

  const event = await getOrCreateEvent();
  const teams = await prisma.team.findMany({
    where: { eventId: event.id },
    select: { id: true },
  });
  const owned = new Set(teams.map((t) => t.id));

  const updates: { id: string; name: string | null }[] = [];
  for (const [id, raw] of Object.entries(names as Record<string, unknown>)) {
    if (!owned.has(id)) continue;
    const trimmed = asString(raw).trim().slice(0, MAX_NAME_LENGTH);
    updates.push({ id, name: trimmed === "" ? null : trimmed });
  }

  if (updates.length > 0) {
    await prisma.$transaction(
      updates.map((u) =>
        prisma.team.update({ where: { id: u.id }, data: { name: u.name } })
      )
    );
  }

  return ok({ teams: await loadTeams(event.id) });
}
