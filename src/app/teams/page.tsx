import AdminLogin from "@/components/AdminLogin";
import TeamsBoard from "@/components/TeamsBoard";
import { adminPin, isAdminRequest, ownerPin } from "@/lib/auth";
import { getOrCreateEvent, loadTeams, toPublicEvent } from "@/lib/event";

export const dynamic = "force-dynamic";

/**
 * The full draw is organiser-only. Participants see their own team on
 * `/result/[memberId]`; this board shows everyone's, so it sits behind the same
 * shared PIN as `/admin`.
 */
export default async function TeamsPage() {
  if (!(await isAdminRequest())) {
    return (
      <AdminLogin
        configured={adminPin() !== null || ownerPin() !== null}
        heading="Teams board"
        subheading="Enter the organiser PIN to see every team."
      />
    );
  }

  const event = await getOrCreateEvent();
  const teams = await loadTeams(event.id);

  return (
    <TeamsBoard
      initialEvent={toPublicEvent(event)}
      initialTeams={teams}
      initialAssignPointer={event.assignPointer}
    />
  );
}
