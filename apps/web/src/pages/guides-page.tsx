import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Bot,
  Boxes,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  CreditCard,
  ExternalLink,
  FileText,
  HelpCircle,
  KeyRound,
  LifeBuoy,
  ListChecks,
  Package,
  PlayCircle,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Store,
  Users,
  WalletCards,
  Wrench,
  X,
  Youtube,
} from "lucide-react";

import {
  GUIDE_ARTICLES,
  GUIDE_CATEGORIES,
  type GuideArticle,
  type GuideCategory,
  type GuideVisualKind,
} from "@/lib/guide-content";

const CATEGORY_ICONS: Record<GuideCategory, typeof Bot> = {
  start: PlayCircle,
  bot: Bot,
  products: Package,
  payments: CreditCard,
  orders: ShoppingBag,
  source: Boxes,
  growth: BarChart3,
  troubleshooting: Wrench,
};

const CATEGORY_COLORS: Record<GuideCategory, string> = {
  start: "249,115,22",
  bot: "56,189,248",
  products: "168,85,247",
  payments: "34,197,94",
  orders: "245,158,11",
  source: "20,184,166",
  growth: "236,72,153",
  troubleshooting: "244,63,94",
};

const FULL_GUIDE_VIDEO_URL = "https://youtu.be/mAfs5L8a6B8?si=n4Mim2bPDBsdPlvC";

function FullGuideVideoCard({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <a
        href={FULL_GUIDE_VIDEO_URL}
        target="_blank"
        rel="noreferrer"
        className="group flex items-center gap-3 rounded-[20px] border border-red-500/20 bg-red-500/10 p-4 transition hover:-translate-y-0.5 hover:border-red-500/40"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-600 text-white shadow-lg shadow-red-500/20">
          <Youtube className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-black uppercase tracking-wider text-red-400">Không hiểu phần chữ?</span>
          <span className="mt-1 block text-xs font-black" style={{ color: "var(--tx)" }}>Xem video hướng dẫn toàn bộ</span>
        </span>
        <ExternalLink className="h-4 w-4 shrink-0 text-red-400 transition group-hover:translate-x-0.5" />
      </a>
    );
  }

  return (
    <a
      href={FULL_GUIDE_VIDEO_URL}
      target="_blank"
      rel="noreferrer"
      className="group grid overflow-hidden rounded-[24px] border border-red-500/20 bg-red-500/10 transition hover:-translate-y-0.5 hover:border-red-500/40 sm:grid-cols-[260px_1fr]"
    >
      <div className="relative min-h-40 overflow-hidden bg-[#120b0d] sm:min-h-[170px]">
        <img
          src="https://i.ytimg.com/vi/mAfs5L8a6B8/hqdefault.jpg"
          alt="Video hướng dẫn toàn bộ hệ thống"
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover opacity-75 transition duration-300 group-hover:scale-105 group-hover:opacity-90"
        />
        <span className="absolute inset-0 bg-gradient-to-r from-black/20 to-black/55" />
        <span className="absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-red-600 text-white shadow-2xl ring-8 ring-white/10">
          <PlayCircle className="h-7 w-7" />
        </span>
      </div>
      <div className="flex items-center justify-between gap-5 p-5 sm:p-6">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-red-400"><Youtube className="h-4 w-4" /> Video hướng dẫn toàn bộ</div>
          <h2 className="mt-2 text-xl font-black" style={{ color: "var(--tx)" }}>Đọc chưa hiểu? Xem video từ đầu đến cuối</h2>
          <p className="mt-2 text-sm leading-6" style={{ color: "var(--tx-m)" }}>Video trình bày toàn bộ quy trình sử dụng hệ thống. Bấm để mở trực tiếp trên YouTube.</p>
        </div>
        <span className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-600 text-white sm:flex"><ExternalLink className="h-5 w-5" /></span>
      </div>
    </a>
  );
}

function Highlight({ n, className = "" }: { n: number; className?: string }) {
  return (
    <span
      className={`absolute z-20 flex h-7 w-7 items-center justify-center rounded-full text-xs font-black text-white shadow-lg ring-4 ring-orange-500/20 ${className}`}
      style={{ background: "rgb(249,115,22)" }}
    >
      {n}
    </span>
  );
}

function VisualShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <figure>
      <div className="overflow-hidden rounded-[22px] border border-white/10 bg-[#111827] shadow-2xl shadow-black/20">
        <div className="flex items-center justify-between border-b border-white/10 bg-[#0b1220] px-4 py-3">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
          </div>
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">{title}</span>
          <span className="w-10" />
        </div>
        <div className="relative min-h-[260px] p-5 text-slate-100 sm:min-h-[300px] sm:p-7">{children}</div>
      </div>
      <figcaption className="mt-3 flex items-center gap-2 text-xs leading-5" style={{ color: "var(--tx-f)" }}>
        <BadgeCheck className="h-4 w-4 shrink-0 text-orange-500" />
        Hình minh họa giao diện — các số màu cam là vị trí cần thao tác.
      </figcaption>
    </figure>
  );
}

function GuideVisual({ kind }: { kind: GuideVisualKind }) {
  if (kind === "botfather") {
    return (
      <VisualShell title="Telegram · BotFather">
        <div className="mx-auto max-w-md space-y-3">
          <div className="flex items-center gap-3 border-b border-white/10 pb-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-sky-500"><Bot className="h-5 w-5" /></div>
            <div><p className="font-black">BotFather ✓</p><p className="text-xs text-slate-400">bot</p></div>
          </div>
          <div className="relative ml-auto w-fit rounded-2xl rounded-br-sm bg-sky-600 px-4 py-2.5 text-sm">
            /newbot<Highlight n={1} className="-right-4 -top-4" />
          </div>
          <div className="max-w-[88%] rounded-2xl rounded-bl-sm bg-slate-700 px-4 py-3 text-sm leading-6">
            Alright, a new bot. What are we going to call it?
          </div>
          <div className="relative ml-auto w-fit rounded-2xl rounded-br-sm bg-sky-600 px-4 py-2.5 text-sm">
            QK Shop Support Bot<Highlight n={2} className="-right-4 -top-4" />
          </div>
          <div className="relative rounded-2xl rounded-bl-sm bg-slate-700 px-4 py-3 text-sm">
            Use this token to access the HTTP API:<br />
            <code className="mt-2 block rounded-lg bg-black/25 px-3 py-2 font-mono text-emerald-300">123456:••••••••••••••••</code>
            <Highlight n={3} className="-right-3 top-8" />
          </div>
        </div>
      </VisualShell>
    );
  }

  if (kind === "payment") {
    return (
      <VisualShell title="Cấu hình thanh toán">
        <div className="grid gap-4 sm:grid-cols-[150px_1fr]">
          <div className="space-y-2 rounded-2xl bg-white/5 p-3">
            {["Ngân hàng", "Binance UID", "OKX", "USDT BEP20"].map((item, index) => (
              <div key={item} className={`relative rounded-xl px-3 py-2.5 text-xs font-bold ${index === 1 ? "bg-orange-500/20 text-orange-300" : "text-slate-400"}`}>
                {item}{index === 1 && <Highlight n={1} className="-right-3 -top-3" />}
              </div>
            ))}
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs font-black uppercase tracking-widest text-slate-400">Binance Pay</p>
            <div className="relative mt-4 rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-300">
              Binance UID <span className="float-right font-mono text-white">5523674314</span>
              <Highlight n={2} className="-right-3 -top-3" />
            </div>
            <div className="mt-3 flex items-center justify-between rounded-xl bg-black/20 px-4 py-3 text-sm">
              <span>Tự động xác nhận</span><span className="h-6 w-11 rounded-full bg-emerald-500 p-1"><span className="ml-auto block h-4 w-4 rounded-full bg-white" /></span>
            </div>
            <button className="relative mt-4 w-full rounded-xl bg-orange-500 py-3 text-sm font-black text-white">
              Lưu & kiểm tra kết nối<Highlight n={3} className="-right-3 -top-3" />
            </button>
          </div>
        </div>
      </VisualShell>
    );
  }

  if (kind === "product" || kind === "inventory" || kind === "archive") {
    const isInventory = kind === "inventory";
    const isArchive = kind === "archive";
    return (
      <VisualShell title={isInventory ? "Kho tài khoản" : "Quản lý sản phẩm"}>
        <div className="rounded-2xl border border-white/10 bg-white/5">
          <div className="flex items-center justify-between border-b border-white/10 p-4">
            <div><p className="text-sm font-black">SẢN PHẨM</p><p className="mt-1 text-[11px] text-slate-500">19 sản phẩm riêng</p></div>
            <button className="relative rounded-xl bg-orange-500 px-4 py-2 text-xs font-black">
              + THÊM SẢN PHẨM{!isArchive && !isInventory && <Highlight n={1} className="-right-3 -top-3" />}
            </button>
          </div>
          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 p-4">
            <div><p className="text-sm font-black">GROK 3 THÁNG</p><p className="mt-1 text-xs text-amber-300">RIÊNG · GROK</p></div>
            <div className="text-right"><p className="font-black text-emerald-400">650.000 ₫</p><p className="text-xs text-slate-500">Còn 18</p></div>
            <div className="relative rounded-lg bg-white/5 px-3 py-2 font-black">•••<Highlight n={isArchive ? 1 : 2} className="-right-3 -top-3" /></div>
          </div>
          <div className="relative ml-auto mr-4 w-48 rounded-xl border border-white/10 bg-[#1f2937] p-2 text-xs shadow-xl">
            {(isInventory ? ["Xem", "Kho tài khoản", "Nhân bản"] : isArchive ? ["Xem", "Kho tài khoản", "Nhân bản", "Lưu trữ"] : ["Chỉnh sửa", "Khuyến mãi", "Xem trên bot"]).map((item, index) => (
              <div key={item} className={`rounded-lg px-3 py-2 ${item === "Lưu trữ" ? "text-rose-400" : item === "Kho tài khoản" ? "text-orange-300" : "text-slate-300"}`}>
                {item}
                {((isInventory && item === "Kho tài khoản") || (isArchive && item === "Lưu trữ")) && <Highlight n={2} className="-right-3 top-1" />}
              </div>
            ))}
          </div>
          {isArchive && <div className="relative mx-4 mb-4 rounded-xl border border-orange-400/20 bg-orange-500/10 px-4 py-3 text-xs text-orange-200">Tab ĐÃ LƯU TRỮ (1)<Highlight n={3} className="-right-3 -top-3" /></div>}
          {isInventory && <div className="relative mx-4 mb-4 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-200">Tải file TXT hoặc dán danh sách tài khoản<Highlight n={3} className="-right-3 -top-3" /></div>}
        </div>
      </VisualShell>
    );
  }

  if (kind === "order") {
    const statuses = [
      { label: "Chờ thanh toán", color: "245,158,11" },
      { label: "Đã thanh toán", color: "56,189,248" },
      { label: "Đang xử lý", color: "168,85,247" },
      { label: "Đã giao", color: "34,197,94" },
    ];
    return (
      <VisualShell title="Luồng đơn hàng">
        <div className="mx-auto max-w-xl pt-4">
          <div className="grid gap-3 sm:grid-cols-4">
            {statuses.map((status, index) => (
              <div key={status.label} className="relative rounded-2xl border p-4 text-center" style={{ borderColor: `rgba(${status.color},.3)`, background: `rgba(${status.color},.1)` }}>
                <span className="mx-auto flex h-9 w-9 items-center justify-center rounded-full font-black" style={{ background: `rgba(${status.color},.2)`, color: `rgb(${status.color})` }}>{index + 1}</span>
                <p className="mt-3 text-xs font-black">{status.label}</p>
                {index < statuses.length - 1 && <ChevronRight className="absolute -right-5 top-8 z-10 hidden h-5 w-5 text-slate-600 sm:block" />}
              </div>
            ))}
          </div>
          <div className="relative mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex justify-between text-xs"><span className="text-slate-400">Mã đơn</span><strong>ORD-20260814-958</strong></div>
            <div className="mt-3 flex justify-between text-xs"><span className="text-slate-400">Giao dịch</span><strong className="text-emerald-400">Đã đối soát</strong></div>
            <Highlight n={3} className="-right-3 -top-3" />
          </div>
        </div>
      </VisualShell>
    );
  }

  if (kind === "source") {
    return (
      <VisualShell title="Mạng lưới nguồn PRO">
        <div className="mx-auto flex max-w-xl flex-col items-center justify-center gap-4 py-5 sm:flex-row">
          {[
            { icon: Store, label: "SHOP NGUỒN", sub: "Giá sỉ · Tồn kho", n: 1 },
            { icon: Boxes, label: "HÀNG ĐỢI ĐỒNG BỘ", sub: "Giới hạn request", n: 2 },
            { icon: Bot, label: "SHOP ĐẠI LÝ PRO", sub: "Giá bán · Bot riêng", n: 3 },
          ].map((item, index) => (
            <div key={item.label} className="flex items-center gap-4 sm:flex-1 sm:flex-col">
              <div className="relative flex min-h-32 w-full flex-col items-center justify-center rounded-2xl border border-teal-400/20 bg-teal-500/10 p-4 text-center">
                <item.icon className="h-7 w-7 text-teal-300" />
                <p className="mt-3 text-xs font-black">{item.label}</p><p className="mt-1 text-[10px] text-slate-400">{item.sub}</p>
                <Highlight n={item.n} className="-right-3 -top-3" />
              </div>
              {index < 2 && <ArrowRight className="h-5 w-5 shrink-0 rotate-90 text-teal-500 sm:rotate-0" />}
            </div>
          ))}
        </div>
      </VisualShell>
    );
  }

  if (kind === "customer") {
    return (
      <VisualShell title="Người dùng bot & ví">
        <div className="grid gap-4 sm:grid-cols-[1fr_1.3fr]">
          <div className="rounded-2xl bg-white/5 p-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-sky-500/20 text-sky-300"><Users className="h-5 w-5" /></div>
            <p className="mt-3 font-black">@apapcapro</p><p className="text-xs text-slate-500">Telegram ID 5523674314</p>
            <div className="relative mt-4 rounded-xl bg-black/20 px-3 py-2 text-xs">CTV · Chiết khấu 10%<Highlight n={1} className="-right-3 -top-3" /></div>
          </div>
          <div className="space-y-3">
            {[{ icon: WalletCards, label: "Ví nạp", value: "1.250.000 ₫" }, { icon: Sparkles, label: "Ví hoa hồng", value: "185.000 ₫" }].map((row, index) => (
              <div key={row.label} className="relative flex items-center justify-between rounded-2xl bg-white/5 p-4">
                <div className="flex items-center gap-3"><row.icon className="h-5 w-5 text-emerald-300" /><span className="text-xs font-bold text-slate-400">{row.label}</span></div><strong>{row.value}</strong>
                {index === 0 && <Highlight n={2} className="-right-3 -top-3" />}
              </div>
            ))}
            <div className="relative rounded-2xl border border-white/10 px-4 py-3 text-xs text-slate-300">Lịch sử biến động đầy đủ<Highlight n={3} className="-right-3 -top-3" /></div>
          </div>
        </div>
      </VisualShell>
    );
  }

  if (kind === "warranty") {
    return (
      <VisualShell title="Yêu cầu bảo hành">
        <div className="mx-auto max-w-lg rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="flex items-center justify-between"><div><p className="text-xs text-slate-500">Mã bảo hành</p><p className="font-black">WR-20260814-709</p></div><span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-black text-amber-300">Chờ xử lý</span></div>
          <div className="relative mt-4 rounded-xl bg-black/20 p-4 text-xs leading-6 text-slate-300">Khách báo tài khoản không đăng nhập được. Auto-check: cần kiểm tra thủ công.<Highlight n={1} className="-right-3 -top-3" /></div>
          <div className="mt-4 grid grid-cols-2 gap-3"><button className="relative rounded-xl bg-emerald-500 py-3 text-xs font-black">Thay tài khoản<Highlight n={2} className="-right-3 -top-3" /></button><button className="rounded-xl bg-rose-500/15 py-3 text-xs font-black text-rose-300">Từ chối</button></div>
        </div>
      </VisualShell>
    );
  }

  if (kind === "analytics") {
    const bars = [42, 64, 38, 78, 58, 88, 72];
    return (
      <VisualShell title="Doanh thu & lợi nhuận">
        <div className="grid gap-4 sm:grid-cols-3">
          {["Doanh thu 24.500.000 ₫", "Lợi nhuận 8.250.000 ₫", "86 đơn đã giao"].map((label, index) => <div key={label} className="relative rounded-2xl bg-white/5 p-4 text-xs font-black text-emerald-300">{label}{index === 0 && <Highlight n={1} className="-right-3 -top-3" />}</div>)}
        </div>
        <div className="relative mt-5 flex h-36 items-end gap-3 rounded-2xl bg-white/5 px-5 pb-4 pt-6">
          {bars.map((height, index) => <span key={index} className="flex-1 rounded-t-md bg-gradient-to-t from-orange-600 to-orange-300" style={{ height: `${height}%` }} />)}
          <Highlight n={2} className="-right-3 -top-3" />
        </div>
      </VisualShell>
    );
  }

  if (kind === "security") {
    return (
      <VisualShell title="Checklist an toàn">
        <div className="mx-auto max-w-lg space-y-3">
          {["Không gửi Bot Token / API secret", "Đối chiếu transaction ID trước khi xác nhận", "Gửi mã đơn và thời điểm xảy ra lỗi", "Che dữ liệu khách hàng trong ảnh"].map((label, index) => (
            <div key={label} className="relative flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm"><ShieldCheck className="h-5 w-5 text-emerald-300" /><span>{label}</span>{index < 3 && <Highlight n={index + 1} className="-right-3 -top-3" />}</div>
          ))}
        </div>
      </VisualShell>
    );
  }

  const shopMode = kind === "shop";
  return (
    <VisualShell title={shopMode ? "Thiết lập cửa hàng" : "Checklist mở bán"}>
      <div className="mx-auto max-w-lg rounded-2xl border border-white/10 bg-white/5 p-5">
        <div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-500/20 text-orange-300">{shopMode ? <Store className="h-5 w-5" /> : <ListChecks className="h-5 w-5" />}</div><div><p className="font-black">{shopMode ? "QK SHOPMMO" : "Sẵn sàng mở bán"}</p><p className="text-xs text-slate-500">Hoàn thành các bước bắt buộc</p></div></div>
        <div className="mt-5 space-y-3">
          {(shopMode ? ["Tên shop và kênh hỗ trợ", "Lời chào và menu bot", "Ngôn ngữ hiển thị"] : ["Kết nối bot", "Bật thanh toán", "Thêm sản phẩm", "Chạy đơn thử"]).map((label, index) => (
            <div key={label} className="relative flex items-center justify-between rounded-xl bg-black/20 px-4 py-3 text-sm"><span>{label}</span><CheckCircle2 className="h-5 w-5 text-emerald-400" />{index < 3 && <Highlight n={index + 1} className="-right-3 -top-3" />}</div>
          ))}
        </div>
      </div>
    </VisualShell>
  );
}

