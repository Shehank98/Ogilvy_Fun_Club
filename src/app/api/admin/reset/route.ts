import { prisma } from "@/lib/prisma";
import { isAdminRequest } from "@/lib/auth";
import { getOrCreateEvent, loadTeams, syncTeams } from "@/lib/event";
import { fail, ok } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Clear every member and rebuild the teams from scratch, so the draw starts
 * over from team 1. Event settings (message, venue, logo, sizes) are kept.
 */
export async function POST() {
  if (!(await isAdminRequest())) return fail("Not authorised.", 401);

  const event = await getOrCreateEvent();

  await prisma.$transaction(async (tx) => {
    await tx.member.deleteMany({ where: { team: { eventId: event.id } } });
    await tx.team.deleteMany({ where: { eventId: event.id } });
    await syncTeams(tx, event.id, event.numTeams);
    await tx.event.update({ where: { id: event.id }, data: { assignPointer: 0 } });
  });

  return ok({ teams: await loadTeams(event.id) });
}
