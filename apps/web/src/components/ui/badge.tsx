import type { PropsWithChildren } from "react";

import { cn } from "@/lib/cn";

export function Badge({
  children,
  tone = "neutral",
}: PropsWithChildren<{ tone?: "neutral" | "success" | "danger" | "warning" }>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em]",
        tone === "success" && "border-emerald-400/20 bg-emerald-500/10 text-emerald-300",
        tone === "danger"  && "border-rose-400/20 bg-rose-500/10 text-rose-300",
        tone === "warning" && "border-amber-400/20 bg-amber-500/10 text-amber-300",
        tone === "neutral" && "border-white/8 bg-white/[0.04] text-slate-300",
      )}
    >
      {children}
    </span>
  );
}
