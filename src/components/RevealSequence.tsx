"use client";

import {
  AnimatePresence,
  motion,
  useAnimationControls,
  useReducedMotion,
} from "framer-motion";
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
 * fade-and-lift so the sequence reads as one piece. It plays straight through:
 * an itinerary of event details, a decelerating draw, then the team lands with
 * an impact flash, god-rays, a holographic logo and a wash to the team colour.
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

  // Warm the logo into the browser cache the moment the sequence starts, so it
  // is already decoded by the time the team is revealed several seconds later —
  // otherwise a large or slow-hosted PNG (common on some CDNs and in Edge) can
  // still be loading during its big moment.
  useEffect(() => {
    if (!team.logoUrl) return;
    const img = new window.Image();
    img.decoding = "async";
    img.src = team.logoUrl;
  }, [team.logoUrl]);

  const revealed = step?.kind === "reveal" || step?.kind === "roster";

  // Impact shake fired when the team lands, for a physical "it hit" feel.
  const shakeControls = useAnimationControls();
  useEffect(() => {
    if (reducedMotion || step?.kind !== "reveal") return;
    void shakeControls.start({
      x: [0, -11, 9, -6, 4, -2, 0],
      y: [0, 7, -5, 4, -2, 1, 0],
      transition: { duration: 0.55, ease: "easeOut" },
    });
  }, [step?.kind, reducedMotion, shakeControls]);

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
      {/* Colour-grade wash: the team colour bleeds across the whole scene the
          moment the team lands, on top of the neutral draw background. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(ellipse at center, ${rgbaFromHex(team.color, 0.28)}, transparent 68%)`,
          opacity: revealed ? 1 : 0,
          transition: "opacity 1100ms ease",
        }}
      />

      <motion.div
        animate={shakeControls}
        className="pointer-events-none relative flex flex-1 items-center justify-center px-6 py-20"
        style={{
          filter: revealed ? "saturate(1.15)" : "saturate(0.9)",
          transition: "filter 1100ms ease",
        }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={step?.id ?? "done"}
            initial={reducedMotion ? false : { opacity: 0, y: 34, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={reducedMotion ? { opacity: 1 } : { opacity: 0, y: -28, filter: "blur(6px)" }}
            transition={transition}
            className="w-full max-w-2xl text-center"
          >
            {step?.kind === "info" && (
              <InfoStep step={step} reducedMotion={reducedMotion} />
            )}
            {step?.kind === "shuffle" && (
              <ShuffleStep
                colors={teamColors}
                reducedMotion={reducedMotion}
                durationMs={step.durationMs}
              />
            )}
            {step?.kind === "reveal" && (
              <TeamRevealStep team={team} reducedMotion={reducedMotion} />
            )}
            {step?.kind === "roster" && (
              <RosterStep team={team} reducedMotion={reducedMotion} memberId={memberId} />
            )}
          </motion.div>
        </AnimatePresence>
      </motion.div>

      {/* Impact flash: a white bloom the instant the team lands, fading fast. */}
      {step?.kind === "reveal" && !reducedMotion && (
        <motion.div
          aria-hidden
          initial={{ opacity: 0.85 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="pointer-events-none absolute inset-0 z-30 bg-white"
        />
      )}

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

function InfoStep({
  step,
  reducedMotion,
}: {
  step: RevealStep & { kind: "info" };
  reducedMotion: boolean;
}) {
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
      {/* A thin accent line strokes itself in between the label and the value. */}
      {!step.emphasis && (
        <motion.div
          aria-hidden
          initial={reducedMotion ? false : { scaleX: 0, opacity: 0 }}
          animate={{ scaleX: 1, opacity: 1 }}
          transition={{
            duration: reducedMotion ? 0 : 0.7,
            delay: reducedMotion ? 0 : 0.28,
            ease: [0.16, 1, 0.3, 1],
          }}
          className="mx-auto h-px w-16 origin-left sm:w-24"
          style={{
            background:
              "linear-gradient(90deg, transparent, rgba(255,255,255,0.7), transparent)",
          }}
        />
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

function ShuffleStep({
  colors,
  reducedMotion,
  durationMs,
}: {
  colors: string[];
  reducedMotion: boolean;
  durationMs: number;
}) {
  const [tick, setTick] = useState(0);

  // Slow-motion snap: the number cycles fast, then each step takes a little
  // longer than the last, so the spinner visibly decelerates into a stop —
  // like a draft wheel coming to rest.
  useEffect(() => {
    if (reducedMotion || colors.length === 0) return;
    let cancelled = false;
    let delay = 80;
    let timer = window.setTimeout(function run() {
      if (cancelled) return;
      setTick((t) => t + 1);
      delay = Math.min(delay * 1.16, 520);
      timer = window.setTimeout(run, delay);
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [reducedMotion, colors.length]);

  const activeIndex = colors.length > 0 ? tick % colors.length : 0;
  const activeColor = colors[activeIndex] ?? "#64748b";
  const seconds = durationMs / 1000;

  return (
    <div className="space-y-10">
      <p className="text-2xl font-semibold text-white/80 sm:text-3xl">
        Assigning your team…
      </p>
      <div className="flex items-center justify-center">
        <motion.div
          initial={reducedMotion ? false : { rotate: 0, scale: 1 }}
          animate={reducedMotion ? {} : { rotate: 900, scale: [1, 1, 1.12, 1] }}
          transition={{
            // Strong ease-out: quick spins up front, drifting to a near-stop.
            rotate: { duration: seconds, ease: [0.1, 0.7, 0.15, 1] },
            // A last-moment pop as it locks in.
            scale: { duration: seconds, times: [0, 0.85, 0.93, 1], ease: "easeOut" },
          }}
          className="grid h-32 w-32 place-items-center rounded-full border-4 border-white/10 will-change-transform"
          style={{
            borderTopColor: activeColor,
            boxShadow: `0 0 34px ${rgbaFromHex(activeColor, 0.5)}`,
          }}
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
    <div className="space-y-6">
      <motion.p
        initial={reducedMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reducedMotion ? 0 : 0.5 }}
        className="text-xl font-medium uppercase tracking-[0.3em] text-white/60"
      >
        You&rsquo;re on
      </motion.p>

      {team.logoUrl && (
        <div className="relative flex justify-center">
          {/* Rotating god-rays fanning out from behind the logo. */}
          {!reducedMotion && (
            <motion.div
              aria-hidden
              initial={{ opacity: 0, rotate: 0 }}
              animate={{ opacity: 0.55, rotate: 360 }}
              transition={{
                opacity: { duration: 0.9, delay: 0.15 },
                rotate: { duration: 16, repeat: Infinity, ease: "linear" },
              }}
              className="pointer-events-none absolute left-1/2 top-1/2 h-96 w-96 -translate-x-1/2 -translate-y-1/2 sm:h-[30rem] sm:w-[30rem]"
              style={{
                background: `repeating-conic-gradient(from 0deg, ${rgbaFromHex(
                  team.color,
                  0.22
                )} 0deg 7deg, transparent 7deg 22deg)`,
                maskImage:
                  "radial-gradient(circle, black 18%, transparent 66%)",
                WebkitMaskImage:
                  "radial-gradient(circle, black 18%, transparent 66%)",
              }}
            />
          )}

          {/* Pulsing glow halo in the team colour, lingering behind the logo. */}
          {!reducedMotion && (
            <motion.div
              aria-hidden
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: [0.35, 0.7, 0.35], scale: [1, 1.18, 1] }}
              transition={{
                duration: 2.4,
                repeat: Infinity,
                ease: "easeInOut",
                delay: 0.3,
              }}
              className="pointer-events-none absolute left-1/2 top-1/2 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl sm:h-72 sm:w-72"
              style={{ background: rgbaFromHex(team.color, 0.7) }}
            />
          )}

          {/* Logo blooms up out of the dark, with a one-time light sweep. */}
          <motion.div
            initial={
              reducedMotion
                ? false
                : { scale: 0.3, opacity: 0, filter: "brightness(0.2)" }
            }
            animate={{ scale: 1, opacity: 1, filter: "brightness(1)" }}
            transition={
              reducedMotion
                ? { duration: 0 }
                : { type: "spring", stiffness: 140, damping: 13, mass: 1 }
            }
            className="relative overflow-hidden rounded-2xl"
          >
            <TeamLogo url={team.logoUrl} color={team.color} />
            {/* Holographic sheen drifting across the logo, over and over. */}
            {!reducedMotion && (
              <motion.div
                aria-hidden
                initial={{ x: "-130%" }}
                animate={{ x: "130%" }}
                transition={{
                  duration: 2.4,
                  repeat: Infinity,
                  repeatDelay: 0.6,
                  ease: "easeInOut",
                  delay: 0.4,
                }}
                className="pointer-events-none absolute inset-y-0 w-2/3 -skew-x-12 mix-blend-overlay"
                style={{
                  background:
                    "linear-gradient(90deg, transparent, rgba(255,255,255,0.25) 35%, rgba(160,220,255,0.4) 50%, rgba(255,180,255,0.32) 65%, transparent)",
                }}
              />
            )}
          </motion.div>
        </div>
      )}

      <motion.h1
        initial={reducedMotion ? false : { y: 46, opacity: 0, scale: 0.9 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={
          reducedMotion
            ? { duration: 0 }
            : { type: "spring", stiffness: 130, damping: 15, mass: 1.1, delay: 0.35 }
        }
        className="text-balance break-words px-2 text-3xl font-black leading-[1.05] drop-shadow-[0_0_40px_rgba(0,0,0,0.45)] sm:text-4xl md:text-5xl"
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
function TeamLogo({ url, color }: { url: string; color: string }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  if (failed) return null;
  return (
    <div
      className="relative h-44 w-44 rounded-2xl border sm:h-56 sm:w-56"
      style={{
        borderColor: rgbaFromHex(color, 0.5),
        background: rgbaFromHex(color, 0.14),
      }}
    >
      {/* Pulsing placeholder until the image decodes, so a slow logo reads as
          "loading" rather than a blank hole during the reveal. */}
      {!loaded && (
        <div
          className="absolute inset-0 animate-pulse rounded-2xl"
          style={{ background: rgbaFromHex(color, 0.2) }}
        />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt=""
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className="absolute inset-0 h-full w-full rounded-2xl object-contain p-2 transition-opacity duration-500"
        style={{ opacity: loaded ? 1 : 0 }}
      />
    </div>
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
