import { BellRing, Clock3, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";

type Announcement = {
  enabled: boolean;
  title: string;
  message: string;
  imageUrl: string | null;
  effect: "zoom" | "glow" | "bounce" | "confetti" | "none" | string;
  version: string;
};

const SNOOZE_KEY = "system-announcement-snooze";
const LINK_PATTERN = /(https?:\/\/[^\s]+|www\.[^\s]+|@[a-zA-Z0-9_]{5,})/g;

function LinkifiedMessage({ text }: { text: string }) {
  return (
    <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7" style={{ color: "var(--tx-m)" }}>
      {text.split(LINK_PATTERN).map((part, index) => {
        if (!part) return null;
        const isTelegram = /^@[a-zA-Z0-9_]{5,}$/.test(part);
        const isUrl = /^(https?:\/\/|www\.)/.test(part);
        if (!isTelegram && !isUrl) return <span key={index}>{part}</span>;
        const href = isTelegram ? `https://t.me/${part.slice(1)}` : part.startsWith("www.") ? `https://${part}` : part;
        return <a key={index} href={href} target="_blank" rel="noreferrer" className="font-bold text-sky-400 underline decoration-sky-400/40 underline-offset-4 hover:text-sky-300">{part}</a>;
      })}
    </p>
  );
}

export function SystemAnnouncementModal() {
  const [visible, setVisible] = useState(false);
  const { data } = useQuery<Announcement>({
    queryKey: ["system-announcement"],
    queryFn: () => api.get("/system/announcement").then((response) => response.data),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!data?.enabled || (!data.message.trim() && !data.imageUrl)) {
      setVisible(false);
      return;
    }
    try {
      const saved = JSON.parse(localStorage.getItem(SNOOZE_KEY) || "null") as { version?: string; until?: number } | null;
      if (saved?.version === data.version && Number(saved.until) > Date.now()) {
        setVisible(false);
        return;
      }
    } catch {}
    setVisible(true);
  }, [data]);

  if (!visible || !data) return null;

  function snooze() {
    try {
      localStorage.setItem(SNOOZE_KEY, JSON.stringify({ version: data!.version, until: Date.now() + 2 * 60 * 60 * 1000 }));
    } catch {}
    setVisible(false);
  }

  const effectClass = data.effect === "none" ? "" : `announcement-${data.effect}`;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: "rgba(4,6,16,0.78)", backdropFilter: "blur(10px)" }}>
      {data.effect === "confetti" && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          {Array.from({ length: 24 }).map((_, index) => <span key={index} className="announcement-confetti" style={{ left: `${(index * 37) % 100}%`, animationDelay: `${(index % 8) * 0.18}s` }} />)}
        </div>
      )}
      <section className={`relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[28px] ${effectClass}`}
        style={{ background: "var(--surface)", border: "1px solid rgba(249,115,22,0.32)", boxShadow: "0 30px 90px rgba(0,0,0,0.5)" }}>
        <button type="button" onClick={() => setVisible(false)} aria-label="Đóng"
          className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-rose-500/15"
          style={{ background: "color-mix(in srgb, var(--surface) 85%, transparent)", color: "var(--tx-m)" }}>
          <X className="h-4 w-4" />
        </button>

        {data.imageUrl && <img src={data.imageUrl} alt="" className="max-h-72 w-full object-cover" />}
        <div className="p-6 sm:p-7">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-500 text-white shadow-lg shadow-orange-500/25">
            <BellRing className="h-5 w-5" />
          </div>
          <h2 className="pr-8 text-xl font-black" style={{ color: "var(--tx)" }}>{data.title}</h2>
          {data.message && <LinkifiedMessage text={data.message} />}
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={snooze}
              className="flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[12px] font-black transition hover:opacity-85"
              style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-m)" }}>
              <Clock3 className="h-3.5 w-3.5" /> Ẩn trong 2 giờ
            </button>
            <button type="button" onClick={() => setVisible(false)}
              className="rounded-xl bg-orange-500 px-5 py-2.5 text-[12px] font-black text-white transition hover:bg-orange-600">
              Đã hiểu
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}