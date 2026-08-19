"use client";

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));

export function TimeField({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const [h = "08", m = "00"] = value.split(":");
  const minute = MINUTES.includes(m) ? m : MINUTES.reduce((best, cur) =>
    Math.abs(Number(cur) - Number(m)) < Math.abs(Number(best) - Number(m)) ? cur : best,
  );

  return (
    <div className="flex h-10 overflow-hidden rounded-xl border border-line bg-surface-2 font-mono text-sm">
      <select
        aria-label="Hora"
        value={h}
        onChange={(e) => onChange(`${e.target.value}:${minute}`)}
        className="h-full w-[3.25rem] appearance-none bg-transparent px-1 text-center text-foreground outline-none"
      >
        {HOURS.map((hour) => (
          <option key={hour} value={hour}>
            {hour}
          </option>
        ))}
      </select>
      <span className="grid place-items-center text-muted">:</span>
      <select
        aria-label="Minutos"
        value={minute}
        onChange={(e) => onChange(`${h}:${e.target.value}`)}
        className="h-full w-[3.25rem] appearance-none bg-transparent px-1 text-center text-foreground outline-none"
      >
        {MINUTES.map((min) => (
          <option key={min} value={min}>
            {min}
          </option>
        ))}
      </select>
    </div>
  );
}
