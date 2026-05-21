import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { CircleHelp } from "lucide-react";

import { cn } from "@/lib/cn";

export function InfoHint({
  content,
  className,
  panelClassName,
  label = "Xem ghi chú",
  placement = "bottom",
}: {
  content?: ReactNode;
  className?: string;
  panelClassName?: string;
  label?: string;
  placement?: "top" | "bottom";
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  if (!content) {
    return null;
  }

  const isTop = placement === "top";

  return (
    <div ref={rootRef} className={cn("relative inline-flex items-center", className)}>
      <button
        type="button"
        aria-label={open ? "An ghi chu" : label}
        title={open ? "An ghi chu" : label}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "inline-flex h-5.5 w-5.5 items-center justify-center rounded-full border transition-colors duration-200",
          "border-gray-300 bg-gray-100 text-gray-500 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-400",
          "hover:border-emerald-500/40 hover:bg-emerald-400/12 hover:text-emerald-600 dark:hover:border-emerald-300/35 dark:hover:text-emerald-100",
          open && "border-emerald-500/40 bg-emerald-400/12 text-emerald-600 dark:border-emerald-300/35 dark:text-emerald-100",
        )}
      >
        <CircleHelp className="h-3.5 w-3.5" />
      </button>

      <div
        className={cn(
          "absolute left-0 z-50 w-[min(22rem,calc(100vw-3rem))] transition-[opacity,transform] duration-200 ease-out",
          isTop
            ? "bottom-full mb-2 origin-bottom-left"
            : "top-full mt-2 origin-top-left",
          open
            ? "pointer-events-auto opacity-100 translate-y-0"
            : isTop
              ? "pointer-events-none opacity-0 translate-y-1"
              : "pointer-events-none opacity-0 translate-y-1",
        )}
      >
        <div
          className={cn(
            "rounded-[14px] border px-3 py-2.5 text-sm leading-6 shadow-[0_20px_50px_rgba(2,6,23,0.25)] backdrop-blur-xl",
            panelClassName,
          )}
          style={{ backgroundColor: "var(--surface)", borderColor: "var(--bd)", color: "var(--tx-m)" }}
        >
          {content}
        </div>
      </div>
    </div>
  );
}
