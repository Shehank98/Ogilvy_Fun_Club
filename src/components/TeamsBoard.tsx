"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { rgbaFromHex } from "@/lib/colors";
import type { PublicEvent, PublicTeam } from "@/lib/event";
import { selectTeam } from "@/lib/assignment";

const POLL_INTERVAL_MS = 5000;

export default function TeamsBoard({
  initialEvent,
  initialTeams,
  initialAssignPointer,
}: {
  initialEvent: PublicEvent;
  initialTeams: PublicTeam[];
  initialAssignPointer: number;
}) {
  const [event, setEvent] = useState(initialEvent);
  const [teams, setTeams] = useState(initialTeams);
  const [pointer, setPointer] = useState(initialAssignPointer);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const response = await fetch("/api/teams", { cache: "no-store" });
        if (response.status === 401) {
          // The organiser session expired while the board was left open —
          // re-render the page so the PIN gate takes over instead of showing a
          // roster that has silently stopped updating.
          router.refresh();
          return;
        }
        if (!response.ok) return;
        const payload = (await response.json()) as {
          event: PublicEvent;
          teams: PublicTeam[];
          assignPointer?: number;
        };
        if (cancelled) return;
        setEvent(payload.event);
        setTeams(payload.teams);
        if (typeof payload.assignPointer === "number") setPointer(payload.assignPointer);
      } catch {
        // Keep showing the last good board until the next tick succeeds.
      }
    }

    const timer = window.setInterval(poll, POLL_INTERVAL_MS);
    const onVisible = () => document.visibilityState === "visible" && void poll();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  // Which team the next person to join will land in — the same round-robin
  // decision the join endpoint makes (skips any team already full).
  const nextSelection = selectTeam(
    teams.map((t) => ({
      id: t.id,
      teamNumber: t.teamNumber,
      memberCount: t.members.length,
    })),
    pointer,
    event.maxPerTeam
  );
  const nextTeamId = nextSelection.status === "assigned" ? nextSelection.team.id : null;

  return (
    <main className="min-h-dvh px-5 py-10">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-8 text-center">
          <h1 className="text-3xl font-black sm:text-4xl">{event.title}</h1>
          <p className="mt-2 text-sm text-white/50">
            {teams.length} {teams.length === 1 ? "team" : "teams"} · up to{" "}
            {event.maxPerTeam} per team
            {!event.isOpen && " · signups closed"}
          </p>
        </header>

        {teams.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {teams.map((team) => (
              <TeamCard
                key={team.id}
                team={team}
                maxPerTeam={event.maxPerTeam}
                isNext={team.id === nextTeamId}
              />
            ))}
          </div>
        )}

        <div className="safe-bottom mt-10 text-center">
          <Link
            href="/admin"
            className="inline-block rounded-2xl border border-white/15 bg-white/5 px-6 py-3 text-sm font-semibold text-white/80 transition active:scale-95"
          >
            Back to admin
          </Link>
        </div>
      </div>
    </main>
  );
}

function TeamCard({
  team,
  maxPerTeam,
  isNext,
}: {
  team: PublicTeam;
  maxPerTeam: number;
  isNext: boolean;
}) {
  const reducedMotion = useReducedMotion() ?? false;
  const filled = team.members.length;
  const isFull = filled >= maxPerTeam && maxPerTeam > 0;
  const percent = maxPerTeam > 0 ? Math.min(100, (filled / maxPerTeam) * 100) : 0;
  const label = team.name?.trim() ? team.name.trim() : `Team ${team.teamNumber}`;

  return (
    <motion.article
      whileHover={reducedMotion ? undefined : { y: -6 }}
      whileTap={reducedMotion ? undefined : { y: -2, scale: 0.99 }}
      transition={{ type: "spring", stiffness: 320, damping: 24 }}
      className="relative rounded-3xl border p-5 backdrop-blur will-change-transform"
      style={{
        borderColor: rgbaFromHex(team.color, isNext ? 0.9 : 0.45),
        background: rgbaFromHex(team.color, 0.1),
        boxShadow: isNext ? `0 0 0 2px ${rgbaFromHex(team.color, 0.6)}` : undefined,
      }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xl font-black" style={{ color: team.color }}>
          {label}
        </h2>
        <span className="text-xs font-semibold uppercase tracking-widest text-white/50">
          {filled}/{maxPerTeam}
        </span>
      </div>

      {isNext && (
        <motion.p
          layout={!reducedMotion}
          initial={reducedMotion ? false : { opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-400/15 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.15em] text-emerald-200"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
          Next to fill
        </motion.p>
      )}

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/10">
        <motion.div
          initial={false}
          animate={{ width: `${percent}%` }}
          transition={reducedMotion ? { duration: 0 } : { duration: 0.7, ease: "easeOut" }}
          className="h-full rounded-full"
          style={{ background: team.color }}
        />
      </div>

      <AnimatePresence>
        {isFull && (
          <motion.p
            initial={reducedMotion ? false : { opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={
              reducedMotion
                ? { duration: 0 }
                : { type: "spring", stiffness: 480, damping: 14 }
            }
            className="mt-3 inline-block rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.2em]"
            style={{ background: team.color, color: "#0b1120" }}
          >
            Full
          </motion.p>
        )}
      </AnimatePresence>

      <ul className="mt-4 flex flex-col gap-2">
        <AnimatePresence initial={false}>
          {team.members.map((member) => (
            <motion.li
              key={member.id}
              layout={!reducedMotion}
              initial={reducedMotion ? false : { opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reducedMotion ? { opacity: 0 } : { opacity: 0, x: -20 }}
              transition={reducedMotion ? { duration: 0 } : { duration: 0.35 }}
              className="rounded-xl bg-white/5 px-3 py-2 text-sm font-medium text-white/90"
            >
              {member.name}
            </motion.li>
          ))}
        </AnimatePresence>
        {filled === 0 && (
          <li className="rounded-xl border border-dashed border-white/10 px-3 py-2 text-sm text-white/35">
            No players yet
          </li>
        )}
      </ul>
    </motion.article>
  );
}

function EmptyState() {
  return (
    <div className="rounded-3xl border border-dashed border-white/15 px-6 py-16 text-center">
      <p className="text-4xl">🎳</p>
      <h2 className="mt-4 text-xl font-bold">No teams configured yet</h2>
      <p className="mt-2 text-sm text-white/50">
        An organiser needs to set the number of teams in the admin panel.
      </p>
    </div>
  );
}
