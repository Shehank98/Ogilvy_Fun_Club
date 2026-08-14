"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { rgbaFromHex } from "@/lib/colors";

type RosterMember = { id: string; name: string };

export type ResultData = {
  memberId: string;
  memberName: string;
  eventTitle: string;
  isOpen: boolean;
  maxPerTeam: number;
  team: {
    id: string;
    teamNumber: number;
    label: string;
    color: string;
    members: RosterMember[];
  };
};

const POLL_INTERVAL_MS = 4000;

/**
 * The page someone keeps open for the rest of the night. It polls its own
 * member endpoint every few seconds — no websockets needed at this scale — and
 * new teammates slide in as they are drawn.
 */
export default function ResultView({ initial }: { initial: ResultData }) {
  const [data, setData] = useState(initial);
  const reducedMotion = useReducedMotion() ?? false;
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const response = await fetch(`/api/member/${initial.memberId}`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const payload = (await response.json()) as ResultData;
        if (!cancelled) setData(payload);
      } catch {
        // Offline or a flaky connection — keep the last roster on screen and
        // try again on the next tick.
      }
    }

    const timer = window.setInterval(poll, POLL_INTERVAL_MS);
    // Catch up straight away when the phone comes back from sleep.
    const onVisible = () => document.visibilityState === "visible" && void poll();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [initial.memberId]);

  const { team } = data;
  const filled = team.members.length;

  return (
    <main
      className="min-h-dvh px-6 py-12"
      style={{
        background: `radial-gradient(ellipse at top, ${rgbaFromHex(team.color, 0.32)}, #020617 65%)`,
      }}
    >
      <div className="mx-auto w-full max-w-md">
        <header className="text-center">
          <p className="text-sm uppercase tracking-[0.3em] text-white/50">
            {data.eventTitle}
          </p>
          <p className="mt-6 text-lg text-white/70">You&rsquo;re on</p>
          <h1
            className="mt-1 text-5xl font-black leading-none sm:text-6xl"
            style={{ color: team.color }}
          >
            {team.label}
          </h1>
          <p className="mt-4 text-sm text-white/50">
            {filled} of {data.maxPerTeam} {filled === 1 ? "player" : "players"}
            {!data.isOpen && " · signups closed"}
          </p>
        </header>

        <section className="mt-10">
          <h2 className="mb-4 text-center text-xs font-semibold uppercase tracking-[0.25em] text-white/40">
            Roster
          </h2>
          <ul className="flex flex-col gap-3">
            <AnimatePresence initial={false}>
              {team.members.map((member) => (
                <motion.li
                  key={member.id}
                  layout={!reducedMotion}
                  initial={reducedMotion ? false : { opacity: 0, x: 28 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={reducedMotion ? { opacity: 0 } : { opacity: 0, x: -28 }}
                  transition={reducedMotion ? { duration: 0 } : { duration: 0.4, ease: "easeOut" }}
                  className="flex items-center justify-between rounded-2xl border px-5 py-4 text-lg font-semibold text-white backdrop-blur"
                  style={{
                    borderColor: rgbaFromHex(team.color, 0.45),
                    background: rgbaFromHex(team.color, 0.14),
                  }}
                >
                  <span>{member.name}</span>
                  {member.id === data.memberId && (
                    <span className="text-xs uppercase tracking-widest text-white/55">
                      you
                    </span>
                  )}
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>

          {data.isOpen && filled < data.maxPerTeam && (
            <p className="mt-6 text-center text-sm text-white/45">
              Waiting on {data.maxPerTeam - filled} more…
            </p>
          )}
        </section>

        {/* Someone else picking up a shared phone would otherwise be bounced
            here forever with no way back to the email form. */}
        <div className="safe-bottom mt-12 text-center">
          <button
            type="button"
            onClick={async () => {
              await fetch("/api/join", { method: "DELETE" });
              router.push("/");
              router.refresh();
            }}
            className="text-sm text-white/40 underline-offset-4 transition hover:text-white/70 hover:underline"
          >
            Not {data.memberName}? Use a different email
          </button>
        </div>
      </div>
    </main>
  );
}
