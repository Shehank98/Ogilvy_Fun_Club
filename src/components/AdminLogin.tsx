"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function AdminLogin({
  configured,
  heading = "Organiser access",
  subheading = "Enter the shared PIN to manage the event.",
}: {
  configured: boolean;
  heading?: string;
  subheading?: string;
}) {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload?.error ?? "Incorrect PIN.");
        setBusy(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't reach the server.");
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-2 text-center text-2xl font-bold">{heading}</h1>
        <p className="mb-8 text-center text-sm text-white/50">{subheading}</p>

        {configured ? (
          <form onSubmit={submit} className="space-y-4">
            <input
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="PIN"
              aria-label="Admin PIN"
              autoComplete="current-password"
              className="w-full rounded-2xl border border-white/15 bg-white/5 px-5 py-4 text-lg outline-none transition focus:border-sky-400/60 focus:shadow-[0_0_0_4px_rgba(56,189,248,0.18)]"
            />
            <button
              type="submit"
              disabled={busy || pin.length === 0}
              className="w-full rounded-2xl bg-sky-500 px-5 py-4 font-bold text-white transition active:scale-95 disabled:bg-slate-700"
            >
              {busy ? "Checking…" : "Unlock"}
            </button>
            {error && (
              <p role="alert" className="text-center text-sm text-rose-300">
                {error}
              </p>
            )}
          </form>
        ) : (
          <p className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-200">
            Admin access is not configured. Set the <code>ADMIN_PIN</code>{" "}
            environment variable and redeploy.
          </p>
        )}
      </div>
    </main>
  );
}
