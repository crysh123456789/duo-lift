"use client";

import { useEffect, useState } from "react";

export function RestTimer({ seconds = 90 }: { seconds?: number }) {
  const [left, setLeft] = useState(seconds);
  const [running, setRunning] = useState(true);

  useEffect(() => {
    if (!running || left <= 0) return;
    const id = window.setInterval(() => setLeft((n) => n - 1), 1000);
    return () => window.clearInterval(id);
  }, [running, left]);

  const m = Math.floor(left / 60);
  const s = left % 60;

  return (
    <div className="flex items-center justify-between rounded-xl border border-line bg-surface-2 px-3 py-2">
      <div>
        <p className="text-[11px] uppercase tracking-wider text-muted">Descanso</p>
        <p className="font-mono text-xl tabular-nums">
          {m}:{String(s).padStart(2, "0")}
        </p>
      </div>
      <button
        type="button"
        onClick={() => {
          if (left <= 0) {
            setLeft(seconds);
            setRunning(true);
          } else setRunning((v) => !v);
        }}
        className="text-xs text-accent"
      >
        {left <= 0 ? "Otra vez" : running ? "Pausa" : "Seguir"}
      </button>
    </div>
  );
}
