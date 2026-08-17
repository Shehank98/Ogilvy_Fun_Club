"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { PublicEvent, PublicTeam } from "@/lib/event";
import type { PublicInvitee } from "@/lib/invitees";
import { rgbaFromHex } from "@/lib/colors";
import { dominantColorFromUrl } from "@/lib/dominant-color";
import { selectTeam } from "@/lib/assignment";

type Props = {
  initialEvent: PublicEvent;
  initialTeams: PublicTeam[];
  initialInvitees: PublicInvitee[];
  initialAssignPointer: number;
  /** Owner tier: unlocks hidden controls (moving people, finalise hold). */
  isOwner: boolean;
  /** Owner tier: whether the participant view is currently held. */
  initialHeld: boolean;
};

type Toast = { tone: "ok" | "error"; text: string } | null;

export default function AdminPanel({
  initialEvent,
  initialTeams,
  initialInvitees,
  initialAssignPointer,
  isOwner,
  initialHeld,
}: Props) {
  const router = useRouter();
  const [event, setEvent] = useState(initialEvent);
  const [pointer, setPointer] = useState(initialAssignPointer);
  const [held, setHeld] = useState(initialHeld);
  const [teams, setTeams] = useState(initialTeams);
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialTeams.map((t) => [t.id, t.name ?? ""]))
  );
  const [logoDrafts, setLogoDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialTeams.map((t) => [t.id, t.logoUrl ?? ""]))
  );
  const [colorDrafts, setColorDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialTeams.map((t) => [t.id, t.color]))
  );
  // Which team's colour is currently being sampled from its logo, so only that
  // row's button shows a spinner.
  const [samplingTeamId, setSamplingTeamId] = useState<string | null>(null);
  const [invitees, setInvitees] = useState(initialInvitees);
  const [guestPaste, setGuestPaste] = useState("");
  const [guestErrors, setGuestErrors] = useState<string[]>([]);
  const [draft, setDraft] = useState(initialEvent);
  const [toast, setToast] = useState<Toast>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(event);

  function announce(tone: "ok" | "error", text: string) {
    setToast({ tone, text });
    window.setTimeout(() => setToast(null), 4000);
  }

  // Refresh the team list and re-seed the name inputs from the server, so the
  // drafts always start from what's actually stored (teams change on reset,
  // resize, and member/guest removal).
  function applyTeams(next: PublicTeam[]) {
    setTeams(next);
    setNameDrafts(Object.fromEntries(next.map((t) => [t.id, t.name ?? ""])));
    setLogoDrafts(Object.fromEntries(next.map((t) => [t.id, t.logoUrl ?? ""])));
    setColorDrafts(Object.fromEntries(next.map((t) => [t.id, t.color])));
  }

  const namesDirty = teams.some(
    (t) => (nameDrafts[t.id] ?? "").trim() !== (t.name ?? "")
  );
  const logosDirty = teams.some(
    (t) => (logoDrafts[t.id] ?? "").trim() !== (t.logoUrl ?? "")
  );
  const colorsDirty = teams.some(
    (t) => (colorDrafts[t.id] ?? t.color).toLowerCase() !== t.color.toLowerCase()
  );
  const teamMetaDirty = namesDirty || logosDirty || colorsDirty;

  // Read the latest values inside the polling interval without re-subscribing.
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // Live refresh: poll the admin snapshot every few seconds so rosters, join
  // statuses and the "next team" indicator stay current as people join —
  // without a manual reload. It merges carefully so it never clobbers the
  // organiser's in-progress edits.
  useEffect(() => {
    let cancelled = false;

    async function poll() {
      if (document.visibilityState !== "visible") return;
      if (busyRef.current) return; // a mutation is in flight; let it settle
      try {
        const response = await fetch("/api/admin/event", { cache: "no-store" });
        if (response.status === 401) {
          // Organiser session expired with the panel left open — let the PIN
          // gate take over rather than showing a board that stopped updating.
          router.refresh();
          return;
        }
        if (!response.ok) return;
        const payload = await response.json();
        if (cancelled || busyRef.current) return;

        setInvitees(payload.invitees);
        setTeams(payload.teams);
        if (typeof payload.assignPointer === "number") {
          setPointer(payload.assignPointer);
        }
        // Keep any team name/logo the organiser is mid-edit; seed only new teams.
        setNameDrafts((prev) => {
          const next: Record<string, string> = {};
          for (const t of payload.teams as PublicTeam[]) {
            next[t.id] = t.id in prev ? prev[t.id] : t.name ?? "";
          }
          return next;
        });
        setLogoDrafts((prev) => {
          const next: Record<string, string> = {};
          for (const t of payload.teams as PublicTeam[]) {
            next[t.id] = t.id in prev ? prev[t.id] : t.logoUrl ?? "";
          }
          return next;
        });
        setColorDrafts((prev) => {
          const next: Record<string, string> = {};
          for (const t of payload.teams as PublicTeam[]) {
            next[t.id] = t.id in prev ? prev[t.id] : t.color;
          }
          return next;
        });
        // Only refresh the settings form when there's nothing unsaved to lose.
        if (!dirtyRef.current) {
          setEvent(payload.event);
          setDraft(payload.event);
        }
      } catch {
        // Keep the last good snapshot and try again next tick.
      }
    }

    const timer = window.setInterval(poll, 5000);
    const onVisible = () => document.visibilityState === "visible" && void poll();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  async function saveTeamMeta() {
    setBusy(true);
    try {
      const names = Object.fromEntries(
        teams.map((t) => [t.id, nameDrafts[t.id] ?? ""])
      );
      const logos = Object.fromEntries(
        teams.map((t) => [t.id, logoDrafts[t.id] ?? ""])
      );
      const colors = Object.fromEntries(
        teams.map((t) => [t.id, colorDrafts[t.id] ?? t.color])
      );
      const response = await fetch("/api/admin/teams", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names, logos, colors }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        announce("error", payload?.error ?? "Could not save teams.");
        return;
      }
      applyTeams(payload.teams);
      announce("ok", "Team names, colours and logos saved.");
    } catch {
      announce("error", "Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  // Derive a team's colour from its logo. Reads the dominant colour off the
  // current logo draft and drops it into the colour field, still unsaved, so the
  // organiser can nudge or overwrite it before saving.
  async function pickColorFromLogo(teamId: string) {
    const url = (logoDrafts[teamId] ?? "").trim();
    if (!url) {
      announce("error", "Add a logo URL first, then pull its colour.");
      return;
    }
    setSamplingTeamId(teamId);
    try {
      const color = await dominantColorFromUrl(url);
      if (!color) {
        announce("error", "Couldn't read a colour from that logo. Pick one by hand.");
        return;
      }
      setColorDrafts((d) => ({ ...d, [teamId]: color }));
      announce("ok", `Colour ${color} pulled from the logo. Save to apply.`);
    } finally {
      setSamplingTeamId(null);
    }
  }

  async function save(patch: Partial<PublicEvent>) {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/event", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        announce("error", payload?.error ?? "Could not save.");
        return false;
      }

      setEvent(payload.event);
      setDraft(payload.event);
      applyTeams(payload.teams);
      if (typeof payload.assignPointer === "number") setPointer(payload.assignPointer);
      announce("ok", "Saved.");
      return true;
    } catch {
      announce("error", "Couldn't reach the server.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function toggleOpen() {
    const next = !event.isOpen;
    // Sent straight through rather than via the draft, so the toggle takes
    // effect immediately even with unsaved edits in the form above.
    await save({ isOpen: next });
  }

  async function uploadLogo(file: File) {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/admin/upload", { method: "POST", body: form });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        announce("error", payload?.error ?? "Upload failed.");
        return;
      }

      setEvent(payload.event);
      setDraft((d) => ({ ...d, logoUrl: payload.event.logoUrl }));
      announce("ok", `Logo uploaded (${payload.storage}).`);
    } catch {
      announce("error", "Upload failed.");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function removeMember(memberId: string, name: string) {
    if (!window.confirm(`Remove ${name} from their team?`)) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/members/${memberId}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        announce("error", payload?.error ?? "Could not remove.");
        return;
      }
      applyTeams(payload.teams);
      if (payload.invitees) setInvitees(payload.invitees);
      announce("ok", `${name} removed. Their email can be used again.`);
    } finally {
      setBusy(false);
    }
  }

  // Owner-only: move a member onto a chosen team. The endpoint 404s for a
  // non-owner session, so this control never renders unless `isOwner` anyway.
  async function moveMember(memberId: string, teamId: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/members/${memberId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        announce("error", payload?.error ?? "Could not move.");
        return;
      }
      applyTeams(payload.teams);
      if (payload.invitees) setInvitees(payload.invitees);
      announce("ok", "Moved.");
    } finally {
      setBusy(false);
    }
  }

  // Owner-only: hold or publish the participant view while arranging teams.
  async function toggleHold() {
    const next = !held;
    setBusy(true);
    try {
      const response = await fetch("/api/admin/hold", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ held: next }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        announce("error", payload?.error ?? "Could not update.");
        return;
      }
      setHeld(next);
      announce(
        "ok",
        next
          ? "Finalise mode on. Everyone sees a holding screen."
          : "Published. Everyone sees their final roster now."
      );
    } finally {
      setBusy(false);
    }
  }

  async function resetEvent() {
    const total = teams.reduce((sum, t) => sum + t.members.length, 0);
    if (
      !window.confirm(
        `Reset the event? This deletes all ${total} member${total === 1 ? "" : "s"} and restarts the draw. Event settings are kept.`
      )
    ) {
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/admin/reset", { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        announce("error", payload?.error ?? "Could not reset.");
        return;
      }
      applyTeams(payload.teams);
      if (payload.invitees) setInvitees(payload.invitees);
      // Reset restarts the rotation from team 1 (pointer 0).
      setPointer(0);
      announce("ok", "Event reset. The draw starts from team 1.");
    } finally {
      setBusy(false);
    }
  }

  async function addGuests() {
    if (!guestPaste.trim()) return;
    setBusy(true);
    setGuestErrors([]);
    try {
      const response = await fetch("/api/admin/invitees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: guestPaste }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setGuestErrors(payload?.errors ?? []);
        announce("error", payload?.error ?? "Could not add anyone.");
        return;
      }

      setInvitees(payload.invitees);
      setGuestPaste("");
      setGuestErrors(payload.errors ?? []);

      const parts = [];
      if (payload.added) parts.push(`${payload.added} added`);
      if (payload.updated) parts.push(`${payload.updated} updated`);
      if (payload.skipped) parts.push(`${payload.skipped} skipped`);
      announce("ok", parts.length ? `Guest list: ${parts.join(", ")}.` : "No changes.");
    } catch {
      announce("error", "Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function removeGuest(invitee: PublicInvitee) {
    const warning = invitee.memberId
      ? `Remove ${invitee.name} from the guest list? They have already been drawn into team ${invitee.teamNumber}, so that spot is freed too.`
      : `Remove ${invitee.name} from the guest list?`;
    if (!window.confirm(warning)) return;

    setBusy(true);
    try {
      const response = await fetch(`/api/admin/invitees/${invitee.id}`, {
        method: "DELETE",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        announce("error", payload?.error ?? "Could not remove.");
        return;
      }
      setInvitees(payload.invitees);
      applyTeams(payload.teams);
      announce("ok", `${invitee.name} removed from the guest list.`);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/admin/login", { method: "DELETE" });
    router.refresh();
  }

  const totalMembers = teams.reduce((sum, t) => sum + t.members.length, 0);
  const joinedCount = invitees.filter((i) => i.memberId).length;

  // Which team the next person to join will land in. Reuses the exact draw
  // logic (round-robin from the pointer, skipping any team already full), so
  // this matches what the join endpoint would actually do.
  const nextSelection = selectTeam(
    teams.map((t) => ({
      id: t.id,
      teamNumber: t.teamNumber,
      memberCount: t.members.length,
    })),
    pointer,
    event.maxPerTeam
  );
  const nextTeam =
    nextSelection.status === "assigned"
      ? teams.find((t) => t.id === nextSelection.team.id) ?? null
      : null;

  return (
    <main className="min-h-dvh px-5 py-10">
      <div className="mx-auto w-full max-w-3xl space-y-8">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black">Event admin</h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-white/50">
              <span>
                {totalMembers} signed up across {teams.length}{" "}
                {teams.length === 1 ? "team" : "teams"}
              </span>
              <span className="inline-flex items-center gap-1 text-xs text-emerald-300/80">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                Live
              </span>
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Link
              href="/teams"
              className="rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-white/70 transition active:scale-95"
            >
              Teams board
            </Link>
            <button
              onClick={logout}
              className="rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-white/70 transition active:scale-95"
            >
              Log out
            </button>
          </div>
        </header>

        {toast && (
          <p
            role="status"
            className={`rounded-2xl border px-4 py-3 text-sm ${
              toast.tone === "ok"
                ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                : "border-rose-400/30 bg-rose-400/10 text-rose-200"
            }`}
          >
            {toast.text}
          </p>
        )}

        <Section title="Signups">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-semibold">{event.isOpen ? "Open" : "Closed"}</p>
              <p className="text-sm text-white/50">
                {event.isOpen
                  ? "People can join and be drawn into teams."
                  : "Nobody new can join. Existing teams stay visible."}
              </p>
            </div>
            <button
              onClick={toggleOpen}
              disabled={busy}
              role="switch"
              aria-checked={event.isOpen}
              aria-label="Signups open"
              className={`relative h-8 w-14 shrink-0 rounded-full transition ${
                event.isOpen ? "bg-emerald-500" : "bg-slate-600"
              } disabled:opacity-50`}
            >
              <span
                className={`absolute top-1 h-6 w-6 rounded-full bg-white transition-all ${
                  event.isOpen ? "left-7" : "left-1"
                }`}
              />
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
            <span className="text-sm text-white/60">
              {event.isOpen ? "Next person joins" : "Next in rotation"}
            </span>
            {nextTeam ? (
              <span className="inline-flex items-center gap-2">
                <span className="text-white/40">→</span>
                <span
                  className="h-3.5 w-3.5 rounded-full"
                  style={{ background: nextTeam.color }}
                  aria-hidden
                />
                <span className="font-bold" style={{ color: nextTeam.color }}>
                  {nextTeam.name?.trim()
                    ? nextTeam.name.trim()
                    : `Team ${nextTeam.teamNumber}`}
                </span>
              </span>
            ) : (
              <span className="font-semibold text-white/60">
                {teams.length === 0 ? "No teams set up yet" : "All teams are full"}
              </span>
            )}
            {!event.isOpen && nextTeam && (
              <span className="text-xs text-white/40">· signups closed</span>
            )}
          </div>
        </Section>

        <Section title="Teams">
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              label="Number of teams"
              value={draft.numTeams}
              min={1}
              max={24}
              onChange={(numTeams) => setDraft((d) => ({ ...d, numTeams }))}
            />
            <NumberField
              label="Max per team"
              value={draft.maxPerTeam}
              min={1}
              max={50}
              onChange={(maxPerTeam) => setDraft((d) => ({ ...d, maxPerTeam }))}
            />
          </div>
          <p className="mt-3 text-xs text-white/40">
            Capacity: {draft.numTeams * draft.maxPerTeam} people. Reducing the team
            count is blocked while the teams being removed still have members.
            Remove them or reset the event first.
          </p>
        </Section>

        <Section title="Team names, colours & logos">
          <p className="mb-4 text-sm text-white/60">
            Give teams their own name, colour and logo to show in the draw and on
            the boards. Leave the name blank to keep the default, so that team
            stays <span className="font-semibold">Team {`{number}`}</span>. You can
            mix both: name some, leave others default. The colour tints the
            reveal background, the boards and the roster — hit{" "}
            <span className="font-semibold">From logo</span> to pull the logo&rsquo;s
            dominant colour automatically, or pick one by hand. The logo is
            optional; paste a direct image link (PNG works
            well), e.g. an ImgBB link, or a Google Drive link that opens the image
            itself, not the share page.
          </p>

          {teams.length === 0 ? (
            <p className="text-sm text-white/45">No teams configured yet.</p>
          ) : (
            <>
              <div className="space-y-3">
                {teams.map((team) => (
                  <div
                    key={team.id}
                    className="rounded-2xl border border-white/10 bg-white/[0.02] p-3"
                  >
                    <div className="flex items-center gap-3">
                      <LogoPreview
                        url={(logoDrafts[team.id] ?? "").trim()}
                        color={colorDrafts[team.id] ?? team.color}
                        fallbackNumber={team.teamNumber}
                      />
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="w-14 shrink-0 text-xs font-semibold text-white/45">
                            Team {team.teamNumber}
                          </span>
                          <input
                            value={nameDrafts[team.id] ?? ""}
                            placeholder={`Team ${team.teamNumber} (default)`}
                            maxLength={60}
                            onChange={(e) =>
                              setNameDrafts((d) => ({ ...d, [team.id]: e.target.value }))
                            }
                            className={fieldClass}
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-14 shrink-0 text-xs font-semibold text-white/45">
                            Logo
                          </span>
                          <input
                            value={logoDrafts[team.id] ?? ""}
                            placeholder="https://… (image URL, optional)"
                            maxLength={2000}
                            inputMode="url"
                            spellCheck={false}
                            onChange={(e) =>
                              setLogoDrafts((d) => ({ ...d, [team.id]: e.target.value }))
                            }
                            className={`${fieldClass} text-sm`}
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-14 shrink-0 text-xs font-semibold text-white/45">
                            Colour
                          </span>
                          <ColorField
                            value={colorDrafts[team.id] ?? team.color}
                            onChange={(color) =>
                              setColorDrafts((d) => ({ ...d, [team.id]: color }))
                            }
                            onPickFromLogo={() => pickColorFromLogo(team.id)}
                            canPickFromLogo={(logoDrafts[team.id] ?? "").trim() !== ""}
                            sampling={samplingTeamId === team.id}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  onClick={saveTeamMeta}
                  disabled={busy || !teamMetaDirty}
                  className="rounded-xl bg-sky-500 px-5 py-3 font-bold transition active:scale-95 disabled:bg-slate-700 disabled:text-white/40"
                >
                  {busy ? "Saving…" : teamMetaDirty ? "Save names, colours & logos" : "Saved"}
                </button>
                {teamMetaDirty && (
                  <button
                    onClick={() => {
                      setNameDrafts(
                        Object.fromEntries(teams.map((t) => [t.id, t.name ?? ""]))
                      );
                      setLogoDrafts(
                        Object.fromEntries(teams.map((t) => [t.id, t.logoUrl ?? ""]))
                      );
                      setColorDrafts(
                        Object.fromEntries(teams.map((t) => [t.id, t.color]))
                      );
                    }}
                    className="text-sm text-white/50 underline-offset-4 hover:underline"
                  >
                    Discard
                  </button>
                )}
              </div>
            </>
          )}
        </Section>

        <Section title="Event details">
          <div className="space-y-4">
            <TextField
              label="Title"
              value={draft.title}
              onChange={(title) => setDraft((d) => ({ ...d, title }))}
            />
            <TextArea
              label="Intro message"
              hint="The first full-screen card in the reveal."
              value={draft.introMessage}
              onChange={(introMessage) => setDraft((d) => ({ ...d, introMessage }))}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Date"
                placeholder="Friday 8 August"
                value={draft.date}
                onChange={(date) => setDraft((d) => ({ ...d, date }))}
              />
              <TextField
                label="Time"
                placeholder="7:00 PM"
                value={draft.time}
                onChange={(time) => setDraft((d) => ({ ...d, time }))}
              />
            </div>
            <TextField
              label="Venue"
              placeholder="Strike Lanes"
              value={draft.venue}
              onChange={(venue) => setDraft((d) => ({ ...d, venue }))}
            />
            <TextArea
              label="Additional notes"
              hint="Leave blank to skip this step in the reveal."
              value={draft.notes}
              onChange={(notes) => setDraft((d) => ({ ...d, notes }))}
            />
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              onClick={() =>
                save({
                  title: draft.title,
                  introMessage: draft.introMessage,
                  date: draft.date,
                  time: draft.time,
                  venue: draft.venue,
                  notes: draft.notes,
                  numTeams: draft.numTeams,
                  maxPerTeam: draft.maxPerTeam,
                  logoUrl: draft.logoUrl ?? "",
                })
              }
              disabled={busy || !dirty}
              className="rounded-xl bg-sky-500 px-5 py-3 font-bold transition active:scale-95 disabled:bg-slate-700 disabled:text-white/40"
            >
              {busy ? "Saving…" : dirty ? "Save changes" : "Saved"}
            </button>
            {dirty && (
              <button
                onClick={() => setDraft(event)}
                className="text-sm text-white/50 underline-offset-4 hover:underline"
              >
                Discard
              </button>
            )}
          </div>
        </Section>

        <Section title="Club logo">
          <div className="flex flex-wrap items-center gap-5">
            {event.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={event.logoUrl}
                alt="Current logo"
                className="h-20 w-20 rounded-2xl border border-white/10 bg-white/5 object-contain p-2"
              />
            ) : (
              <div className="grid h-20 w-20 place-items-center rounded-2xl border border-dashed border-white/15 text-xs text-white/40">
                None
              </div>
            )}
            <div className="flex-1 space-y-3">
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadLogo(file);
                }}
                disabled={busy}
                className="block w-full text-sm text-white/70 file:mr-3 file:rounded-xl file:border-0 file:bg-white/10 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
              />
              <TextField
                label="…or paste an image URL"
                placeholder="https://…"
                value={draft.logoUrl ?? ""}
                onChange={(logoUrl) => setDraft((d) => ({ ...d, logoUrl }))}
              />
              {event.logoUrl && (
                <button
                  onClick={() => save({ logoUrl: "" })}
                  disabled={busy}
                  className="text-sm text-rose-300 underline-offset-4 hover:underline"
                >
                  Remove logo
                </button>
              )}
            </div>
          </div>
        </Section>

        <Section title="Guest list">
          <p className="mb-4 text-sm text-white/60">
            People join by entering their email, which is matched against this
            list to get their name. An address that is not here cannot join, and
            each one can be used only once.
          </p>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-white/70">
              Add people
            </span>
            <textarea
              value={guestPaste}
              onChange={(e) => setGuestPaste(e.target.value)}
              rows={5}
              spellCheck={false}
              className={`${fieldClass} resize-y font-mono text-sm`}
            />
            <span className="mt-1 block text-xs text-white/40">
              One per line as <code>email, name</code>. Tabs and semicolons work
              too, so you can paste two columns straight from a spreadsheet. A
              bare email gets a name guessed from the address. Re-pasting an
              existing address just corrects the name.
            </span>
          </label>

          <button
            onClick={addGuests}
            disabled={busy || !guestPaste.trim()}
            className="mt-3 rounded-xl bg-sky-500 px-5 py-3 font-bold transition active:scale-95 disabled:bg-slate-700 disabled:text-white/40"
          >
            {busy ? "Adding…" : "Add to guest list"}
          </button>

          {guestErrors.length > 0 && (
            <ul className="mt-4 space-y-1 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-200">
              {guestErrors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}

          <div className="mt-6">
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-white/40">
              {invitees.length} invited · {joinedCount} joined
            </p>
            {invitees.length === 0 ? (
              <p className="text-sm text-white/35">
                Nobody invited yet. Until you add someone, no one can join.
              </p>
            ) : (
              <ul className="divide-y divide-white/5">
                {invitees.map((invitee) => (
                  <li
                    key={invitee.id}
                    className="flex items-center justify-between gap-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{invitee.name}</p>
                      <p className="truncate text-xs text-white/45">{invitee.email}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ${
                          invitee.memberId
                            ? "bg-emerald-400/15 text-emerald-200"
                            : "bg-white/5 text-white/40"
                        }`}
                      >
                        {invitee.memberId ? `Team ${invitee.teamNumber}` : "Not yet"}
                      </span>
                      <button
                        onClick={() => removeGuest(invitee)}
                        disabled={busy}
                        className="rounded-lg px-3 py-1 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/10 active:scale-95 disabled:opacity-40"
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Section>

        {isOwner && (
          <Section title="Finalise mode">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-semibold">
                  {held ? "On · participants are holding" : "Off · live"}
                </p>
                <p className="text-sm text-white/50">
                  {held
                    ? "Everyone sees a “finalising teams…” screen. Arrange people below, then publish."
                    : "Turn on to freeze what participants see while you arrange teams, then publish to reveal the final rosters at once."}
                </p>
              </div>
              <button
                onClick={toggleHold}
                disabled={busy}
                role="switch"
                aria-checked={held}
                aria-label="Finalise mode"
                className={`relative h-8 w-14 shrink-0 rounded-full transition ${
                  held ? "bg-amber-500" : "bg-slate-600"
                } disabled:opacity-50`}
              >
                <span
                  className={`absolute top-1 h-6 w-6 rounded-full bg-white transition-all ${
                    held ? "left-7" : "left-1"
                  }`}
                />
              </button>
            </div>
          </Section>
        )}

        <Section title="Roster">
          {teams.length === 0 ? (
            <p className="text-sm text-white/45">No teams configured yet.</p>
          ) : (
            <div className="space-y-4">
              {teams.map((team) => (
                <div
                  key={team.id}
                  className="rounded-2xl border p-4"
                  style={{
                    borderColor: rgbaFromHex(team.color, 0.4),
                    background: rgbaFromHex(team.color, 0.08),
                  }}
                >
                  <div className="mb-3 flex items-baseline justify-between gap-2">
                    <h3 className="font-bold" style={{ color: team.color }}>
                      {team.name?.trim() ? team.name.trim() : `Team ${team.teamNumber}`}
                    </h3>
                    <div className="flex shrink-0 items-center gap-2">
                      {nextTeam?.id === team.id && (
                        <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-200">
                          Next up
                        </span>
                      )}
                      <span className="text-xs text-white/45">
                        {team.members.length}/{event.maxPerTeam}
                      </span>
                    </div>
                  </div>
                  {team.members.length === 0 ? (
                    <p className="text-sm text-white/35">Empty</p>
                  ) : (
                    <ul className="divide-y divide-white/5">
                      {team.members.map((member) => (
                        <li
                          key={member.id}
                          className="flex items-center justify-between gap-3 py-2"
                        >
                          <span className="min-w-0 truncate">
                            <span className="block truncate text-sm font-medium">
                              {member.name}
                            </span>
                            {member.email && (
                              <span className="block truncate text-xs text-white/40">
                                {member.email}
                              </span>
                            )}
                          </span>
                          <div className="flex shrink-0 items-center gap-2">
                            {isOwner && teams.length > 1 && (
                              <select
                                value={team.id}
                                onChange={(e) => moveMember(member.id, e.target.value)}
                                disabled={busy}
                                aria-label={`Move ${member.name} to another team`}
                                className="rounded-lg border border-white/15 bg-slate-800 px-2 py-1 text-xs font-semibold text-white/80 outline-none transition focus:border-sky-400/60 disabled:opacity-40"
                              >
                                {teams.map((t) => (
                                  <option key={t.id} value={t.id}>
                                    {t.name?.trim() ? t.name.trim() : `Team ${t.teamNumber}`}
                                  </option>
                                ))}
                              </select>
                            )}
                            <button
                              onClick={() => removeMember(member.id, member.name)}
                              disabled={busy}
                              className="rounded-lg px-3 py-1 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/10 active:scale-95 disabled:opacity-40"
                            >
                              Remove
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Danger zone" tone="danger">
          <p className="mb-4 text-sm text-white/60">
            Clears every member and rebuilds the teams, restarting the draw from
            team 1. Event details, sizes and logo are kept.
          </p>
          <button
            onClick={resetEvent}
            disabled={busy}
            className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-5 py-3 font-bold text-rose-200 transition active:scale-95 disabled:opacity-50"
          >
            Reset event
          </button>
        </Section>
      </div>
    </main>
  );
}

/**
 * Live thumbnail for a team's logo URL as the organiser types it. Falls back to
 * the team number on an empty or broken link, so a bad or non-direct URL (a
 * Google Drive share page, say) is obvious immediately rather than saved blind.
 */
function LogoPreview({
  url,
  color,
  fallbackNumber,
}: {
  url: string;
  color: string;
  fallbackNumber: number;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  const show = url !== "" && !failed;

  return (
    <div
      className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl border"
      style={{
        borderColor: rgbaFromHex(color, 0.4),
        background: rgbaFromHex(color, 0.12),
      }}
    >
      {show ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          onError={() => setFailed(true)}
          className="h-full w-full object-contain p-1"
        />
      ) : (
        <span className="text-base font-black" style={{ color }}>
          {fallbackNumber}
        </span>
      )}
    </div>
  );
}

/**
 * A team colour picker with three ways in: a "From logo" button that pulls the
 * logo's dominant colour, a native swatch for point-and-click, and a hex field
 * for pasting an exact brand colour. The auto option is the quick default; the
 * swatch and field stay available for picking or fine-tuning by hand. The swatch
 * only understands `#rrggbb`, so the text field is the escape hatch for
 * shorthand or uppercase input, normalised on save.
 */
function ColorField({
  value,
  onChange,
  onPickFromLogo,
  canPickFromLogo,
  sampling,
}: {
  value: string;
  onChange: (value: string) => void;
  onPickFromLogo: () => void;
  canPickFromLogo: boolean;
  sampling: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <input
        type="color"
        value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000"}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Team colour"
        className="h-9 w-9 shrink-0 cursor-pointer rounded-lg border border-white/15 bg-transparent p-0.5"
      />
      <input
        value={value}
        placeholder="#rrggbb"
        maxLength={7}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        className={`${fieldClass} w-24 flex-1 font-mono text-sm uppercase`}
      />
      <button
        type="button"
        onClick={onPickFromLogo}
        disabled={sampling || !canPickFromLogo}
        title={
          canPickFromLogo
            ? "Use the logo's dominant colour"
            : "Add a logo URL to pull its colour"
        }
        className="shrink-0 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 transition active:scale-95 disabled:opacity-40"
      >
        {sampling ? "Reading…" : "From logo"}
      </button>
    </div>
  );
}

function Section({
  title,
  children,
  tone = "default",
}: {
  title: string;
  children: React.ReactNode;
  tone?: "default" | "danger";
}) {
  return (
    <section
      className={`rounded-3xl border p-5 ${
        tone === "danger"
          ? "border-rose-400/25 bg-rose-500/5"
          : "border-white/10 bg-white/[0.03]"
      }`}
    >
      <h2 className="mb-4 text-xs font-bold uppercase tracking-[0.25em] text-white/40">
        {title}
      </h2>
      {children}
    </section>
  );
}

const fieldClass =
  "w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-white outline-none transition focus:border-sky-400/60 focus:shadow-[0_0_0_3px_rgba(56,189,248,0.15)]";

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-white/70">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={fieldClass}
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-white/70">{label}</span>
      <textarea
        value={value}
        rows={3}
        onChange={(e) => onChange(e.target.value)}
        className={`${fieldClass} resize-y`}
      />
      {hint && <span className="mt-1 block text-xs text-white/40">{hint}</span>}
    </label>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-white/70">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const next = Number.parseInt(e.target.value, 10);
          if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
        }}
        className={fieldClass}
      />
    </label>
  );
}
