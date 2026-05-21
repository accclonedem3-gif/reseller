import type { TextareaHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        "min-h-[120px] w-full rounded-2xl px-4 py-3.5 text-sm font-medium outline-none transition duration-300 focus:shadow-[0_0_0_3px_rgba(249,115,22,0.12)] disabled:cursor-not-allowed disabled:opacity-60",
        props.className,
      )}
      style={{
        backgroundColor: "var(--inp)",
        border: "1px solid var(--bd)",
        color: "var(--tx)",
        ...(props as any).style,
      }}
    />
  );
}
