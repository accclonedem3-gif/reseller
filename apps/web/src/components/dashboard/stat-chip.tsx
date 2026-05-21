import type { LucideIcon } from "lucide-react";

const TONE_ICON: Record<"neutral" | "sky" | "amber" | "emerald", string> = {
  neutral: "text-orange-400",
  sky:     "text-sky-500",
  amber:   "text-amber-500",
  emerald: "text-emerald-500",
};

export function StatChip({
  icon: Icon,
  label,
  value,
  meta,
  tone = "neutral",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  meta?: string;
  tone?: "neutral" | "sky" | "amber" | "emerald";
}) {
  return (
    <div
      className="rounded-[20px] p-4"
      style={{ backgroundColor: "var(--inp)", border: "1px solid var(--bd)" }}
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-[14px] ${TONE_ICON[tone]}`}
          style={{ backgroundColor: "var(--surface)", border: "1px solid var(--bd)" }}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p
            className="text-[11px] font-semibold uppercase tracking-[0.24em]"
            style={{ color: "var(--tx-f)" }}
          >
            {label}
          </p>
          <p className="mt-2 text-lg font-semibold" style={{ color: "var(--tx)" }}>
            {value}
          </p>
          {meta ? (
            <p className="mt-1 text-sm leading-6" style={{ color: "var(--tx-m)" }}>
              {meta}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
