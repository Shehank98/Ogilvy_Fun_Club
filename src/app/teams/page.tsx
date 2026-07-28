import TeamsBoard from "@/components/TeamsBoard";
import { getOrCreateEvent, loadTeams, toPublicEvent } from "@/lib/event";

export const dynamic = "force-dynamic";

export default async function TeamsPage() {
  const event = await getOrCreateEvent();
  const teams = await loadTeams(event.id);

  return <TeamsBoard initialEvent={toPublicEvent(event)} initialTeams={teams} />;
}
