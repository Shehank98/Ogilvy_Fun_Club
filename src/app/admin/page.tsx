import AdminLogin from "@/components/AdminLogin";
import AdminPanel from "@/components/AdminPanel";
import { adminPin, isAdminRequest } from "@/lib/auth";
import { getOrCreateEvent, loadTeams, toPublicEvent } from "@/lib/event";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  if (!(await isAdminRequest())) {
    return <AdminLogin configured={adminPin() !== null} />;
  }

  const event = await getOrCreateEvent();
  const teams = await loadTeams(event.id);

  return <AdminPanel initialEvent={toPublicEvent(event)} initialTeams={teams} />;
}
