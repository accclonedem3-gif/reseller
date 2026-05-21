import type { PropsWithChildren } from "react";

import { cn } from "@/lib/cn";

export function Card({
  children,
  className,
}: PropsWithChildren<{ className?: string }>) {
  return (
    <div
      className={cn("rounded-3xl p-5", className)}
      style={{ backgroundColor: "var(--surface)", border: "1px solid var(--bd)" }}
    >
      {children}
    </div>
  );
}
