import { prisma } from "@/lib/prisma";
import { isAdminRequest } from "@/lib/auth";
import { getOrCreateEvent } from "@/lib/event";
import { loadInvitees, parseGuestList } from "@/lib/invitees";
import { asString, fail, ok, readJson } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAdminRequest())) return fail("Not authorised.", 401);

  const event = await getOrCreateEvent();
  return ok({ invitees: await loadInvitees(event.id) });
}

/**
 * Bulk-add to the guest list from pasted text (one `email, name` per line).
 *
 * Adding is idempotent: an address already on the list has its name refreshed
 * rather than erroring, so an organiser can paste a corrected list over the top
 * without first clearing it. Re-pasting never disturbs who has already joined,
 * because the claim lives in `memberId` and is not touched here.
 */
export async function POST(request: Request) {
  if (!(await isAdminRequest())) return fail("Not authorised.", 401);

  const body = await readJson(request);
  const parsed = parseGuestList(asString(body.text));

  if (parsed.entries.length === 0) {
    return fail(
      parsed.errors.length > 0
        ? `Nothing could be read. First problem: ${parsed.errors[0]}`
        : "Paste at least one line in the form: email, name",
      400,
      { errors: parsed.errors }
    );
  }

  const event = await getOrCreateEvent();

  let added = 0;
  let updated = 0;

  await prisma.$transaction(async (tx) => {
    for (const entry of parsed.entries) {
      const existing = await tx.invitee.findUnique({
        where: { eventId_email: { eventId: event.id, email: entry.email } },
        select: { id: true, name: true },
      });

      if (!existing) {
        await tx.invitee.create({
          data: { eventId: event.id, email: entry.email, name: entry.name },
        });
        added++;
      } else if (existing.name !== entry.name) {
        await tx.invitee.update({
          where: { id: existing.id },
          data: { name: entry.name },
        });
        updated++;
      }
    }
  });

  return ok({
    added,
    updated,
    skipped: parsed.errors.length,
    errors: parsed.errors,
    invitees: await loadInvitees(event.id),
  });
}
