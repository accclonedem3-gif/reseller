import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export function CardHeader({
  icon: Icon,
  title,
  right,
  iconCls = "text-slate-400",
  iconBg,
}: {
  icon?: LucideIcon;
  title: string;
  right?: ReactNode;
  iconCls?: string;
  iconBg?: string;
}) {
  return (
    <div
      className="flex items-center justify-between gap-3 pb-4 mb-5"
      style={{ borderBottom: "1px solid var(--bd)" }}
    >
      <div className="flex items-center gap-2.5">
        {Icon && (
          <div
            className={cn(
              "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[9px]",
              iconBg ?? "bg-white/[0.06]",
            )}
            style={!iconBg ? { background: "var(--inp)", border: "1px solid var(--bd)" } : undefined}
          >
            <Icon className={cn("h-3.5 w-3.5", iconCls)} />
          </div>
        )}
        <h3 className="text-sm font-semibold tracking-tight" style={{ color: "var(--tx)" }}>
          {title}
        </h3>
      </div>
      {right && <div className="flex-shrink-0">{right}</div>}
    </div>
  );
}
