import { prisma } from "@/lib/prisma";
import { isAdminRequest, isOwnerRequest } from "@/lib/auth";
import { getOrCreateEvent, loadTeams } from "@/lib/event";
import { loadInvitees } from "@/lib/invitees";
import { asString, fail, ok, readJson } from "@/lib/api";

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

/**
 * Move a member onto a chosen team — the owner-only override.
 *
 * Hidden higher tier: this is gated on `isOwnerRequest`, and to anyone without
 * the owner session it answers 404, as if the capability doesn't exist. The
 * move deliberately ignores team capacity — an override is exactly for when the
 * normal round-robin wouldn't put someone where the owner wants them.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ memberId: string }> }
) {
  // Not "Not authorised" — 404 keeps the feature invisible to plain admins.
  if (!(await isOwnerRequest())) return fail("Not found.", 404);

  const { memberId } = await params;
  const body = await readJson(request);
  const teamId = asString(body.teamId);

  const member = await prisma.member.findUnique({ where: { id: memberId } });
  if (!member) return fail("That member has already been removed.", 404);

  const event = await getOrCreateEvent();
  const team = await prisma.team.findFirst({
    where: { id: teamId, eventId: event.id },
    select: { id: true },
  });
  if (!team) return fail("Unknown team.", 400);

  if (member.teamId !== team.id) {
    await prisma.member.update({ where: { id: memberId }, data: { teamId: team.id } });
  }

  return ok({
    teams: await loadTeams(event.id),
    invitees: await loadInvitees(event.id),
  });
}
