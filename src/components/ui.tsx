import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

export function Avatar({
  name,
  hue,
  size = 36,
}: {
  name: string;
  hue: number;
  size?: number;
}) {
  return (
    <span
      className="inline-grid shrink-0 place-items-center rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        background: `hsl(${hue} 62% 48%)`,
        color: "#0c0d0a",
        fontSize: size * 0.42,
      }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function Button({
  variant = "secondary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  const styles = {
    primary: "bg-accent text-accent-ink hover:bg-accent/90",
    secondary: "bg-surface-2 text-foreground border border-line hover:border-muted",
    ghost: "text-muted hover:text-foreground hover:bg-surface-2",
    danger: "text-danger hover:bg-danger/10",
  }[variant];
  return (
    <button
      type="button"
      className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition-colors disabled:opacity-40 ${styles} ${className}`}
      {...props}
    />
  );
}

export function NumberField({
  label,
  value,
  onChange,
  className = "",
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="mb-1 block text-[11px] uppercase tracking-wider text-muted">{label}</span>
      <input
        inputMode="decimal"
        value={value ?? ""}
        onChange={(e) => {
          const raw = e.target.value.replace(",", ".");
          if (raw === "") {
            onChange(null);
            return;
          }
          const n = Number(raw);
          if (!Number.isNaN(n)) onChange(n);
        }}
        className="h-12 w-full rounded-xl border border-line bg-surface-2 px-3 font-mono text-lg tabular-nums outline-none focus:border-accent"
        {...props}
      />
    </label>
  );
}

export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-line bg-surface ${className}`}>{children}</div>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-wider text-muted">{label}</span>
      {children}
    </label>
  );
}
