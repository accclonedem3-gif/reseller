import type { PropsWithChildren } from "react";

import { InfoHint } from "@/components/ui/info-hint";

export function Field({
  label,
  hint,
  description,
  hintPlacement = "bottom",
  children,
}: PropsWithChildren<{
  label: string;
  hint?: string;
  description?: string;
  hintPlacement?: "top" | "bottom";
}>) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold" style={{ color: "var(--tx)" }}>{label}</span>
          <InfoHint
            content={description}
            className="shrink-0"
            panelClassName="max-w-sm"
            label={`Xem ghi chú cho ${label}`}
            placement={hintPlacement}
          />
        </div>
        {hint ? <span className="app-kicker">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}
