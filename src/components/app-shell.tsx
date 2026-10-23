"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChartNoAxesColumn,
  Dumbbell,
  History,
  House,
  UserRound,
  Utensils,
} from "lucide-react";
import { personInitial, personName } from "@/lib/people";
import { useGymStore } from "@/lib/store";
import { ReminderWatcher } from "./reminder-watcher";
import { SyncStatus } from "./sync-status";
import { Avatar } from "./ui";

const NAV = [
  { href: "/", label: "Inicio", icon: House },
  { href: "/workout/new", label: "Entrenar", icon: Dumbbell },
  { href: "/nutrition", label: "Diario", icon: Utensils },
  { href: "/history", label: "Historial", icon: History },
  { href: "/stats", label: "Progreso", icon: ChartNoAxesColumn },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const users = useGymStore((s) => s.users);
  const activeUserId = useGymStore((s) => s.activeUserId);
  const switchUser = useGymStore((s) => s.switchUser);

  if (pathname === "/login") return <>{children}</>;

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-line bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 md:pl-56">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-md border border-accent/40 font-mono text-[10px] text-accent">
                {users.map((u) => personInitial(u)).join("") || "DL"}
              </span>
              <p className="font-mono text-[11px] tracking-[0.28em] text-accent uppercase">Duo Lift</p>
            </Link>
            <SyncStatus />
          </div>
          <div className="flex items-center gap-1 rounded-full border border-line bg-surface p-1">
            {users.map((user, i) => {
              const on = user.id === activeUserId;
              const name = personName(user);
              return (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => switchUser(user.id)}
                  className={`flex items-center gap-2 rounded-full px-2 py-1 text-xs transition-colors ${
                    on ? "bg-surface-2 text-foreground" : "text-muted"
                  }`}
                >
                  <Avatar name={name || "?"} hue={user.avatarHue} size={22} />
                  <span className="hidden sm:inline" style={{ color: on ? (i === 0 ? "var(--me)" : "var(--them)") : undefined }}>
                    {name || "Nombre"}
                  </span>
                </button>
              );
            })}
            <Link
              href="/profile"
              className="ml-0.5 grid h-8 w-8 place-items-center rounded-full text-muted hover:text-foreground"
              aria-label="Perfil"
            >
              <UserRound size={16} />
            </Link>
          </div>
        </div>
      </header>

      <ReminderWatcher />
      <nav className="fixed bottom-0 left-0 z-30 w-full border-t border-line bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:top-0 md:h-dvh md:w-52 md:border-r md:border-t-0 md:pt-16">
        <ul className="flex h-16 items-stretch md:h-auto md:flex-col md:gap-1 md:p-3">
          {NAV.map((item) => {
            const Icon = item.icon;
            const on =
              item.href === "/"
                ? pathname === "/"
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <li key={item.href} className="flex-1 md:flex-none">
                <Link
                  href={item.href}
                  className={`flex h-full flex-col items-center justify-center gap-1 text-[11px] md:h-11 md:flex-row md:justify-start md:rounded-xl md:px-3 md:text-sm ${
                    on ? "text-accent md:bg-surface-2" : "text-muted"
                  }`}
                >
                  <Icon size={20} strokeWidth={on ? 2.4 : 1.8} />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <main className="mx-auto w-full max-w-5xl px-4 pb-24 pt-5 md:pl-56 md:pb-10">{children}</main>
    </div>
  );
}