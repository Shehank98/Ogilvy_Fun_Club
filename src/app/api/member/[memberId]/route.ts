import { prisma } from "@/lib/prisma";
import { teamLabel } from "@/lib/event";
import { fail, ok } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Polled by the result page (every few seconds) to pick up new teammates. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ memberId: string }> }
) {
  const { memberId } = await params;

  const member = await prisma.member.findUnique({
    where: { id: memberId },
    include: {
      team: {
        include: {
          members: { orderBy: { joinedAt: "asc" } },
          event: {
            select: {
              maxPerTeam: true,
              title: true,
              isOpen: true,
              revealHeld: true,
              logoScale: true,
              date: true,
              time: true,
              venue: true,
              notes: true,
            },
          },
        },
      },
    },
  });

  if (!member) return fail("We couldn't find that spot.", 404);

  const { team } = member;
  const held = team.event.revealHeld;

  // While the owner is finalising teams, don't stream the live roster: the
  // participant page shows a holding screen, and we withhold the churning
  // member list so it can't be read off the network either.
  const members = held
    ? [{ id: member.id, name: member.name }]
    : team.members.map((m) => ({ id: m.id, name: m.name }));

  return ok({
    memberId: member.id,
    memberName: member.name,
    eventTitle: team.event.title,
    isOpen: team.event.isOpen,
    maxPerTeam: team.event.maxPerTeam,
    logoScale: team.event.logoScale,
    held,
    briefing: {
      date: team.event.date,
      time: team.event.time,
      venue: team.event.venue,
      notes: team.event.notes,
    },
    team: {
      id: team.id,
      teamNumber: team.teamNumber,
      label: teamLabel(team),
      color: team.color,
      logoUrl: team.logoUrl,
      members,
    },
  });
}
