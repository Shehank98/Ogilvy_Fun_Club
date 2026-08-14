import { prisma } from "@/lib/prisma";
import { isAdminRequest } from "@/lib/auth";
import { getOrCreateEvent, loadTeams } from "@/lib/event";
import { loadInvitees } from "@/lib/invitees";
import { fail, ok } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Remove a member — typos, duplicates, no-shows. Frees their slot for the draw. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ memberId: string }> }
) {
  if (!(await isAdminRequest())) return fail("Not authorised.", 401);

  const { memberId } = await params;
  const member = await prisma.member.findUnique({ where: { id: memberId } });
  if (!member) return fail("That member has already been removed.", 404);

  await prisma.member.delete({ where: { id: memberId } });

  const event = await getOrCreateEvent();
  // Their guest-list claim is released by the FK, so send the refreshed list
  // back too: that address is usable again immediately.
  return ok({
    teams: await loadTeams(event.id),
    invitees: await loadInvitees(event.id),
  });
}
