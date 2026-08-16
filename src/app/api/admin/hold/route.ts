import { prisma } from "@/lib/prisma";
import { isOwnerRequest } from "@/lib/auth";
import { getOrCreateEvent } from "@/lib/event";
import { fail, ok, readJson } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Owner-only "finalise" hold. While on, participants see a holding screen
 * instead of their live roster, so team arranging isn't watched in real time;
 * turning it off publishes the final rosters to everyone at once.
 *
 * Gated on `isOwnerRequest` and answers 404 to any non-owner session, so the
 * capability stays invisible to plain admins.
 */
export async function POST(request: Request) {
  if (!(await isOwnerRequest())) return fail("Not found.", 404);

  const body = await readJson(request);
  const held = Boolean(body.held);

  const event = await getOrCreateEvent();
  await prisma.event.update({ where: { id: event.id }, data: { revealHeld: held } });

  return ok({ held });
}
