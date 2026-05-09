import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from "lucide-react";

import { cn } from "@/lib/cn";

type ToastTone = "success" | "error" | "warning" | "info";

type ToastInput = {
  tone?: ToastTone;
  title?: string;
  message: ReactNode;
  duration?: number;
};

type ToastItem = Required<Pick<ToastInput, "tone" | "duration">> &
  Pick<ToastInput, "title" | "message"> & {
    id: string;
    leaving: boolean;
  };

type ToastContextValue = {
  showToast: (toast: ToastInput) => string;
  dismissToast: (id: string) => void;
};

const EXIT_MS = 220;
const MAX_TOASTS = 4;
const ToastContext = createContext<ToastContextValue | null>(null);
let toastSeed = 0;

const toneStyles: Record<
  ToastTone,
  {
    icon: typeof CheckCircle2;
    iconStyle: CSSProperties;
    borderStyle: CSSProperties;
    progressCls: string;
  }
> = {
  success: {
    icon: CheckCircle2,
    iconStyle: { background: "rgba(16,185,129,0.12)", color: "rgb(16,185,129)", boxShadow: "0 0 0 1px rgba(16,185,129,0.2)" },
    borderStyle: { borderColor: "rgba(16,185,129,0.25)" },
    progressCls: "bg-emerald-500",
  },
  error: {
    icon: AlertCircle,
    iconStyle: { background: "rgba(244,63,94,0.12)", color: "rgb(244,63,94)", boxShadow: "0 0 0 1px rgba(244,63,94,0.2)" },
    borderStyle: { borderColor: "rgba(244,63,94,0.25)" },
    progressCls: "bg-rose-500",
  },
  warning: {
    icon: TriangleAlert,
    iconStyle: { background: "rgba(245,158,11,0.12)", color: "rgb(245,158,11)", boxShadow: "0 0 0 1px rgba(245,158,11,0.2)" },
    borderStyle: { borderColor: "rgba(245,158,11,0.25)" },
    progressCls: "bg-amber-500",
  },
  info: {
    icon: Info,
    iconStyle: { background: "rgba(14,165,233,0.12)", color: "rgb(14,165,233)", boxShadow: "0 0 0 1px rgba(14,165,233,0.2)" },
    borderStyle: { borderColor: "rgba(14,165,233,0.25)" },
    progressCls: "bg-sky-500",
  },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef(new Map<string, number[]>());

  const clearTimers = useCallback((id: string) => {
    const timers = timersRef.current.get(id) || [];
    timers.forEach((timer) => window.clearTimeout(timer));
    timersRef.current.delete(id);
  }, []);

  const removeToast = useCallback(
    (id: string) => {
      clearTimers(id);
      setToasts((current) => current.filter((toast) => toast.id !== id));
    },
    [clearTimers],
  );

  const dismissToast = useCallback(
    (id: string) => {
      setToasts((current) =>
        current.map((toast) => {
          if (toast.id !== id || toast.leaving) {
            return toast;
          }

          return { ...toast, leaving: true };
        }),
      );

      const exitTimer = window.setTimeout(() => removeToast(id), EXIT_MS);
      timersRef.current.set(id, [...(timersRef.current.get(id) || []), exitTimer]);
    },
    [removeToast],
  );

  const showToast = useCallback(
    ({ tone = "info", title, message, duration = 4400 }: ToastInput) => {
      const id = `toast-${Date.now()}-${toastSeed++}`;
      const toast: ToastItem = { id, tone, title, message, duration, leaving: false };

      setToasts((current) => {
        const next = [toast, ...current];
        next.slice(MAX_TOASTS).forEach((overflowToast) => clearTimers(overflowToast.id));
        return next.slice(0, MAX_TOASTS);
      });

      const dismissTimer = window.setTimeout(() => dismissToast(id), duration);
      timersRef.current.set(id, [dismissTimer]);
      return id;
    },
    [clearTimers, dismissToast],
  );

  useEffect(
    () => () => {
      timersRef.current.forEach((timers) =>
        timers.forEach((timer) => window.clearTimeout(timer)),
      );
      timersRef.current.clear();
    },
    [],
  );

  const contextValue = useMemo(
    () => ({ showToast, dismissToast }),
    [dismissToast, showToast],
  );

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[90] flex w-[calc(100vw-2rem)] max-w-[420px] flex-col gap-3 sm:right-5 sm:top-5">
        {toasts.map((toast) => {
          const styles = toneStyles[toast.tone];
          const Icon = styles.icon;

          return (
            <div
              key={toast.id}
              role={toast.tone === "error" ? "alert" : "status"}
              aria-live={toast.tone === "error" ? "assertive" : "polite"}
              className={cn(
                "toast-card pointer-events-auto relative overflow-hidden rounded-[18px] border px-4 py-3.5 shadow-[0_8px_24px_rgba(0,0,0,0.1)]",
                toast.leaving ? "toast-card-exit" : "toast-card-enter",
              )}
              style={{ backgroundColor: "var(--surface)", ...styles.borderStyle }}
            >
              <div className="flex items-start gap-3">
                <span
                  className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px]"
                  style={styles.iconStyle}
                >
                  <Icon className="h-4.5 w-4.5" />
                </span>
                <div className="min-w-0 flex-1">
                  {toast.title ? (
                    <p className="text-sm font-semibold" style={{ color: "var(--tx)" }}>
                      {toast.title}
                    </p>
                  ) : null}
                  <div className="text-sm leading-6" style={{ color: "var(--tx-m)" }}>
                    {toast.message}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Đóng thông báo"
                  title="Đóng thông báo"
                  className="rounded-[10px] p-1.5 transition hover:bg-black/5 dark:hover:bg-white/8"
                  style={{ color: "var(--tx-f)" }}
                  onClick={() => dismissToast(toast.id)}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div
                className={cn(
                  "toast-progress absolute bottom-0 left-0 h-0.5 w-full origin-left",
                  styles.progressCls,
                )}
                style={{ animationDuration: `${toast.duration}ms` }}
              />
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error("useToast must be used inside ToastProvider");
  }

  return context;
}
