import Link from "next/link";
import ResultView from "@/components/ResultView";
import { prisma } from "@/lib/prisma";
import { teamLabel } from "@/lib/event";

export const dynamic = "force-dynamic";

export default async function ResultPage({
  params,
}: {
  params: Promise<{ memberId: string }>;
}) {
  const { memberId } = await params;

  const member = await prisma.member.findUnique({
    where: { id: memberId },
    include: {
      team: {
        include: {
          members: { orderBy: { joinedAt: "asc" } },
          event: { select: { title: true, isOpen: true, maxPerTeam: true } },
        },
      },
    },
  });

  if (!member) return <MissingMember />;

  const { team } = member;

  return (
    <ResultView
      initial={{
        memberId: member.id,
        memberName: member.name,
        eventTitle: team.event.title,
        isOpen: team.event.isOpen,
        maxPerTeam: team.event.maxPerTeam,
        team: {
          id: team.id,
          teamNumber: team.teamNumber,
          label: teamLabel(team),
          color: team.color,
          members: team.members.map((m) => ({ id: m.id, name: m.name })),
        },
      }}
    />
  );
}

function MissingMember() {
  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      <div className="max-w-sm space-y-4">
        <p className="text-5xl">🎳</p>
        <h1 className="text-2xl font-bold">We couldn&rsquo;t find that spot</h1>
        <p className="text-white/60">
          The event may have been reset, or your name was removed by an organiser.
          Join again to get a new team.
        </p>
        <Link
          href="/"
          className="inline-block rounded-2xl bg-white/10 px-6 py-3 font-semibold text-white transition active:scale-95"
        >
          Back to signup
        </Link>
      </div>
    </main>
  );
}
