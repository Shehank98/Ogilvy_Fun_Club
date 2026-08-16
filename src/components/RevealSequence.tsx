"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ROSTER_STAGGER_MS,
  buildRevealSteps,
  type RevealStep,
} from "@/lib/reveal-steps";
import type { PublicEvent } from "@/lib/event";
import { rgbaFromHex } from "@/lib/colors";

export type RevealTeam = {
  teamNumber: number;
  label: string;
  color: string;
  logoUrl: string | null;
  members: { id: string; name: string }[];
};

type Props = {
  event: PublicEvent;
  team: RevealTeam;
  memberId: string;
  teamColors: string[];
  onComplete: () => void;
};

/**
 * The one-time, full-screen intro. Steps are built from the Event record and
 * played one at a time with `AnimatePresence`; every transition is the same
 * fade-and-lift so the sequence reads as one piece. Tapping skips ahead — past
 * the intro copy while it is playing, or straight to the result page once the
 * team is out.
 */
export default function RevealSequence({
  event,
  team,
  memberId,
  teamColors,
  onComplete,
}: Props) {
  const reducedMotion = useReducedMotion() ?? false;

  const steps = useMemo(
    () =>
      buildRevealSteps(event, {
        memberCount: team.members.length,
        reducedMotion,
      }),
    [event, team.members.length, reducedMotion]
  );

  const [index, setIndex] = useState(0);
  const step: RevealStep | undefined = steps[index];

  // `onComplete` navigates; keeping it in a ref stops a new function identity
  // from restarting the step timer mid-step.
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;

  // An index one past the last step means "finished". Keeping the state
  // updaters pure — and firing `onComplete` from an effect instead — means a
  // double-invoked updater under StrictMode can't navigate twice.
  const finished = index >= steps.length;

  useEffect(() => {
    if (finished) completeRef.current();
  }, [finished]);

  const advance = useCallback(() => {
    setIndex((current) => Math.min(current + 1, steps.length));
  }, [steps.length]);

  useEffect(() => {
    if (!step) return;
    const timer = window.setTimeout(advance, step.durationMs);
    return () => window.clearTimeout(timer);
  }, [step, advance]);

  const revealed = step?.kind === "reveal" || step?.kind === "roster";

  // Neutral until the team is out, then the whole screen takes the team colour.
  const background = revealed
    ? `radial-gradient(ellipse at center, ${rgbaFromHex(team.color, 0.42)}, #020617 72%)`
    : "radial-gradient(ellipse at center, rgba(30,41,59,0.9), #020617 72%)";

  // A long, soft ease so cards drift in and out rather than snapping. The
  // step durations above leave room for this to finish and still hold.
  const transition = reducedMotion
    ? { duration: 0 }
    : { duration: 0.85, ease: [0.16, 1, 0.3, 1] as const };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col overflow-hidden"
      style={{ background, transition: "background 1200ms ease" }}
      role="dialog"
      aria-modal="true"
      aria-label="Team reveal"
    >
      <div className="pointer-events-none relative flex flex-1 items-center justify-center px-6 py-20">
        <AnimatePresence mode="wait">
          <motion.div
            key={step?.id ?? "done"}
            initial={reducedMotion ? false : { opacity: 0, y: 34, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={reducedMotion ? { opacity: 1 } : { opacity: 0, y: -28, filter: "blur(6px)" }}
            transition={transition}
            className="w-full max-w-2xl text-center"
          >
            {step?.kind === "info" && <InfoStep step={step} reducedMotion={reducedMotion} />}
            {step?.kind === "shuffle" && (
              <ShuffleStep colors={teamColors} reducedMotion={reducedMotion} />
            )}
            {step?.kind === "reveal" && (
              <TeamRevealStep team={team} reducedMotion={reducedMotion} />
            )}
            {step?.kind === "roster" && (
              <RosterStep team={team} reducedMotion={reducedMotion} memberId={memberId} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="safe-bottom pointer-events-none relative flex flex-col items-center gap-4 px-6">
        <StepProgress
          count={steps.length}
          index={index}
          color={revealed ? team.color : "#94a3b8"}
        />
      </div>
    </div>
  );
}

function InfoStep({ step, reducedMotion }: { step: RevealStep & { kind: "info" }; reducedMotion: boolean }) {
  return (
    <div className="space-y-4">
      {step.label && (
        <motion.p
          initial={reducedMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: reducedMotion ? 0 : 0.5, delay: reducedMotion ? 0 : 0.18 }}
          className="text-sm font-medium uppercase tracking-[0.3em] text-white/50"
        >
          {step.label}
        </motion.p>
      )}
      <p
        className={
          step.emphasis
            ? "text-balance text-4xl font-bold leading-tight text-white sm:text-6xl"
            : "text-balance text-3xl font-semibold leading-tight text-white sm:text-5xl"
        }
      >
        {step.value}
      </p>
    </div>
  );
}

function ShuffleStep({ colors, reducedMotion }: { colors: string[]; reducedMotion: boolean }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (reducedMotion || colors.length === 0) return;
    const timer = window.setInterval(() => setTick((t) => t + 1), 170);
    return () => window.clearInterval(timer);
  }, [reducedMotion, colors.length]);

  const activeIndex = colors.length > 0 ? tick % colors.length : 0;
  const activeColor = colors[activeIndex] ?? "#64748b";

  return (
    <div className="space-y-10">
      <p className="text-2xl font-semibold text-white/80 sm:text-3xl">
        Assigning your team…
      </p>
      <div className="flex items-center justify-center">
        <motion.div
          animate={reducedMotion ? {} : { rotate: 360 }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}
          className="grid h-32 w-32 place-items-center rounded-full border-4 border-white/10 will-change-transform"
          style={{ borderTopColor: activeColor }}
        >
          <motion.span
            key={activeIndex}
            initial={reducedMotion ? false : { scale: 0.7, opacity: 0.4 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.18 }}
            className="text-5xl font-black tabular-nums"
            style={{ color: activeColor }}
          >
            {activeIndex + 1}
          </motion.span>
        </motion.div>
      </div>
    </div>
  );
}

