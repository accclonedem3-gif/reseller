import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export type BreadcrumbItem = {
  label: string;
  href?: string;
};

export function Breadcrumb({
  items,
  className,
}: {
  items: BreadcrumbItem[];
  className?: string;
}) {
  return (
    <nav aria-label="breadcrumb" className={cn("flex items-center gap-1.5", className)}>
      {items.map((item, i) => (
        <BreadcrumbSegment key={i} item={item} isLast={i === items.length - 1} />
      ))}
    </nav>
  );
}

function BreadcrumbSegment({
  item,
  isLast,
}: {
  item: BreadcrumbItem;
  isLast: boolean;
}) {
  const textStyle = isLast
    ? { color: "var(--tx)" }
    : { color: "var(--tx-f)" };

  const content: ReactNode = item.href && !isLast ? (
    <a
      href={item.href}
      className="transition-colors hover:text-orange-500"
      style={textStyle}
    >
      {item.label.toUpperCase()}
    </a>
  ) : (
    <span style={textStyle}>{item.label.toUpperCase()}</span>
  );

  return (
    <>
      {content}
      {!isLast && (
        <span
          className="text-[10px] select-none"
          style={{ color: "var(--tx-f)" }}
        >
          /
        </span>
      )}
    </>
  );
}
