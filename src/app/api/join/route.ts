import { cookies } from "next/headers";
import { joinEvent } from "@/lib/assignment";
import { createPrismaAssignmentStore } from "@/lib/prisma-store";
import { prisma } from "@/lib/prisma";
import { getOrCreateEvent, teamLabel, toPublicEvent } from "@/lib/event";
import { JOIN_MESSAGES, asString, fail, ok, readJson } from "@/lib/api";
import { ENTRY_COOKIE, ENTRY_COOKIE_OPTIONS, existingEntry } from "@/lib/entry";

export const dynamic = "force-dynamic";

const store = createPrismaAssignmentStore(prisma);

export async function POST(request: Request) {
  const body = await readJson(request);
  const name = asString(body.name);

  // One entry per person: if this browser already has a live entry, send them
  // back to it rather than drawing them a second team.
  const already = await existingEntry();
  if (already) {
    return fail(JOIN_MESSAGES.already_joined, 409, {
      reason: "already_joined",
      memberId: already,
    });
  }

  const event = await getOrCreateEvent();
  const result = await joinEvent(store, event.id, name);

  if (result.status !== "assigned") {
    const status = result.status === "invalid_name" ? 400 : 409;
    return fail(JOIN_MESSAGES[result.status] ?? "Could not join.", status, {
      reason: result.status,
    });
  }

  // Fetch the roster the joiner will see revealed, including themselves.
  const team = await prisma.team.findUniqueOrThrow({
    where: { id: result.team.id },
    include: { members: { orderBy: { joinedAt: "asc" } } },
  });

  // Claim this browser's single entry.
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
      members: team.members.map((m) => ({ id: m.id, name: m.name })),
    },
  });
}
