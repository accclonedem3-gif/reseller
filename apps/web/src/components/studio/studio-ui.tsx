import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  PropsWithChildren,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";
import { ArrowUpRight, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/cn";
import { InfoHint } from "@/components/ui/info-hint";

export function StudioCard({
  children,
  className,
}: PropsWithChildren<{ className?: string }>) {
  return (
    <div
      className={cn("rounded-3xl p-5 sm:p-6", className)}
      style={{ backgroundColor: "var(--surface)", border: "1px solid var(--bd)" }}
    >
      {children}
    </div>
  );
}

export function StudioBadge({
  children,
  tone = "neutral",
}: PropsWithChildren<{ tone?: "neutral" | "success" | "warning" | "danger" }>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em]",
        tone === "success" && "border-emerald-400/20 bg-emerald-500/10 text-emerald-300",
        tone === "warning" && "border-amber-400/20 bg-amber-500/10 text-amber-300",
        tone === "danger"  && "border-rose-400/18 bg-rose-500/10 text-rose-300",
        tone === "neutral" && "border-white/8 bg-white/[0.04] text-slate-300",
      )}
    >
      {children}
    </span>
  );
}

export function StudioButton({
  children,
  className,
  variant = "primary",
  size = "md",
  type,
  ...props
}: PropsWithChildren<
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "secondary" | "ghost" | "danger";
    size?: "sm" | "md" | "lg";
  }
>) {
  const secondaryStyle = variant === "secondary"
    ? { backgroundColor: "var(--surface)", borderColor: "var(--bd)", color: "var(--tx)" }
    : undefined;
  const ghostStyle = variant === "ghost"
    ? { color: "var(--tx-m)" }
    : undefined;

  return (
    <button
      type={type ?? "button"}
      className={cn(
        "inline-flex transform-gpu items-center justify-center gap-2 rounded-2xl border font-black uppercase tracking-[0.16em] transition-all duration-300 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/70 focus-visible:ring-offset-2 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-55",
        size === "sm" && "px-4 py-2.5 text-[10px]",
        size === "md" && "px-5 py-3 text-[10px]",
        size === "lg" && "px-6 py-3.5 text-[11px]",
        variant === "primary"   && "border-orange-500/30 bg-orange-500 text-white shadow-lg shadow-orange-500/20 hover:-translate-y-px hover:brightness-110",
        variant === "secondary" && "hover:-translate-y-px hover:border-orange-500/30",
        variant === "ghost"     && "border-transparent bg-transparent hover:opacity-70",
        variant === "danger"    && "border-rose-300/20 bg-rose-500/12 text-rose-500 hover:-translate-y-px hover:border-rose-200/30 hover:bg-rose-500/18",
        className,
      )}
      style={{ ...secondaryStyle, ...ghostStyle, ...(props as any).style }}
      {...props}
    >
      {children}
    </button>
  );
}

export function StudioInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn("w-full rounded-2xl px-4 py-3.5 text-sm font-medium outline-none transition duration-200 focus:shadow-[0_0_0_3px_rgba(249,115,22,0.12)]", props.className)}
      style={{ backgroundColor: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx)", ...(props as any).style }}
    />
  );
}

export function StudioTextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn("min-h-[132px] w-full rounded-2xl px-4 py-3.5 text-sm font-medium outline-none transition duration-200 focus:shadow-[0_0_0_3px_rgba(249,115,22,0.12)]", props.className)}
      style={{ backgroundColor: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx)", ...(props as any).style }}
    />
  );
}

export function StudioSectionIntro({
  kicker,
  title,
  description,
  actions,
  titleClassName,
  descriptionClassName,
}: {
  kicker: string;
  title: string;
  description: string;
  actions?: ReactNode;
  titleClassName?: string;
  descriptionClassName?: string;
}) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-orange-400 mb-1">
          {kicker}
        </p>
        <div className="flex items-start gap-2">
          <h1
            className={cn("text-4xl font-black tracking-tighter uppercase", titleClassName)}
            style={{ color: "var(--tx)" }}
          >
            {title}
          </h1>
          <InfoHint
            content={description}
            className="shrink-0 mt-2"
            panelClassName="max-w-xl"
            label={`Xem ghi chú cho ${title}`}
          />
        </div>
        {descriptionClassName && (
          <p className={cn("text-sm text-slate-400 mt-1 font-medium opacity-70", descriptionClassName)}>
            {description}
          </p>
        )}
      </div>
      {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
    </div>
  );
}

export function StudioMetric({
  label,
  value,
  description,
  icon: Icon = ArrowUpRight,
  tone = "sky",
}: {
  label: string;
  value: string;
  description: string;
  icon?: LucideIcon;
  tone?: "sky" | "amber" | "emerald" | "violet";
}) {
  return (
    <StudioCard className="h-full">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-500">
              {label}
            </p>
            <InfoHint
              content={description}
              className="shrink-0"
              panelClassName="max-w-[260px]"
              label={`Xem ghi chú cho ${label}`}
            />
          </div>
          <p className="text-4xl font-black tracking-tighter" style={{ color: "var(--tx)" }}>
            {value}
          </p>
        </div>
        <div
          className={cn(
            "flex h-11 w-11 items-center justify-center rounded-xl bg-white/[0.04] border border-white/8 shrink-0",
            tone === "sky"     && "text-sky-300",
            tone === "amber"   && "text-amber-300",
            tone === "emerald" && "text-emerald-300",
            tone === "violet"  && "text-violet-300",
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </StudioCard>
  );
}
