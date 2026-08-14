import { prisma } from "@/lib/prisma";
import { isAdminRequest } from "@/lib/auth";
import { getOrCreateEvent, loadTeams } from "@/lib/event";
import { loadInvitees } from "@/lib/invitees";
import { fail, ok } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Remove someone from the guest list.
 *
 * If they have already joined, their member goes too — otherwise a team would
 * keep a player nobody can account for. Deleting the member first also releases
 * the slot back to the draw.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ inviteeId: string }> }
) {
  if (!(await isAdminRequest())) return fail("Not authorised.", 401);

  const { inviteeId } = await params;
  const invitee = await prisma.invitee.findUnique({
    where: { id: inviteeId },
    select: { id: true, memberId: true },
  });
  if (!invitee) return fail("That person is no longer on the list.", 404);

  await prisma.$transaction(async (tx) => {
    if (invitee.memberId) {
      await tx.member.delete({ where: { id: invitee.memberId } });
    }
    await tx.invitee.delete({ where: { id: invitee.id } });
  });

  const event = await getOrCreateEvent();
  return ok({
    invitees: await loadInvitees(event.id),
    teams: await loadTeams(event.id),
  });
}
