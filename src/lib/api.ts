import { NextResponse } from "next/server";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function fail(error: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status });
}

/** Human-readable copy for each non-assigned join outcome. */
export const JOIN_MESSAGES: Record<string, string> = {
  already_joined: "You're already in — one entry per person.",
  event_full: "Every team is full — no spots left. Talk to the organiser.",
  closed: "Signups are closed right now.",
  no_teams: "No teams have been set up yet. Check back shortly.",
  not_found: "This event no longer exists.",
  invalid_name: "Please enter your name.",
};

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function asInt(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}
