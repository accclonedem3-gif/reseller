import { Bell, LifeBuoy, Send } from "lucide-react";

const supportLinks = [
  {
    label: "Telegram hỗ trợ",
    value: "@thaidem57",
    href: "https://t.me/thaidem57",
    icon: Send,
    color: "rgb(56,189,248)",
  },
  {
    label: "Kênh Telegram chính thức",
    value: "@altivoxai_notification",
    href: "https://t.me/altivoxai_notification",
    icon: Bell,
    color: "rgb(249,115,22)",
  },
] as const;

export function SupportPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <p className="text-[11px] font-black uppercase tracking-widest text-orange-500">Altivox AI</p>
        <h1 className="mt-1 text-2xl font-black" style={{ color: "var(--tx)" }}>Hỗ trợ</h1>
      </div>

      <div className="overflow-hidden rounded-2xl" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
        <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: "1px solid var(--bd)" }}>
          <LifeBuoy className="h-5 w-5 text-orange-500" />
          <h2 className="text-[15px] font-black" style={{ color: "var(--tx)" }}>Liên hệ hỗ trợ</h2>
        </div>

        <div className="space-y-3 p-5">
          {supportLinks.map(({ label, value, href, icon: Icon, color }) => (
            <a
              key={href}
              href={href}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between gap-4 rounded-xl p-4 transition hover:-translate-y-0.5 hover:opacity-90"
              style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ color, background: `${color.replace("rgb", "rgba").replace(")", ",0.12)")}` }}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{label}</p>
                  <p className="mt-1 truncate text-[14px] font-black" style={{ color: "var(--tx)" }}>{value}</p>
                </div>
              </div>
              <Send className="h-4 w-4 shrink-0" style={{ color }} />
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}