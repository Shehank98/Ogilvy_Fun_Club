import { getOrCreateEvent, loadTeams, toPublicEvent } from "@/lib/event";
import { isAdminRequest } from "@/lib/auth";
import { fail, ok } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Teams overview data, polled by `/teams`.
 *
 * Organiser-only, like the page it backs. Gating the page without gating this
 * would leave the full draw a single fetch away, so the restriction has to live
 * here too. Participants see their own team through `/api/member/[memberId]`.
 */
export async function GET() {
  if (!(await isAdminRequest())) return fail("Not authorised.", 401);

  const event = await getOrCreateEvent();
  const teams = await loadTeams(event.id);
  return ok({ event: toPublicEvent(event), teams });
}
