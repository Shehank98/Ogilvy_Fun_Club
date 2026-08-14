import { prisma } from "@/lib/prisma";
import { isAdminRequest } from "@/lib/auth";
import { getOrCreateEvent, loadTeams, syncTeams } from "@/lib/event";
import { loadInvitees } from "@/lib/invitees";
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

  // The guest list deliberately survives a reset: the same people are usually
  // being redrawn. Their claims are released with the members.
  return ok({
    teams: await loadTeams(event.id),
    invitees: await loadInvitees(event.id),
  });
}
