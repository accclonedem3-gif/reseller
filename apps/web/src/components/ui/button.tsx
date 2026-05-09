import type { ButtonHTMLAttributes, CSSProperties, PropsWithChildren } from "react";

import { cn } from "@/lib/cn";

export function Button({
  children,
  className,
  type,
  variant = "primary",
  size = "md",
  style,
  ...props
}: PropsWithChildren<
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "secondary" | "ghost" | "danger";
    size?: "sm" | "md" | "lg";
  }
>) {
  const variantStyle: CSSProperties =
    variant === "secondary"
      ? { backgroundColor: "var(--surface)", borderColor: "var(--bd)", color: "var(--tx)" }
      : variant === "ghost"
        ? { color: "var(--tx-m)" }
        : {};

  return (
    <button
      type={type ?? "button"}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-2xl border font-black uppercase tracking-[0.16em] transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] disabled:cursor-not-allowed disabled:opacity-55",
        size === "sm" && "px-4 py-2.5 text-[10px]",
        size === "md" && "px-5 py-3 text-[10px]",
        size === "lg" && "px-6 py-3.5 text-[11px]",
        variant === "primary"   && "border-orange-500/30 bg-orange-500 text-white shadow-lg shadow-orange-500/20 hover:-translate-y-px hover:brightness-110",
        variant === "secondary" && "hover:brightness-95",
        variant === "ghost"     && "border-transparent bg-transparent hover:opacity-70",
        variant === "danger"    && "border-rose-300/20 bg-rose-500/12 text-rose-100 hover:border-rose-200/30 hover:bg-rose-500/18",
        className,
      )}
      style={{ ...variantStyle, ...style }}
      {...props}
    >
      {children}
    </button>
  );
}
