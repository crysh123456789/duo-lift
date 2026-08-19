import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

export function relativeTime(iso: string): string {
  return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: es });
}

export function dayLabel(iso: string): string {
  return format(new Date(iso), "EEE d MMM", { locale: es });
}

export function dayFull(iso: string): string {
  return format(new Date(iso), "EEEE d 'de' MMMM", { locale: es });
}
