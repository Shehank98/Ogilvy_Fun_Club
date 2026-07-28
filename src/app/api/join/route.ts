import { joinEvent } from "@/lib/assignment";
import { createPrismaAssignmentStore } from "@/lib/prisma-store";
import { prisma } from "@/lib/prisma";
import { getOrCreateEvent, teamLabel, toPublicEvent } from "@/lib/event";
import { JOIN_MESSAGES, asString, fail, ok, readJson } from "@/lib/api";

export const dynamic = "force-dynamic";

const store = createPrismaAssignmentStore(prisma);

export async function POST(request: Request) {
  const body = await readJson(request);
  const name = asString(body.name);

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