function TeamRevealStep({ team, reducedMotion }: { team: RevealTeam; reducedMotion: boolean }) {
  useEffect(() => {
    if (reducedMotion) return;

    let cancelled = false;
    // canvas-confetti is only needed for this one step — load it here rather
    // than shipping it in the main bundle.
    void import("canvas-confetti").then(({ default: confetti }) => {
      if (cancelled) return;
      const common = { spread: 70, colors: [team.color, "#ffffff"], disableForReducedMotion: true };
      confetti({ ...common, particleCount: 90, origin: { y: 0.6 } });
      window.setTimeout(
        () => !cancelled && confetti({ ...common, particleCount: 60, origin: { x: 0.2, y: 0.7 } }),
        220
      );
      window.setTimeout(
        () => !cancelled && confetti({ ...common, particleCount: 60, origin: { x: 0.8, y: 0.7 } }),
        380
      );
    });

    return () => {
      cancelled = true;
    };
  }, [team.color, reducedMotion]);

  return (
    <div className="space-y-4">
      <p className="text-xl font-medium uppercase tracking-[0.3em] text-white/60">
        You&rsquo;re on
      </p>
      {team.logoUrl && (
        <motion.div
          initial={reducedMotion ? false : { scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={
            reducedMotion
              ? { duration: 0 }
              : { type: "spring", stiffness: 170, damping: 15, delay: 0.05 }
          }
          className="flex justify-center"
        >
          <TeamLogo url={team.logoUrl} color={team.color} size={144} />
        </motion.div>
      )}
      <motion.h1
        initial={reducedMotion ? false : { scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={
          reducedMotion
            ? { duration: 0 }
            : { type: "spring", stiffness: 150, damping: 14, mass: 1.1 }
        }
        className="text-6xl font-black leading-none drop-shadow-[0_0_40px_rgba(0,0,0,0.45)] sm:text-8xl"
        style={{ color: team.color }}
      >
        {team.label}!
      </motion.h1>
    </div>
  );
}

/**
 * A team's logo, shown next to its name wherever the team is revealed. Sits on
 * a soft tint of the team colour so a logo with transparent or white edges
 * still reads on the dark background. `onError` hides a broken URL so a bad or
 * non-direct link (a Google Drive share page, say) never leaves an empty box.
 */
function TeamLogo({
  url,
  color,
  size,
}: {
  url: string;
  color: string;
  size: number;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className="rounded-2xl border object-contain p-2"
      style={{
        width: size,
        height: size,
        borderColor: rgbaFromHex(color, 0.5),
        background: rgbaFromHex(color, 0.14),
      }}
    />
  );
}

function RosterStep({
  team,
  reducedMotion,
  memberId,
}: {
  team: RevealTeam;
  reducedMotion: boolean;
  memberId: string;
}) {
  const stagger = reducedMotion ? 0 : ROSTER_STAGGER_MS / 1000;

  return (
    <div className="space-y-6">
      <p className="text-lg font-medium uppercase tracking-[0.25em] text-white/60">
        {team.members.length > 1 ? "Your teammates" : "Your roster"}
      </p>
      <h2 className="text-3xl font-black sm:text-4xl" style={{ color: team.color }}>
        {team.label}
      </h2>
      <motion.ul
        initial="hidden"
        animate="visible"
        variants={{ visible: { transition: { staggerChildren: stagger } } }}
        className="mx-auto flex max-w-md flex-col gap-3"
      >
        {team.members.map((member) => (
          <motion.li
            key={member.id}
            variants={{
              hidden: reducedMotion ? { opacity: 1 } : { opacity: 0, y: 18, scale: 0.96 },
              visible: { opacity: 1, y: 0, scale: 1 },
            }}
            transition={
              reducedMotion
                ? { duration: 0 }
                : { duration: 0.65, ease: [0.16, 1, 0.3, 1] }
            }
            className="rounded-2xl border px-5 py-3 text-lg font-semibold text-white backdrop-blur"
            style={{
              borderColor: rgbaFromHex(team.color, 0.5),
              background: rgbaFromHex(team.color, 0.16),
            }}
          >
            {member.name}
            {member.id === memberId && (
              <span className="ml-2 text-xs uppercase tracking-widest text-white/60">
                you
              </span>
            )}
          </motion.li>
        ))}
      </motion.ul>
    </div>
  );
}

function StepProgress({
  count,
  index,
  color,
}: {
  count: number;
  index: number;
  color: string;
}) {
  return (
    <div aria-hidden className="flex justify-center gap-1.5">
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className="h-1 w-6 rounded-full transition-colors duration-300"
          style={{ background: i <= index ? color : "rgba(255,255,255,0.15)" }}
        />
      ))}
    </div>
  );
}
