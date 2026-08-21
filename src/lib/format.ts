import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { todayStamp } from "./nutrition";

export function relativeTime(iso: string): string {
  return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: es });
}

export function dayLabel(iso: string): string {
  return format(new Date(iso), "EEE d MMM", { locale: es });
}

export function dayFull(iso: string): string {
  return format(new Date(iso), "EEEE d 'de' MMMM", { locale: es });
}

export function whenLabel(iso: string): string {
  const stamp = todayStamp(new Date(iso));
  const today = todayStamp();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const day = format(new Date(iso), "d MMM", { locale: es });
  if (stamp === today) return `Hoy · ${day}`;
  if (stamp === todayStamp(yesterday)) return `Ayer · ${day}`;
  return dayLabel(iso);
}
