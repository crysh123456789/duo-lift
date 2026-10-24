"use client";

import Link from "next/link";

const TABS = [
  { id: "registro", label: "Registro", href: "/history" },
  { id: "cargas", label: "Cargas", href: "/loads" },
] as const;

export function RecordTabs({ current }: { current: (typeof TABS)[number]["id"] }) {
  return (
    <div className="flex gap-1 rounded-full border border-line bg-surface p-1">
      {TABS.map((tab) => {
        const on = tab.id === current;
        return (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={on ? "page" : undefined}
            className={`grid h-9 flex-1 place-items-center rounded-full text-sm ${
              on ? "bg-surface-2 text-foreground" : "text-muted"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
