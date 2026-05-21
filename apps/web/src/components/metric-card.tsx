import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

const TONE: Record<string, { icon: string; bg: string }> = {
  sky:     { icon: "text-sky-400",     bg: "bg-sky-500/15" },
  amber:   { icon: "text-amber-400",   bg: "bg-amber-500/15" },
  emerald: { icon: "text-emerald-400", bg: "bg-emerald-500/15" },
  violet:  { icon: "text-violet-400",  bg: "bg-violet-500/15" },
  rose:    { icon: "text-rose-400",    bg: "bg-rose-500/15" },
  orange:  { icon: "text-orange-400",  bg: "bg-orange-500/15" },
};

export function MetricCard({
  label,
  value,
  description,
  icon: Icon,
  tone = "sky",
  className,
}: {
  label: string;
  value: string;
  description?: string;
  icon?: LucideIcon;
  tone?: keyof typeof TONE;
  className?: string;
}) {
  const t = TONE[tone] ?? TONE["sky"]!;
  return (
    <div
      className={cn("flex items-center gap-3 rounded-[16px] border border-white/8 px-4 py-3", className)}
      style={{ backgroundColor: "var(--inp)" }}
      title={description}
    >
      {Icon && (
        <div className={cn("flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px]", t.bg)}>
          <Icon className={cn("h-4 w-4", t.icon)} />
        </div>
      )}
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] truncate" style={{ color: "var(--tx-f)" }}>{label}</p>
        <p className="text-lg font-bold leading-tight truncate" style={{ color: "var(--tx)" }}>{value}</p>
      </div>
    </div>
  );
}