function AccessBadge({ access }: { access: GuideArticle["access"] }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${access === "PRO" ? "bg-violet-500/15 text-violet-400" : "bg-emerald-500/15 text-emerald-400"}`}>
      {access}
    </span>
  );
}

function ArticleCard({ article }: { article: GuideArticle }) {
  const Icon = CATEGORY_ICONS[article.category];
  const color = CATEGORY_COLORS[article.category];
  return (
    <Link
      to={`/guides/${article.slug}`}
      className="group flex h-full flex-col rounded-[22px] p-5 transition duration-200 hover:-translate-y-1"
      style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl" style={{ color: `rgb(${color})`, background: `rgba(${color},.12)` }}><Icon className="h-5 w-5" /></span>
        <AccessBadge access={article.access} />
      </div>
      <h3 className="mt-5 text-[16px] font-black leading-6 transition group-hover:text-orange-500" style={{ color: "var(--tx)" }}>{article.title}</h3>
      <p className="mt-2 flex-1 text-[13px] leading-6" style={{ color: "var(--tx-m)" }}>{article.summary}</p>
      <div className="mt-5 flex items-center justify-between border-t pt-4 text-xs" style={{ borderColor: "var(--bd)", color: "var(--tx-f)" }}>
        <span className="flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" /> {article.minutes} phút</span>
        <span className="flex items-center gap-1 font-black text-orange-500">Xem hướng dẫn <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-1" /></span>
      </div>
    </Link>
  );
}

function GuidesHome() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<GuideCategory | "all">("all");
  const normalizedQuery = query.trim().toLocaleLowerCase("vi");
  const filtered = useMemo(() => GUIDE_ARTICLES.filter((article) => {
    if (category !== "all" && article.category !== category) return false;
    if (!normalizedQuery) return true;
    const haystack = [article.title, article.summary, article.outcome, ...article.steps.map((step) => `${step.title} ${step.description}`)].join(" ").toLocaleLowerCase("vi");
    return haystack.includes(normalizedQuery);
  }), [category, normalizedQuery]);

  return (
    <div className="mx-auto max-w-7xl space-y-7 pb-10">
      <section className="relative overflow-hidden rounded-[28px] border p-6 sm:p-9" style={{ background: "var(--surface)", borderColor: "var(--bd)" }}>
        <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-orange-500/15 blur-3xl" />
        <div className="relative max-w-3xl">
          <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.2em] text-orange-500"><LifeBuoy className="h-4 w-4" /> Trung tâm hướng dẫn</div>
          <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl" style={{ color: "var(--tx)" }}>Bạn cần hướng dẫn phần nào?</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7" style={{ color: "var(--tx-m)" }}>Từng bước có hình minh họa, cách kiểm tra kết quả và hướng xử lý lỗi cho toàn bộ quy trình vận hành shop.</p>
          <div className="relative mt-6 max-w-2xl">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-orange-500" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm: tạo bot, nhập kho, Binance, đơn lỗi..." className="h-14 w-full rounded-2xl border bg-transparent pl-12 pr-12 text-sm font-semibold outline-none transition focus:border-orange-500/50" style={{ background: "var(--inp)", borderColor: "var(--bd)", color: "var(--tx)" }} />
            {query && <button type="button" onClick={() => setQuery("")} className="absolute right-4 top-1/2 -translate-y-1/2" style={{ color: "var(--tx-f)" }}><X className="h-4 w-4" /></button>}
          </div>
          <div className="mt-5 flex flex-wrap gap-2 text-xs" style={{ color: "var(--tx-m)" }}><span>Tìm nhanh:</span>{["BotFather", "Thanh toán", "Nhập kho", "Lưu trữ"].map((term) => <button type="button" key={term} onClick={() => setQuery(term)} className="font-bold text-orange-500 hover:underline">{term}</button>)}</div>
        </div>
      </section>

      <FullGuideVideoCard />

      {!query && category === "all" && (
        <Link to="/guides/bat-dau-trong-10-phut" className="group grid gap-5 overflow-hidden rounded-[24px] border p-5 sm:grid-cols-[1fr_auto] sm:items-center sm:p-6" style={{ borderColor: "rgba(249,115,22,.28)", background: "linear-gradient(120deg, rgba(249,115,22,.14), var(--surface))" }}>
          <div className="flex items-start gap-4"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-orange-500 text-white shadow-lg shadow-orange-500/20"><PlayCircle className="h-6 w-6" /></span><div><p className="text-[10px] font-black uppercase tracking-[.2em] text-orange-500">Nên xem đầu tiên</p><h2 className="mt-1 text-xl font-black" style={{ color: "var(--tx)" }}>Bắt đầu bán hàng trong 10 phút</h2><p className="mt-1 text-sm leading-6" style={{ color: "var(--tx-m)" }}>Đi từ tài khoản mới đến một đơn giao thành công bằng checklist ngắn nhất.</p></div></div>
          <span className="flex items-center gap-2 text-sm font-black text-orange-500">Bắt đầu <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" /></span>
        </Link>
      )}

      <section>
        <div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="text-xl font-black" style={{ color: "var(--tx)" }}>Chủ đề hướng dẫn</h2><p className="mt-1 text-xs" style={{ color: "var(--tx-f)" }}>Chọn đúng nhóm chức năng bạn đang thao tác</p></div><span className="text-xs font-bold" style={{ color: "var(--tx-f)" }}>{filtered.length}/{GUIDE_ARTICLES.length} bài</span></div>
        <div className="flex gap-2 overflow-x-auto pb-2">
          <button type="button" onClick={() => setCategory("all")} className="shrink-0 rounded-full px-4 py-2.5 text-xs font-black transition" style={category === "all" ? { background: "rgb(249,115,22)", color: "white" } : { background: "var(--surface)", border: "1px solid var(--bd)", color: "var(--tx-m)" }}>Tất cả</button>
          {GUIDE_CATEGORIES.map((item) => { const Icon = CATEGORY_ICONS[item.id]; return <button type="button" key={item.id} onClick={() => setCategory(item.id)} className="flex shrink-0 items-center gap-2 rounded-full px-4 py-2.5 text-xs font-black transition" style={category === item.id ? { background: "rgb(249,115,22)", color: "white" } : { background: "var(--surface)", border: "1px solid var(--bd)", color: "var(--tx-m)" }}><Icon className="h-3.5 w-3.5" />{item.label}</button>; })}
        </div>
      </section>

      {filtered.length > 0 ? <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{filtered.map((article) => <ArticleCard key={article.slug} article={article} />)}</section> : <section className="rounded-[24px] border px-6 py-16 text-center" style={{ background: "var(--surface)", borderColor: "var(--bd)" }}><HelpCircle className="mx-auto h-10 w-10 text-orange-500" /><h2 className="mt-4 text-lg font-black" style={{ color: "var(--tx)" }}>Không tìm thấy hướng dẫn</h2><p className="mt-2 text-sm" style={{ color: "var(--tx-m)" }}>Thử từ khóa ngắn hơn hoặc chọn lại Tất cả.</p><button type="button" onClick={() => { setQuery(""); setCategory("all"); }} className="mt-5 rounded-xl bg-orange-500 px-4 py-2 text-xs font-black text-white">Xóa bộ lọc</button></section>}

      <section className="grid gap-4 rounded-[24px] border p-5 md:grid-cols-[1fr_auto] md:items-center" style={{ background: "var(--surface)", borderColor: "var(--bd)" }}>
        <div className="flex items-start gap-4"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-400"><LifeBuoy className="h-5 w-5" /></span><div><h2 className="text-base font-black" style={{ color: "var(--tx)" }}>Vẫn chưa xử lý được?</h2><p className="mt-1 text-sm leading-6" style={{ color: "var(--tx-m)" }}>Gửi mã đơn, thời điểm lỗi và ảnh đã che token để đội hỗ trợ kiểm tra nhanh hơn.</p></div></div>
        <Link to="/support" className="flex items-center justify-center gap-2 rounded-xl bg-sky-500 px-4 py-3 text-xs font-black text-white"><Send className="h-4 w-4" /> Liên hệ hỗ trợ</Link>
      </section>
    </div>
  );
}

function GuideDetail({ article }: { article: GuideArticle }) {
  useEffect(() => { window.scrollTo({ top: 0, behavior: "smooth" }); }, [article.slug]);
  const category = GUIDE_CATEGORIES.find((item) => item.id === article.category);
  const related = GUIDE_ARTICLES.filter((item) => item.category === article.category && item.slug !== article.slug).slice(0, 3);

  return (
    <div className="mx-auto max-w-7xl pb-12">
      <div className="mb-6 flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--tx-f)" }}><Link to="/guides" className="font-bold hover:text-orange-500">Trung tâm hướng dẫn</Link><ChevronRight className="h-3.5 w-3.5" /><span>{category?.label}</span><ChevronRight className="h-3.5 w-3.5" /><span className="truncate">{article.title}</span></div>
      <div className="grid gap-7 xl:grid-cols-[minmax(0,1fr)_280px]">
        <main className="min-w-0 space-y-7">
          <header className="rounded-[28px] border p-6 sm:p-8" style={{ background: "var(--surface)", borderColor: "var(--bd)" }}>
            <Link to="/guides" className="mb-5 inline-flex items-center gap-2 text-xs font-black text-orange-500"><ArrowLeft className="h-4 w-4" /> Tất cả hướng dẫn</Link>
            <div className="flex flex-wrap items-center gap-2"><AccessBadge access={article.access} /><span className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider" style={{ background: "var(--inp)", color: "var(--tx-f)" }}><Clock3 className="h-3 w-3" /> {article.minutes} phút</span></div>
            <h1 className="mt-4 text-2xl font-black leading-tight sm:text-4xl" style={{ color: "var(--tx)" }}>{article.title}</h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 sm:text-base" style={{ color: "var(--tx-m)" }}>{article.summary}</p>
            <div className="mt-6 flex items-start gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" /><div><p className="text-xs font-black uppercase tracking-wider text-emerald-400">Kết quả sau hướng dẫn</p><p className="mt-1 text-sm leading-6" style={{ color: "var(--tx)" }}>{article.outcome}</p></div></div>
          </header>

          <div className="xl:hidden"><FullGuideVideoCard compact /></div>

          <section id="minh-hoa"><GuideVisual kind={article.visual} /></section>

          <section id="chuan-bi" className="rounded-[24px] border p-5 sm:p-6" style={{ background: "var(--surface)", borderColor: "var(--bd)" }}>
            <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/15 text-sky-400"><ListChecks className="h-5 w-5" /></span><div><p className="text-[10px] font-black uppercase tracking-widest text-sky-400">Trước khi bắt đầu</p><h2 className="text-lg font-black" style={{ color: "var(--tx)" }}>Cần chuẩn bị</h2></div></div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">{article.prerequisites.map((item) => <div key={item} className="flex items-start gap-3 rounded-xl p-3 text-sm leading-6" style={{ background: "var(--inp)", color: "var(--tx-m)" }}><Check className="mt-1 h-4 w-4 shrink-0 text-emerald-400" />{item}</div>)}</div>
          </section>

          <section id="cac-buoc">
            <div className="mb-4"><p className="text-[10px] font-black uppercase tracking-widest text-orange-500">Thực hiện theo thứ tự</p><h2 className="mt-1 text-2xl font-black" style={{ color: "var(--tx)" }}>Các bước chi tiết</h2></div>
            <div className="space-y-4">{article.steps.map((step, index) => <article key={step.title} className="rounded-[22px] border p-5 sm:p-6" style={{ background: "var(--surface)", borderColor: "var(--bd)" }}><div className="flex items-start gap-4"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-500 text-sm font-black text-white shadow-lg shadow-orange-500/15">{index + 1}</span><div><h3 className="text-base font-black" style={{ color: "var(--tx)" }}>{step.title}</h3><p className="mt-2 text-sm leading-7" style={{ color: "var(--tx-m)" }}>{step.description}</p>{step.note && <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs leading-5 text-amber-500"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{step.note}</div>}</div></div></article>)}</div>
          </section>

          <section id="kiem-tra" className="rounded-[24px] border p-5 sm:p-6" style={{ background: "var(--surface)", borderColor: "var(--bd)" }}><div className="flex items-center gap-3"><BadgeCheck className="h-6 w-6 text-emerald-400" /><h2 className="text-xl font-black" style={{ color: "var(--tx)" }}>Kiểm tra đã làm đúng</h2></div><div className="mt-5 space-y-3">{article.checks.map((item) => <div key={item} className="flex items-start gap-3 text-sm leading-6" style={{ color: "var(--tx-m)" }}><span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15"><Check className="h-3 w-3 text-emerald-400" /></span>{item}</div>)}</div></section>

          <section id="loi-thuong-gap" className="rounded-[24px] border p-5 sm:p-6" style={{ background: "var(--surface)", borderColor: "var(--bd)" }}><div className="flex items-center gap-3"><AlertTriangle className="h-6 w-6 text-amber-400" /><h2 className="text-xl font-black" style={{ color: "var(--tx)" }}>Lỗi thường gặp</h2></div><div className="mt-5 space-y-3">{article.errors.map((error) => <details key={error.title} className="group rounded-xl border p-4" style={{ borderColor: "var(--bd)", background: "var(--inp)" }}><summary className="cursor-pointer list-none text-sm font-black" style={{ color: "var(--tx)" }}>{error.title}<ChevronRight className="float-right h-4 w-4 transition group-open:rotate-90" /></summary><p className="mt-3 border-t pt-3 text-sm leading-6" style={{ borderColor: "var(--bd)", color: "var(--tx-m)" }}>{error.solution}</p></details>)}</div></section>

          {related.length > 0 && <section><h2 className="mb-4 text-xl font-black" style={{ color: "var(--tx)" }}>Hướng dẫn liên quan</h2><div className="grid gap-4 md:grid-cols-2">{related.map((item) => <ArticleCard key={item.slug} article={item} />)}</div></section>}
        </main>

        <aside className="hidden xl:block"><div className="sticky top-6 space-y-4"><FullGuideVideoCard compact /><nav className="rounded-[22px] border p-4" style={{ background: "var(--surface)", borderColor: "var(--bd)" }}><p className="px-2 text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>Trong bài này</p><div className="mt-3 space-y-1">{[["#minh-hoa", "Hình minh họa"], ["#chuan-bi", "Cần chuẩn bị"], ["#cac-buoc", "Các bước chi tiết"], ["#kiem-tra", "Kiểm tra kết quả"], ["#loi-thuong-gap", "Lỗi thường gặp"]].map(([href, label]) => <a key={href} href={href} className="block rounded-lg px-2 py-2 text-xs font-bold transition hover:bg-orange-500/10 hover:text-orange-500" style={{ color: "var(--tx-m)" }}>{label}</a>)}</div></nav>{article.route && <Link to={article.route} className="flex items-center justify-between gap-3 rounded-[20px] bg-orange-500 p-4 text-sm font-black text-white shadow-lg shadow-orange-500/15"><span>{article.routeLabel || "Mở chức năng"}</span><ExternalLink className="h-4 w-4 shrink-0" /></Link>}<Link to="/support" className="flex items-center gap-3 rounded-[20px] border p-4 text-sm font-black" style={{ background: "var(--surface)", borderColor: "var(--bd)", color: "var(--tx)" }}><LifeBuoy className="h-5 w-5 text-sky-400" /> Cần hỗ trợ thêm?</Link></div></aside>
      </div>
    </div>
  );
}

export function GuidesPage() {
  const { slug } = useParams<{ slug?: string }>();
  if (!slug) return <GuidesHome />;
  const article = GUIDE_ARTICLES.find((item) => item.slug === slug);
  if (!article) return <Navigate to="/guides" replace />;
  return <GuideDetail article={article} />;
}
