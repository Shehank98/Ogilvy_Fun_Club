"use client";

import { useEffect, useState } from "react";
import { isSoundEnabled, setSoundEnabled } from "@/lib/sound";

export default function SoundToggle({ className = "" }: { className?: string }) {
  // Always render muted on the server; localStorage is read after mount so the
  // markup matches and hydration stays quiet.
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(isSoundEnabled());
  }, []);

  function toggle() {
    const next = !enabled;
    setEnabled(next);
    setSoundEnabled(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={enabled}
      aria-label={enabled ? "Mute sound" : "Unmute sound"}
      className={`rounded-full border border-white/15 bg-white/5 p-2.5 text-slate-200 backdrop-blur transition active:scale-90 ${className}`}
    >
      <span aria-hidden className="block text-base leading-none">
        {enabled ? "🔊" : "🔇"}
      </span>
    </button>
  );
}
