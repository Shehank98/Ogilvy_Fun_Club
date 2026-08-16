import { cookies } from "next/headers";
import { joinEvent } from "@/lib/assignment";
import { createPrismaAssignmentStore } from "@/lib/prisma-store";
import { prisma } from "@/lib/prisma";
import { getOrCreateEvent, teamLabel, toPublicEvent } from "@/lib/event";
import { JOIN_MESSAGES, asString, fail, ok, readJson } from "@/lib/api";
import { ENTRY_COOKIE, ENTRY_COOKIE_OPTIONS } from "@/lib/entry";

export const dynamic = "force-dynamic";

const store = createPrismaAssignmentStore(prisma);

export async function POST(request: Request) {
  const body = await readJson(request);
  const email = asString(body.email);

  const event = await getOrCreateEvent();
  const result = await joinEvent(store, event.id, email);

  if (result.status !== "assigned") {
    // Someone re-submitting the address they already used gets sent to the team
    // they were drawn, not a dead end.
    if (result.status === "already_joined") {
      const cookieStore = await cookies();
      cookieStore.set(ENTRY_COOKIE, result.memberId, ENTRY_COOKIE_OPTIONS);
      return fail(JOIN_MESSAGES.already_joined, 409, {
        reason: "already_joined",
        memberId: result.memberId,
      });
    }

    const status = result.status === "invalid_email" ? 400 : 409;
    return fail(JOIN_MESSAGES[result.status] ?? "Could not join.", status, {
      reason: result.status,
    });
  }

  // Fetch the roster the joiner will see revealed, including themselves.
  const team = await prisma.team.findUniqueOrThrow({
    where: { id: result.team.id },
    include: { members: { orderBy: { joinedAt: "asc" } } },
  });

  // Remember this entry so reopening the emailed link lands on their team.
  // The guest list is what actually enforces one entry per person; this is
  // only a convenience.
  const cookieStore = await cookies();
  cookieStore.set(ENTRY_COOKIE, result.member.id, ENTRY_COOKIE_OPTIONS);

  return ok({
    memberId: result.member.id,
    event: toPublicEvent(event),
    team: {
      id: team.id,
      teamNumber: team.teamNumber,
      label: teamLabel(team),
      color: team.color,
      logoUrl: team.logoUrl,
      members: team.members.map((m) => ({ id: m.id, name: m.name })),
    },
  });
}
