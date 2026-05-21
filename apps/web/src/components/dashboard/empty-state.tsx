import type { ReactNode } from "react";

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="app-empty rounded-3xl px-6 py-12 text-center">
      <p className="text-2xl font-black tracking-tighter text-white uppercase">{title}</p>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-slate-400 font-medium">{description}</p>
      {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
    </div>
  );
}
