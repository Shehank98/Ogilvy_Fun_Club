"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useState } from "react";
import RevealSequence, { type RevealTeam } from "./RevealSequence";
import SoundToggle from "./SoundToggle";
import Backdrop from "./Backdrop";
import type { PublicEvent } from "@/lib/event";
import { MAX_EMAIL_LENGTH } from "@/lib/assignment";
import { playPop } from "@/lib/sound";

type Props = {
  event: PublicEvent;
  teamColors: string[];
  /** Server-rendered so a full event says so before anyone types. */
  spotsLeft: number;
  hasTeams: boolean;
};

export default function JoinExperience({ event, teamColors, spotsLeft, hasTeams }: Props) {
  const router = useRouter();
  const reducedMotion = useReducedMotion() ?? false;

  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "joining">("idle");
  const [error, setError] = useState<string | null>(null);
  const [reveal, setReveal] = useState<{
    team: RevealTeam;
    memberId: string;
    event: PublicEvent;
  } | null>(null);

  const closed = !event.isOpen;
  const full = hasTeams && spotsLeft <= 0;
  const disabled = closed || full || !hasTeams || status === "joining";

  async function submit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    if (disabled) return;

    const trimmed = email.trim();
    if (!trimmed) {
      setError("Please enter your email address.");
      return;
    }

    setStatus("joining");
    setError(null);
    playPop();

    try {
      const response = await fetch("/api/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const payload = await response.json();

      if (!response.ok) {
        // This browser already has an entry — show them the team they got
        // rather than a rejection they can do nothing about.
        if (payload?.reason === "already_joined" && payload?.memberId) {
          router.replace(`/result/${payload.memberId}`);
          return;
        }
        setError(payload?.error ?? "Something went wrong. Try again.");
        setStatus("idle");
        // The event may have filled or closed while this page was open.
        router.refresh();
        return;
      }

      // Use the event echoed back by the API rather than the one this page was
      // rendered with, so an admin editing the intro copy mid-event is reflected
      // in the reveal even for someone who had the page open beforehand.
      setReveal({
        team: payload.team,
        memberId: payload.memberId,
        event: payload.event ?? event,
      });
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      setStatus("idle");
    }
  }

  if (reveal) {
    return (
      <RevealSequence
        event={reveal.event}
        team={reveal.team}
        memberId={reveal.memberId}
        teamColors={teamColors}
        onComplete={() => router.replace(`/result/${reveal.memberId}`)}
      />
    );
  }

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center px-6 py-10">
      <Backdrop />

      <div className="safe-top absolute right-4 top-0">
        <SoundToggle />
      </div>

      <motion.div
        initial={reducedMotion ? false : { opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={reducedMotion ? { duration: 0 } : { duration: 0.8, ease: "easeOut" }}
        className="mb-8 flex flex-col items-center text-center"
      >
        {event.logoUrl ? (
          // The logo is an admin-supplied URL on an arbitrary host, so it is
          // served as-is rather than through the next/image optimiser.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={event.logoUrl}
            alt=""
            className="mb-6 h-24 w-auto max-w-[70vw] object-contain sm:h-32"
          />
        ) : (
          <div className="mb-6 grid h-24 w-24 place-items-center rounded-3xl border border-white/10 bg-white/5 text-4xl">
            🎳
          </div>
        )}
        <h1 className="text-balance text-3xl font-black leading-tight sm:text-4xl">
          {event.title}
        </h1>
        <p className="mt-3 text-balance text-sm text-white/55">
          Enter the email address your invite was sent to.
        </p>
      </motion.div>

      <motion.form
        onSubmit={submit}
        initial={reducedMotion ? false : { opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reducedMotion ? { duration: 0 } : { duration: 0.6, delay: 0.25 }}
        className="w-full max-w-sm space-y-4"
      >
        <div className="relative">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            inputMode="email"
            placeholder="you@ogilvy.com"
            aria-label="Your email address"
            maxLength={MAX_EMAIL_LENGTH}
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            disabled={disabled}
            className="w-full rounded-2xl border border-white/15 bg-white/5 px-5 py-4 text-lg text-white placeholder:text-white/35 outline-none backdrop-blur transition duration-300 focus:border-sky-400/60 focus:bg-white/10 focus:shadow-[0_0_0_4px_rgba(56,189,248,0.18),0_0_36px_rgba(56,189,248,0.28)] disabled:opacity-50"
          />
        </div>

        <motion.button
          type="submit"
          disabled={disabled}
          whileTap={reducedMotion || disabled ? undefined : { scale: 0.95 }}
          whileHover={reducedMotion || disabled ? undefined : { scale: 1.02 }}
          transition={{ type: "spring", stiffness: 420, damping: 22 }}
          className="w-full rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-500 px-5 py-4 text-lg font-bold text-white shadow-lg shadow-sky-500/20 transition disabled:cursor-not-allowed disabled:from-slate-700 disabled:to-slate-700 disabled:shadow-none"
        >
          {status === "joining" ? "Drawing your team…" : "Join"}
        </motion.button>

        <Notice closed={closed} full={full} hasTeams={hasTeams} spotsLeft={spotsLeft} error={error} />
      </motion.form>
    </main>
  );
}

function Notice({
  closed,
  full,
  hasTeams,
  spotsLeft,
  error,
}: {
  closed: boolean;
  full: boolean;
  hasTeams: boolean;
  spotsLeft: number;
  error: string | null;
}) {
  const message = error
    ? { text: error, tone: "error" as const }
    : !hasTeams
      ? { text: "No teams have been set up yet. Check back shortly.", tone: "muted" as const }
      : closed
        ? { text: "Signups are closed right now.", tone: "muted" as const }
        : full
          ? { text: "Every team is full. No spots left.", tone: "muted" as const }
          : spotsLeft <= 5
            ? {
                text: `Only ${spotsLeft} spot${spotsLeft === 1 ? "" : "s"} left!`,
                tone: "muted" as const,
              }
            : null;

  if (!message) return null;

  return (
    <p
      role={message.tone === "error" ? "alert" : "status"}
      className={`text-center text-sm ${
        message.tone === "error" ? "text-rose-300" : "text-white/60"
      }`}
    >
      {message.text}
    </p>
  );
}
