import { describe, expect, it } from "vitest";
import {
  REDUCED_MOTION_DURATIONS,
  ROSTER_STAGGER_MS,
  STEP_DURATIONS,
  buildRevealSteps,
  skipTargetIndex,
} from "../reveal-steps";

const fullEvent = {
  introMessage: "Welcome to bowling night!",
  date: "Friday 8 August",
  time: "7:00 PM",
  venue: "The Basement Bar",
  notes: "Bring a friend",
};

describe("buildRevealSteps", () => {
  it("orders the steps as scripted", () => {
    const ids = buildRevealSteps(fullEvent).map((s) => s.id);
    expect(ids).toEqual([
      "intro",
      "date",
      "time",
      "venue",
      "notes",
      "shuffle",
      "reveal",
      "roster",
    ]);
  });

  it("drops the notes step when the admin left notes empty", () => {
    const ids = buildRevealSteps({ ...fullEvent, notes: "   " }).map((s) => s.id);
    expect(ids).not.toContain("notes");
    expect(ids).toEqual(["intro", "date", "time", "venue", "shuffle", "reveal", "roster"]);
  });

  it("drops any blank detail field, not just notes", () => {
    const ids = buildRevealSteps({
      introMessage: "Hi",
      date: "",
      time: "",
      venue: "",
      notes: "",
    }).map((s) => s.id);
    expect(ids).toEqual(["intro", "shuffle", "reveal", "roster"]);
  });

  it("still reaches the reveal when every field is blank", () => {
    const ids = buildRevealSteps({
      introMessage: "",
      date: "",
      time: "",
      venue: "",
      notes: "",
    }).map((s) => s.id);
    expect(ids).toEqual(["shuffle", "reveal", "roster"]);
  });

  it("gives the intro more time on screen than the details", () => {
    const steps = buildRevealSteps(fullEvent);
    const intro = steps.find((s) => s.id === "intro")!;
    const venue = steps.find((s) => s.id === "venue")!;
    expect(intro.durationMs).toBe(STEP_DURATIONS.intro);
    expect(venue.durationMs).toBe(STEP_DURATIONS.detail);
  });

  it("stretches the roster step to cover the stagger", () => {
    const steps = buildRevealSteps(fullEvent, { memberCount: 5 });
    const roster = steps.find((s) => s.id === "roster")!;
    expect(roster.durationMs).toBe(5 * ROSTER_STAGGER_MS + STEP_DURATIONS.rosterOutro);
  });

  it("drops the stagger allowance under reduced motion", () => {
    const steps = buildRevealSteps(fullEvent, { memberCount: 5, reducedMotion: true });
    const roster = steps.find((s) => s.id === "roster")!;
    expect(roster.durationMs).toBe(REDUCED_MOTION_DURATIONS.rosterOutro);
  });

  it("keeps the same steps under reduced motion, just faster", () => {
    const normal = buildRevealSteps(fullEvent, { memberCount: 3 });
    const reduced = buildRevealSteps(fullEvent, { memberCount: 3, reducedMotion: true });

    expect(reduced.map((s) => s.id)).toEqual(normal.map((s) => s.id));

    const total = (steps: typeof normal) =>
      steps.reduce((sum, s) => sum + s.durationMs, 0);
    // Without animations to wait on, the pacing would just be dead time.
    expect(total(reduced)).toBeLessThan(total(normal) / 2);
  });

  it("still gives every reduced-motion step time to be read", () => {
    for (const step of buildRevealSteps(fullEvent, { reducedMotion: true })) {
      expect(step.durationMs).toBeGreaterThanOrEqual(700);
    }
  });

  it("trims whitespace around values", () => {
    const steps = buildRevealSteps({ ...fullEvent, venue: "  The Basement Bar \n" });
    const venue = steps.find((s) => s.id === "venue")!;
    expect(venue.kind === "info" && venue.value).toBe("The Basement Bar");
  });
});

describe("skipTargetIndex", () => {
  it("lands on the shuffle step so nobody skips past their team", () => {
    const steps = buildRevealSteps(fullEvent);
    expect(steps[skipTargetIndex(steps)].kind).toBe("shuffle");
  });

  it("is the first step when there is no intro content at all", () => {
    const steps = buildRevealSteps({
      introMessage: "",
      date: "",
      time: "",
      venue: "",
      notes: "",
    });
    expect(skipTargetIndex(steps)).toBe(0);
  });
});
