import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/cn";
import { InfoHint } from "@/components/ui/info-hint";
import { Breadcrumb, type BreadcrumbItem } from "@/components/ui/breadcrumb";

export type HeroStat = {
  icon: LucideIcon;
  label: string;
  value: string | number;
  iconCls?: string;
  bgCls?: string;
};

const GRADIENT_MAP: Record<string, string> = {
  orange:  "rgba(249,115,22,0.10)",
  emerald: "rgba(16,185,129,0.10)",
  violet:  "rgba(139,92,246,0.10)",
  sky:     "rgba(14,165,233,0.10)",
  amber:   "rgba(245,158,11,0.10)",
  rose:    "rgba(244,63,94,0.10)",
};

const ORBS: Record<string, string> = {
  orange:  "rgba(249,115,22,0.20)",
  emerald: "rgba(16,185,129,0.20)",
  violet:  "rgba(139,92,246,0.20)",
  sky:     "rgba(14,165,233,0.20)",
  amber:   "rgba(245,158,11,0.20)",
  rose:    "rgba(244,63,94,0.20)",
};

export function SectionHeading({
  eyebrow,
  title,
  description,
  actions,
  breadcrumb,
  className,
  stats,
  gradient,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  breadcrumb?: BreadcrumbItem[];
  className?: string;
  stats?: HeroStat[];
  gradient?: keyof typeof GRADIENT_MAP;
}) {
  const hasCard = stats && stats.length > 0;
  const gradientColor = gradient ? GRADIENT_MAP[gradient] : undefined;
  const orbColor = gradient ? ORBS[gradient] : undefined;

  if (!hasCard && !gradientColor) {
    return (
      <div className={cn("flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between", className)}>
        <div>
          {breadcrumb && breadcrumb.length > 0 ? (
            <Breadcrumb items={breadcrumb} className="text-[9px] font-black uppercase tracking-[0.28em] mb-1.5" />
          ) : (
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-orange-400 mb-1">{eyebrow}</p>
          )}
          <div className="flex items-start gap-2">
            <h1 className="text-4xl font-black tracking-tighter uppercase" style={{ color: "var(--tx)" }}>{title}</h1>
            {description && <InfoHint content={description} className="shrink-0 mt-2" panelClassName="max-w-xl" label={`Xem ghi chú cho ${title}`} />}
          </div>
        </div>
        {actions && <div className="flex flex-wrap gap-3">{actions}</div>}
      </div>
    );
  }

  return (
    <div
      className={cn("relative overflow-hidden rounded-[22px] border border-white/8 p-5 sm:p-6", className)}
      style={{
        backgroundColor: "var(--surface)",
        background: gradientColor
          ? `linear-gradient(135deg, ${gradientColor} 0%, transparent 60%), var(--surface)`
          : undefined,
      }}
    >
      {orbColor && (
        <div
          className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full blur-3xl opacity-40"
          style={{ backgroundColor: orbColor }}
        />
      )}

      <div className="relative flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {breadcrumb && breadcrumb.length > 0 ? (
            <Breadcrumb items={breadcrumb} className="text-[9px] font-black uppercase tracking-[0.28em] mb-1.5" />
          ) : (
            <p
              className="mb-1 text-[10px] font-black uppercase tracking-[0.3em]"
              style={{ color: gradient ? `var(--accent-${gradient}, #fb923c)` : "rgb(251,146,60)" }}
            >
              {eyebrow}
            </p>
          )}
          <div className="flex items-start gap-2">
            <h1 className="text-2xl font-black tracking-tight uppercase sm:text-3xl" style={{ color: "var(--tx)" }}>
              {title}
            </h1>
            {description && (
              <InfoHint content={description} className="shrink-0 mt-1" panelClassName="max-w-xl" label={`Xem ghi chú cho ${title}`} />
            )}
          </div>
        </div>
        {actions && <div className="flex flex-shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>

      {stats && stats.length > 0 && (
        <div className="relative mt-4 flex flex-wrap gap-3 border-t border-white/8 pt-4">
          {stats.map((stat) => (
            <HeroStatChip key={stat.label} stat={stat} />
          ))}
        </div>
      )}
    </div>
  );
}

function HeroStatChip({ stat }: { stat: HeroStat }) {
  const Icon = stat.icon;
  return (
    <div
      className="flex items-center gap-2.5 rounded-[13px] border border-white/8 px-3.5 py-2.5"
      style={{ backgroundColor: "var(--inp)" }}
    >
      <div className={cn("flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[9px]", stat.bgCls || "bg-white/8")}>
        <Icon className={cn("h-3.5 w-3.5", stat.iconCls || "text-slate-300")} />
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--tx-f)" }}>{stat.label}</p>
        <p className="text-base font-bold leading-tight" style={{ color: "var(--tx)" }}>{stat.value}</p>
      </div>
    </div>
  );
}
