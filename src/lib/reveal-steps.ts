import type { PublicEvent } from "./event";

/**
 * The reveal sequence is data-driven: this builds the ordered list of
 * full-screen steps straight from the Event record, so anything the admin edits
 * (intro message, date, time, venue, notes) flows into the sequence with no
 * code change, and blank fields drop out instead of showing an empty screen.
 */

export type RevealStep =
  | {
      kind: "info";
      id: string;
      /** Small caption above the value, e.g. "Venue". */
      label: string | null;
      value: string;
      /** The intro message renders larger than the detail steps. */
      emphasis: boolean;
      durationMs: number;
    }
  | { kind: "shuffle"; id: "shuffle"; durationMs: number }
  | { kind: "reveal"; id: "reveal"; durationMs: number }
  | { kind: "roster"; id: "roster"; durationMs: number };

export const STEP_DURATIONS = {
  intro: 2000,
  detail: 1700,
  shuffle: 1800,
  reveal: 2600,
  /** Time held after the last teammate has animated in. */
  rosterOutro: 1600,
} as const;

/**
 * Reduced motion isn't only about removing transitions — the pacing exists to
 * let animations land, and without them the same timings are just dead waiting.
 * These keep the sequence readable while getting to the team roughly twice as
 * fast.
 */
export const REDUCED_MOTION_DURATIONS = {
  intro: 1100,
  detail: 900,
  shuffle: 700,
  reveal: 1400,
  rosterOutro: 1000,
} as const;

export const ROSTER_STAGGER_MS = 500;

type EventFields = Pick<
  PublicEvent,
  "introMessage" | "date" | "time" | "venue" | "notes"
>;

export function buildRevealSteps(
  event: EventFields,
  options: { memberCount?: number; reducedMotion?: boolean } = {}
): RevealStep[] {
  const { memberCount = 1, reducedMotion = false } = options;
  const timings = reducedMotion ? REDUCED_MOTION_DURATIONS : STEP_DURATIONS;
  const steps: RevealStep[] = [];

  const push = (id: string, label: string | null, raw: string, emphasis: boolean) => {
    const value = raw?.trim() ?? "";
    if (!value) return; // Admin left it blank — skip the step entirely.
    steps.push({
      kind: "info",
      id,
      label,
      value,
      emphasis,
      durationMs: emphasis ? timings.intro : timings.detail,
    });
  };

  push("intro", null, event.introMessage, true);
  push("date", "Date", event.date, false);
  push("time", "Time", event.time, false);
  push("venue", "Venue", event.venue, false);
  push("notes", "Also", event.notes, false);

  steps.push({ kind: "shuffle", id: "shuffle", durationMs: timings.shuffle });
  steps.push({ kind: "reveal", id: "reveal", durationMs: timings.reveal });

  // The roster step has to outlast its own stagger, or names would still be
  // arriving when the sequence tries to finish.
  const staggerTotal = reducedMotion ? 0 : Math.max(0, memberCount) * ROSTER_STAGGER_MS;
  steps.push({
    kind: "roster",
    id: "roster",
    durationMs: staggerTotal + timings.rosterOutro,
  });

  return steps;
}

/** Index of the first non-informational step — where "skip intro" lands. */
export function skipTargetIndex(steps: RevealStep[]): number {
  const index = steps.findIndex((step) => step.kind !== "info");
  return index === -1 ? steps.length - 1 : index;
}
