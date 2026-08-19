"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChartNoAxesColumn,
  Dumbbell,
  History,
  House,
  UserRound,
} from "lucide-react";
import { useGymStore } from "@/lib/store";
import { ReminderWatcher } from "./reminder-watcher";
import { Avatar } from "./ui";

const NAV = [
  { href: "/", label: "Inicio", icon: House },
  { href: "/workout/new", label: "Entrenar", icon: Dumbbell },
  { href: "/history", label: "Historial", icon: History },
  { href: "/stats", label: "Progreso", icon: ChartNoAxesColumn },
  { href: "/profile", label: "Perfil", icon: UserRound },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const users = useGymStore((s) => s.users);
  const activeUserId = useGymStore((s) => s.activeUserId);
  const switchUser = useGymStore((s) => s.switchUser);
  const active = users.find((u) => u.id === activeUserId) ?? users[0];

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-line bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 md:pl-56">
          <p className="font-mono text-[11px] tracking-[0.28em] text-accent uppercase">Duo Lift</p>
          <div className="flex items-center gap-1 rounded-full border border-line bg-surface p-1">
            {users.map((user) => {
              const on = user.id === activeUserId;
              return (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => switchUser(user.id)}
                  className={`flex items-center gap-2 rounded-full px-2 py-1 text-xs transition-colors ${
                    on ? "bg-surface-2 text-foreground" : "text-muted"
                  }`}
                >
                  <Avatar name={user.displayName} hue={user.avatarHue} size={22} />
                  <span className="hidden sm:inline">{user.displayName}</span>
                </button>
              );
            })}
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
            const isTrain = item.href === "/workout/new";
            return (
              <li key={item.href} className="flex-1 md:flex-none">
                <Link
                  href={item.href}
                  className={`flex h-full flex-col items-center justify-center gap-1 text-[11px] md:h-11 md:flex-row md:justify-start md:rounded-xl md:px-3 md:text-sm ${
                    isTrain && !on
                      ? "text-accent"
                      : on
                        ? "text-accent md:bg-surface-2"
                        : "text-muted"
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

      <main className="mx-auto w-full max-w-5xl px-4 pb-24 pt-5 md:pl-56 md:pb-10">
        <p className="mb-4 hidden text-xs text-muted md:block">
          Registrando como <span className="text-foreground">{active?.displayName}</span>
        </p>
        {children}
      </main>
    </div>
  );
}
