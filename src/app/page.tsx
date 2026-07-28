import JoinExperience from "@/components/JoinExperience";
import { getOrCreateEvent, loadTeams, toPublicEvent } from "@/lib/event";

// Signup state changes as people join, so never serve this from the cache.
export const dynamic = "force-dynamic";

export default async function JoinPage() {
  const event = await getOrCreateEvent();
  const teams = await loadTeams(event.id);

  const taken = teams.reduce((sum, team) => sum + team.members.length, 0);
  const capacity = teams.length * event.maxPerTeam;

  return (
    <JoinExperience
      event={toPublicEvent(event)}
      teamColors={teams.map((team) => team.color)}
      spotsLeft={Math.max(0, capacity - taken)}
      hasTeams={teams.length > 0}
    />
  );
}
