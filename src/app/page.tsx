import { redirect } from "next/navigation";
import JoinExperience from "@/components/JoinExperience";
import { getOrCreateEvent, loadTeams, toPublicEvent } from "@/lib/event";
import { existingEntry } from "@/lib/entry";

// Signup state changes as people join, so never serve this from the cache.
export const dynamic = "force-dynamic";

export default async function JoinPage() {
  // One entry per person. Anyone who has already been drawn goes straight to
  // their team rather than being offered the form again. If an organiser has
  // removed them since, `existingEntry` returns null and they get another go.
  const entry = await existingEntry();
  if (entry) redirect(`/result/${entry}`);

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
