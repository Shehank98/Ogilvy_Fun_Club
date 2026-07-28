import { getOrCreateEvent, loadTeams, toPublicEvent } from "@/lib/event";
import { ok } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Public teams overview data; polled by `/teams`. */
export async function GET() {
  const event = await getOrCreateEvent();
  const teams = await loadTeams(event.id);
  return ok({ event: toPublicEvent(event), teams });
}
