"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { PublicEvent, PublicTeam } from "@/lib/event";
import type { PublicInvitee } from "@/lib/invitees";
import { rgbaFromHex } from "@/lib/colors";

type Props = {
  initialEvent: PublicEvent;
  initialTeams: PublicTeam[];
  initialInvitees: PublicInvitee[];
};

type Toast = { tone: "ok" | "error"; text: string } | null;

export default function AdminPanel({
  initialEvent,
  initialTeams,
  initialInvitees,
}: Props) {
  const router = useRouter();
  const [event, setEvent] = useState(initialEvent);
  const [teams, setTeams] = useState(initialTeams);
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialTeams.map((t) => [t.id, t.name ?? ""]))
  );
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
  }

  const namesDirty = teams.some(
    (t) => (nameDrafts[t.id] ?? "").trim() !== (t.name ?? "")
  );

  async function saveTeamNames() {
    setBusy(true);
    try {
      const names = Object.fromEntries(
        teams.map((t) => [t.id, nameDrafts[t.id] ?? ""])
      );
      const response = await fetch("/api/admin/teams", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        announce("error", payload?.error ?? "Could not save team names.");
        return;
      }
      applyTeams(payload.teams);
      announce("ok", "Team names saved.");
    } catch {
      announce("error", "Couldn't reach the server.");
    } finally {
      setBusy(false);
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

  return (
    <main className="min-h-dvh px-5 py-10">
      <div className="mx-auto w-full max-w-3xl space-y-8">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black">Event admin</h1>
            <p className="mt-1 text-sm text-white/50">
              {totalMembers} signed up across {teams.length}{" "}
              {teams.length === 1 ? "team" : "teams"}
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

        <Section title="Team names">
          <p className="mb-4 text-sm text-white/60">
            Give teams their own names to show in the draw and on the boards.
            Leave a box blank to keep the default — that team stays{" "}
            <span className="font-semibold">Team {`{number}`}</span>. You can mix
            both: name some, leave others default.
          </p>

          {teams.length === 0 ? (
            <p className="text-sm text-white/45">No teams configured yet.</p>
          ) : (
            <>
              <div className="space-y-3">
                {teams.map((team) => (
                  <div key={team.id} className="flex items-center gap-3">
                    <span
                      className="h-4 w-4 shrink-0 rounded-full"
                      style={{ background: team.color }}
                      aria-hidden
                    />
                    <span className="w-16 shrink-0 text-xs font-semibold text-white/45">
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
                ))}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  onClick={saveTeamNames}
                  disabled={busy || !namesDirty}
                  className="rounded-xl bg-sky-500 px-5 py-3 font-bold transition active:scale-95 disabled:bg-slate-700 disabled:text-white/40"
                >
                  {busy ? "Saving…" : namesDirty ? "Save team names" : "Saved"}
                </button>
                {namesDirty && (
                  <button
                    onClick={() =>
                      setNameDrafts(
                        Object.fromEntries(teams.map((t) => [t.id, t.name ?? ""]))
                      )
                    }
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
                  <div className="mb-3 flex items-baseline justify-between">
                    <h3 className="font-bold" style={{ color: team.color }}>
                      {team.name?.trim() ? team.name.trim() : `Team ${team.teamNumber}`}
                    </h3>
                    <span className="text-xs text-white/45">
                      {team.members.length}/{event.maxPerTeam}
                    </span>
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
                          <button
                            onClick={() => removeMember(member.id, member.name)}
                            disabled={busy}
                            className="shrink-0 rounded-lg px-3 py-1 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/10 active:scale-95 disabled:opacity-40"
                          >
                            Remove
                          </button>
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
