import {
  ArrowRight,
  BarChart3,
  Bot,
  Boxes,
  Check,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  Menu,
  MessageCircleMore,
  PackageCheck,
  Send,
  ShieldCheck,
  Sparkles,
  UsersRound,
  WalletCards,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "@/auth/auth-provider";
import { useScrollReveal } from "@/hooks/use-scroll-reveal";
import { CinematicIntro } from "./cinematic-intro";
import "./landing-animations.css";

function useCountUp(target: number, duration = 1800) {
  const [value, setValue] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (!e?.isIntersecting) return;
      obs.disconnect();
      const start = performance.now();
      const step = (now: number) => {
        const p = Math.min((now - start) / duration, 1);
        const ease = 1 - Math.pow(1 - p, 3);
        setValue(Math.round(ease * target));
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }, { threshold: 0.3 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [target, duration]);
  return { ref, value };
}

const benefits = [
  {
    icon: Bot,
    number: "01",
    title: "Bot bán hàng 24/7",
    description:
      "Khách tự xem sản phẩm, đặt đơn, thanh toán và nhận hàng ngay trong Telegram.",
  },
  {
    icon: Boxes,
    number: "02",
    title: "Nguồn hàng linh hoạt",
    description:
      "Dùng kho riêng, kết nối nguồn ngoài hoặc đồng bộ catalog từ tổng sỉ trong hệ thống.",
  },
  {
    icon: WalletCards,
    number: "03",
    title: "Thanh toán tự động",
    description:
      "Hỗ trợ luồng thanh toán VND và USDT, tự xác nhận tiền trước khi giao sản phẩm.",
  },
  {
    icon: ShieldCheck,
    number: "04",
    title: "Bảo hành tập trung",
    description:
      "Theo dõi thời hạn, tiếp nhận yêu cầu và tự động cấp sản phẩm thay thế khi đủ điều kiện.",
  },
];

const steps = [
  ["Kết nối bot", "Thêm Bot Token và tùy chỉnh thương hiệu shop của bạn."],
  ["Chọn nguồn hàng", "Nhập kho riêng hoặc kết nối trực tiếp với nguồn tổng sỉ."],
  ["Thiết lập giá bán", "Đặt biên lợi nhuận và bật phương thức thanh toán phù hợp."],
  ["Bắt đầu bán", "Chia sẻ bot — Altivox xử lý phần vận hành còn lại."],
];

const faqs = [
  {
    question: "Tôi có cần biết lập trình không?",
    answer:
      "Không. Bạn chỉ cần tạo bot qua BotFather, nhập token và làm theo hướng dẫn thiết lập từng bước trên dashboard.",
  },
  {
    question: "Gói FREE có thể vận hành shop thật không?",
    answer:
      "FREE dành để khám phá dashboard và làm quen hệ thống. Khi muốn kết nối bot, nguồn hàng và nhận đơn thật, bạn nâng cấp lên PRO.",
  },
  {
    question: "Tôi có thể dùng nguồn hàng riêng không?",
    answer:
      "Có. Altivox hỗ trợ kho sản phẩm riêng, nguồn cung cấp bên ngoài và nguồn nội bộ từ seller ULTRA.",
  },
  {
    question: "PRO khác ULTRA như thế nào?",
    answer:
      "PRO dành cho shop bán lẻ. ULTRA có toàn bộ tính năng PRO và thêm khả năng cấp API key, làm tổng sỉ, đồng bộ catalog và quản lý mạng lưới đại lý.",
  },
];

function BrandMark() {
  return (
    <div className="flex items-center gap-3">
      <div className="relative grid size-10 place-items-center overflow-hidden rounded-xl bg-orange-500 text-white shadow-[0_10px_30px_rgba(249,115,22,.28)]">
        <Bot className="size-5" strokeWidth={2.4} />
        <span className="absolute inset-x-2 bottom-1 h-px bg-white/35" />
      </div>
      <div>
        <div className="text-[18px] font-black leading-none tracking-[-0.04em] text-white">
          ALTIVOX<span className="text-orange-500">.AI</span>
        </div>
        <div className="mt-1 text-[8px] font-bold uppercase tracking-[0.28em] text-white/35">
          Reseller Platform
        </div>
      </div>
    </div>
  );
}

function DashboardPreview() {
  return (
    <div className="relative mx-auto min-w-0 w-full max-w-[660px] lg:ml-auto">
      <div className="absolute -inset-10 -z-10 rounded-full bg-orange-500/10 blur-[90px]" />

      <div className="overflow-hidden rounded-[24px] border border-white/10 bg-[#111411] shadow-[0_45px_120px_rgba(0,0,0,.55)]">
        <div className="flex h-12 items-center justify-between border-b border-white/[0.07] px-4">
          <div className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-[#ff5f57]" />
            <span className="size-2.5 rounded-full bg-[#febc2e]" />
            <span className="size-2.5 rounded-full bg-[#28c840]" />
          </div>
          <div className="rounded-full border border-white/[0.06] bg-white/[0.03] px-4 py-1 text-[9px] font-semibold text-white/35">
            app.altivox.ai/dashboard
          </div>
          <div className="size-5 rounded-full bg-gradient-to-br from-orange-400 to-orange-700" />
        </div>

        <div className="grid min-h-[390px] grid-cols-[64px_1fr] sm:grid-cols-[154px_1fr]">
          <div className="border-r border-white/[0.07] bg-black/10 p-3">
            <div className="mb-7 flex items-center gap-2">
              <div className="grid size-7 shrink-0 place-items-center rounded-lg bg-orange-500 text-white">
                <Bot className="size-3.5" />
              </div>
              <span className="hidden text-[10px] font-black sm:block">ALTIVOX</span>
            </div>
            <div className="space-y-2">
              {[BarChart3, PackageCheck, UsersRound, WalletCards].map((Icon, index) => (
                <div
                  key={index}
                  className={`flex h-9 items-center gap-2 rounded-lg px-2 ${
                    index === 0 ? "bg-orange-500/15 text-orange-400" : "text-white/28"
                  }`}
                >
                  <Icon className="size-3.5 shrink-0" />
                  <span className="hidden text-[9px] font-semibold sm:block">
                    {[
                      "Tổng quan",
                      "Sản phẩm",
                      "Khách hàng",
                      "Thanh toán",
                    ][index]}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="min-w-0 p-4 sm:p-6">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[9px] font-bold uppercase tracking-[0.22em] text-orange-400">
                  Live overview
                </div>
                <div className="mt-1 text-lg font-bold tracking-tight text-white sm:text-xl">
                  Chào buổi sáng, Minh
                </div>
              </div>
              <div className="flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-2.5 py-1 text-[8px] font-bold text-emerald-400">
                <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
                BOT ONLINE
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2.5 xl:grid-cols-3">
              {[
                ["Doanh thu hôm nay", "4.820.000đ", "+18.4%"],
                ["Đơn hoàn tất", "128", "+12 đơn"],
                ["Lợi nhuận", "1.940.000đ", "+22.1%"],
              ].map(([label, value, delta], index) => (
                <div
                  key={label}
                  className={`rounded-xl border border-white/[0.07] bg-white/[0.025] p-3 ${
                    index === 2 ? "hidden xl:block" : ""
                  }`}
                >
                  <div className="text-[8px] text-white/35">{label}</div>
                  <div className="mt-1.5 text-sm font-extrabold tracking-tight text-white">
                    {value}
                  </div>
                  <div className="mt-2 text-[8px] font-bold text-emerald-400">{delta}</div>
                </div>
              ))}
            </div>

            <div className="mt-3 rounded-xl border border-white/[0.07] bg-white/[0.025] p-4">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold">Doanh thu 7 ngày</span>
                <span className="text-[8px] text-white/30">01 — 07 THÁNG NÀY</span>
              </div>
              <div className="mt-5 flex h-[92px] items-end gap-2">
                {[32, 48, 40, 62, 54, 76, 94, 73, 100, 85, 112, 128].map(
                  (height, index) => (
                    <div key={index} className="flex h-full flex-1 items-end">
                      <div
                        className={`w-full rounded-t-[3px] ${
                          index > 8 ? "bg-orange-500" : "bg-white/[0.09]"
                        }`}
                        style={{ height: `${Math.min(height, 100)}%` }}
                      />
                    </div>
                  ),
                )}
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2.5">
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
                <div className="text-[8px] text-white/35">Đơn hàng mới</div>
                <div className="mt-2 flex items-center gap-2">
                  <div className="grid size-7 place-items-center rounded-lg bg-orange-500/15 text-orange-400">
                    <PackageCheck className="size-3.5" />
                  </div>
                  <div>
                    <div className="text-[9px] font-bold">#ALT-02918</div>
                    <div className="text-[7px] text-emerald-400">Đã giao tự động</div>
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
                <div className="text-[8px] text-white/35">Tỷ lệ hoàn tất</div>
                <div className="mt-2 flex items-end gap-1">
                  <span className="text-xl font-black">98.7</span>
                  <span className="pb-0.5 text-[9px] text-white/35">%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute -bottom-9 -left-3 w-[235px] rounded-2xl border border-white/10 bg-[#171b17]/95 p-3.5 shadow-2xl backdrop-blur-xl sm:-left-9 sm:w-[260px]">
        <div className="flex items-center gap-2.5">
          <div className="grid size-9 place-items-center rounded-full bg-[#2aabee] text-white">
            <Send className="size-4" fill="currentColor" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[10px] font-bold">Altivox Shop Bot</span>
              <span className="text-[7px] text-white/25">vừa xong</span>
            </div>
            <div className="mt-0.5 truncate text-[8px] text-white/45">
              Đơn #ALT-02918 đã được giao thành công.
            </div>
          </div>
          <div className="grid size-6 place-items-center rounded-full bg-emerald-400/10 text-emerald-400">
            <Check className="size-3.5" />
          </div>
        </div>
      </div>
    </div>
  );
}

function FaqItem({
  question,
  answer,
}: {
  question: string;
  answer: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-white/[0.09]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-6 py-6 text-left"
      >
        <span className="text-base font-bold text-white sm:text-lg">{question}</span>
        <span
          className={`grid size-8 shrink-0 place-items-center rounded-full border border-white/10 text-white/55 transition ${
            open ? "rotate-180 bg-white/10" : ""
          }`}
        >
          <ChevronDown className="size-4" />
        </span>
      </button>
      <div
        className={`grid transition-all duration-300 ${
          open ? "grid-rows-[1fr] pb-6" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <p className="max-w-3xl text-sm leading-7 text-white/48 sm:text-base">{answer}</p>
        </div>
      </div>
    </div>
  );
}

export function LandingPage() {
  const { session } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [introComplete, setIntroComplete] = useState(false);
  const primaryHref = session ? "/" : "/register";
  const primaryLabel = session ? "Vào dashboard" : "Bắt đầu miễn phí";
  const revealRef = useScrollReveal();

  // Show cinematic intro first
  if (!introComplete) {
    return <CinematicIntro onComplete={() => setIntroComplete(true)} />;
  }

  return (
    <div ref={revealRef} className="min-h-screen bg-[#080a08] text-white selection:bg-orange-500/30">

      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/[0.07] bg-[#080a08]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-[74px] max-w-7xl items-center justify-between px-5 lg:px-8">
          <a href="#top" aria-label="Altivox AI home">
            <BrandMark />
          </a>

          <nav className="hidden items-center gap-8 text-[13px] font-semibold text-white/50 lg:flex">
            <a className="transition hover:text-white" href="#features">Tính năng</a>
            <a className="transition hover:text-white" href="#workflow">Cách hoạt động</a>
            <a className="transition hover:text-white" href="#plans">Gói dịch vụ</a>
            <a className="transition hover:text-white" href="#faq">FAQ</a>
          </nav>

          <div className="hidden items-center gap-3 sm:flex">
            {!session && (
              <Link
                to="/login"
                className="rounded-full px-4 py-2.5 text-[13px] font-bold text-white/55 transition hover:text-white"
              >
                Đăng nhập
              </Link>
            )}
            <Link
              to={primaryHref}
              className="group flex items-center gap-2 rounded-full bg-orange-500 px-5 py-2.5 text-[13px] font-extrabold text-white shadow-[0_12px_32px_rgba(249,115,22,.22)] transition hover:bg-orange-400"
            >
              {primaryLabel}
              <ArrowRight className="size-3.5 transition group-hover:translate-x-0.5" />
            </Link>
          </div>

          <button
            type="button"
            aria-label="Mở menu"
            onClick={() => setMenuOpen((value) => !value)}
            className="grid size-10 place-items-center rounded-xl border border-white/10 text-white sm:hidden"
          >
            {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>

        {menuOpen && (
          <div className="border-t border-white/[0.07] bg-[#0c0e0c] p-5 sm:hidden">
            <div className="flex flex-col gap-4 text-sm font-semibold text-white/60">
              <a href="#features" onClick={() => setMenuOpen(false)}>Tính năng</a>
              <a href="#workflow" onClick={() => setMenuOpen(false)}>Cách hoạt động</a>
              <a href="#plans" onClick={() => setMenuOpen(false)}>Gói dịch vụ</a>
              <a href="#faq" onClick={() => setMenuOpen(false)}>FAQ</a>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Link to="/login" className="rounded-xl border border-white/10 p-3 text-center">Đăng nhập</Link>
                <Link to={primaryHref} className="rounded-xl bg-orange-500 p-3 text-center text-white">{primaryLabel}</Link>
              </div>
            </div>
          </div>
        )}
      </header>

      <main id="top">
        <section className="lp-grid-bg relative overflow-hidden px-5 pb-32 pt-36 lg:px-8 lg:pb-40 lg:pt-48">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(249,115,22,.08),transparent_28%),linear-gradient(to_bottom,transparent_72%,#080a08)]" />
          <div className="relative mx-auto grid min-w-0 max-w-7xl items-center gap-20 lg:grid-cols-[0.92fr_1.08fr] lg:gap-12">
            <div className="min-w-0 max-w-2xl">
              <div className="lp-hero-badge inline-flex items-center gap-2 rounded-full border border-orange-500/25 bg-orange-500/[0.08] px-3.5 py-2 text-[10px] font-extrabold uppercase tracking-[0.18em] text-orange-400">
                <Sparkles className="size-3.5" />
                Telegram reseller infrastructure
              </div>
              <h1 className="lp-hero-title mt-7 text-[2.8rem] font-black leading-[0.98] tracking-[-0.055em] text-white min-[420px]:text-[3.25rem] sm:text-7xl sm:tracking-[-0.065em] lg:text-[5.35rem]">
                Bán hàng tự động.
                <span className="mt-1 block text-orange-500">
                  Tăng trưởng thật.
                </span>
              </h1>
              <p className="lp-hero-sub mt-7 max-w-xl text-base font-medium leading-8 text-white/48 sm:text-lg">
                Biến Telegram thành cửa hàng sản phẩm số vận hành 24/7 — từ nhận đơn,
                thanh toán đến giao hàng và bảo hành.
              </p>

              <div className="lp-hero-cta mt-9 flex flex-col gap-3 sm:flex-row">
                <Link
                  to={primaryHref}
                  className="lp-btn-magnetic group flex items-center justify-center gap-2.5 rounded-full bg-orange-500 px-7 py-4 text-sm font-extrabold text-white shadow-[0_18px_45px_rgba(249,115,22,.25)] transition hover:bg-orange-400"
                >
                  {primaryLabel}
                  <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
                </Link>
                <a
                  href="#workflow"
                  className="flex items-center justify-center gap-2.5 rounded-full border border-white/12 bg-white/[0.035] px-7 py-4 text-sm font-bold text-white/75 transition hover:border-white/25 hover:bg-white/[0.06]"
                >
                  Xem cách hoạt động
                </a>
              </div>

              <div className="lp-hero-checks mt-8 flex flex-wrap gap-x-6 gap-y-3 text-[11px] font-semibold text-white/35">
                {["Không cần biết code", "Khởi tạo miễn phí", "Thiết lập theo từng bước"].map((item) => (
                  <span key={item} className="flex items-center gap-2">
                    <span className="grid size-4 place-items-center rounded-full bg-emerald-400/10 text-emerald-400">
                      <Check className="size-2.5" strokeWidth={3} />
                    </span>
                    {item}
                  </span>
                ))}
              </div>
            </div>

            <div className="lp-hero-preview lp-dash-float min-w-0 pb-8">
              <DashboardPreview />
            </div>
          </div>
        </section>

        <div className="lp-section-divider" />
        <section className="bg-white/[0.018] px-5 py-7 lg:px-8">
          <div className="lp-reveal mx-auto grid max-w-7xl grid-cols-2 gap-5 md:grid-cols-4">
            {[
              [Clock3, "Vận hành", "24/7"],
              [PackageCheck, "Luồng đơn", "Tự động"],
              [CircleDollarSign, "Thanh toán", "Đa kênh"],
              [MessageCircleMore, "Bán hàng", "Trên Telegram"],
            ].map(([Icon, label, value]) => {
              const ItemIcon = Icon as typeof Clock3;
              return (
                <div key={String(label)} className="flex items-center gap-3 md:justify-center">
                  <ItemIcon className="size-4 text-orange-400" />
                  <div>
                    <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-white/25">{String(label)}</div>
                    <div className="mt-0.5 text-xs font-extrabold text-white/75">{String(value)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
        <div className="lp-section-divider" />

        <section id="features" className="px-5 py-28 lg:px-8 lg:py-36">
          <div className="mx-auto max-w-7xl">
            <div className="grid gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-end">
              <div className="lp-reveal">
                <div className="text-[10px] font-black uppercase tracking-[0.25em] text-orange-400">Một nền tảng duy nhất</div>
                <h2 className="mt-5 max-w-2xl text-4xl font-black leading-[1.05] tracking-[-0.045em] sm:text-6xl">
                  Từ tin nhắn đầu tiên đến đơn hàng hoàn tất.
                </h2>
              </div>
              <p className="lp-reveal lp-d2 max-w-xl text-sm leading-7 text-white/42 lg:ml-auto lg:text-base">
                Thay những thao tác rời rạc bằng một quy trình bán hàng thống nhất. Bạn tập trung vào sản phẩm và khách hàng, Altivox xử lý phần vận hành lặp lại.
              </p>
            </div>

            <div className="lp-reveal lp-d3 mt-16 grid gap-px overflow-hidden rounded-[28px] border border-white/[0.08] bg-white/[0.08] md:grid-cols-2">
              {benefits.map(({ icon: Icon, number, title, description }) => (
                <article key={title} className="lp-card-glow group relative min-h-[280px] bg-[#0c0f0c] p-7 transition hover:bg-[#111511] sm:p-10">
                  <div className="flex items-start justify-between">
                    <div className="grid size-12 place-items-center rounded-2xl border border-orange-500/20 bg-orange-500/[0.08] text-orange-400 transition group-hover:scale-105 group-hover:bg-orange-500/[0.14]">
                      <Icon className="size-5" />
                    </div>
                    <span className="font-mono text-[10px] text-white/20">/{number}</span>
                  </div>
                  <h3 className="mt-12 text-2xl font-extrabold tracking-[-0.03em]">{title}</h3>
                  <p className="mt-3 max-w-md text-sm leading-7 text-white/40">{description}</p>
                  <ArrowRight className="absolute bottom-9 right-9 size-5 -translate-x-2 text-orange-400 opacity-0 transition group-hover:translate-x-0 group-hover:opacity-100" />
                </article>
              ))}
            </div>
          </div>
        </section>

        <div className="lp-section-divider" />
        <section id="workflow" className="relative overflow-hidden bg-[#0d100d] px-5 py-28 lg:px-8 lg:py-36">
          <div className="pointer-events-none absolute right-[-10%] top-[-20%] size-[520px] rounded-full bg-orange-500/[0.07] blur-[120px]" />
          <div className="relative mx-auto max-w-7xl">
            <div className="lp-reveal max-w-2xl">
              <div className="text-[10px] font-black uppercase tracking-[0.25em] text-orange-400">Bắt đầu nhanh</div>
              <h2 className="mt-5 text-4xl font-black tracking-[-0.045em] sm:text-6xl">Mở shop trong 4 bước.</h2>
              <p className="mt-5 text-sm leading-7 text-white/42 sm:text-base">Dashboard dẫn bạn đi từ kết nối bot đến lúc nhận đơn đầu tiên.</p>
            </div>

            <div className="lp-reveal lp-d2 relative mt-16 grid gap-5 lg:grid-cols-4">
              <div className="lp-line-pulse absolute left-[12%] right-[12%] top-7 hidden h-px bg-gradient-to-r from-orange-500/0 via-orange-500/50 to-orange-500/0 lg:block" />
              {steps.map(([title, description], index) => (
                <article key={title} className="lp-card-glow relative rounded-2xl border border-white/[0.08] bg-[#080a08] p-6">
                  <div className="relative z-10 grid size-14 place-items-center rounded-full border border-orange-500/30 bg-[#111411] font-mono text-sm font-black text-orange-400 shadow-[0_0_0_8px_#0d100d]">
                    <div className="lp-pulse-ring" />
                    0{index + 1}
                  </div>
                  <h3 className="mt-9 text-lg font-extrabold">{title}</h3>
                  <p className="mt-3 text-sm leading-6 text-white/38">{description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <div className="lp-section-divider" />
        <section id="plans" className="px-5 py-28 lg:px-8 lg:py-36">
          <div className="mx-auto max-w-7xl">
            <div className="lp-reveal text-center">
              <div className="text-[10px] font-black uppercase tracking-[0.25em] text-orange-400">Đi đúng theo quy mô</div>
              <h2 className="mx-auto mt-5 max-w-3xl text-4xl font-black tracking-[-0.045em] sm:text-6xl">Bắt đầu như một shop. Lớn lên như một hệ thống.</h2>
            </div>

            <div className="mx-auto mt-16 grid max-w-5xl gap-5 lg:grid-cols-3">
              <article className="lp-reveal lp-d1 lp-card-glow flex min-h-[420px] flex-col rounded-[24px] border border-white/[0.09] bg-white/[0.025] p-7">
                <div className="text-xs font-black uppercase tracking-[0.2em] text-white/35">Free</div>
                <h3 className="mt-5 text-3xl font-black">Khám phá</h3>
                <p className="mt-3 text-sm leading-6 text-white/38">Làm quen dashboard trước khi vận hành shop thật.</p>
                <div className="my-7 h-px bg-white/[0.08]" />
                <ul className="space-y-3 text-sm text-white/55">
                  {["Tạo tài khoản miễn phí", "Khám phá dashboard", "Xem luồng vận hành"].map((item) => <li key={item} className="flex gap-2.5"><Check className="mt-0.5 size-4 text-emerald-400" />{item}</li>)}
                </ul>
                <Link to={primaryHref} className="mt-auto rounded-full border border-white/12 py-3.5 text-center text-sm font-bold transition hover:bg-white/[0.06]">Bắt đầu miễn phí</Link>
              </article>

              <article className="lp-reveal lp-d2 lp-shine relative flex min-h-[450px] flex-col overflow-hidden rounded-[24px] border border-orange-500/35 bg-orange-500/[0.075] p-7 shadow-[0_25px_90px_rgba(249,115,22,.08)]">
                <div className="absolute right-0 top-0 rounded-bl-2xl bg-orange-500 px-4 py-2 text-[9px] font-black uppercase tracking-[0.14em]">Phổ biến</div>
                <div className="text-xs font-black uppercase tracking-[0.2em] text-orange-400">Pro</div>
                <h3 className="mt-5 text-3xl font-black">Mở shop</h3>
                <p className="mt-3 text-sm leading-6 text-white/45">Cho reseller muốn bán hàng chuyên nghiệp trên Telegram.</p>
                <div className="my-7 h-px bg-orange-500/20" />
                <ul className="space-y-3 text-sm text-white/65">
                  {["Bot Telegram đầy đủ", "Sản phẩm, tồn kho và đơn hàng", "Thanh toán và giao tự động", "Khách hàng, affiliate, bảo hành"].map((item) => <li key={item} className="flex gap-2.5"><Check className="mt-0.5 size-4 text-orange-400" />{item}</li>)}
                </ul>
                <Link to={primaryHref} className="mt-auto flex items-center justify-center gap-2 rounded-full bg-orange-500 py-3.5 text-sm font-extrabold shadow-[0_14px_35px_rgba(249,115,22,.2)] transition hover:bg-orange-400">Mở shop Telegram <ArrowRight className="size-4" /></Link>
              </article>

              <article className="lp-reveal lp-d3 lp-card-glow flex min-h-[420px] flex-col rounded-[24px] border border-violet-400/20 bg-violet-400/[0.045] p-7">
                <div className="text-xs font-black uppercase tracking-[0.2em] text-violet-300">Ultra</div>
                <h3 className="mt-5 text-3xl font-black">Làm tổng sỉ</h3>
                <p className="mt-3 text-sm leading-6 text-white/38">Cho seller có nguồn hàng và mạng lưới đại lý riêng.</p>
                <div className="my-7 h-px bg-violet-400/15" />
                <ul className="space-y-3 text-sm text-white/55">
                  {["Toàn bộ tính năng PRO", "Cấp API key cho đại lý", "Đồng bộ catalog tự động", "Quản lý mạng lưới downstream"].map((item) => <li key={item} className="flex gap-2.5"><Check className="mt-0.5 size-4 text-violet-300" />{item}</li>)}
                </ul>
                <Link to={primaryHref} className="mt-auto rounded-full border border-violet-400/25 py-3.5 text-center text-sm font-bold text-violet-200 transition hover:bg-violet-400/10">Xây mạng lưới đại lý</Link>
              </article>
            </div>
          </div>
        </section>

        <div className="lp-section-divider" />
        <section id="faq" className="bg-[#0d100d] px-5 py-28 lg:px-8 lg:py-36">
          <div className="mx-auto grid max-w-7xl gap-14 lg:grid-cols-[0.7fr_1.3fr]">
            <div className="lp-reveal">
              <div className="text-[10px] font-black uppercase tracking-[0.25em] text-orange-400">FAQ</div>
              <h2 className="mt-5 text-4xl font-black tracking-[-0.045em] sm:text-5xl">Có thể bạn đang thắc mắc.</h2>
              <p className="mt-5 max-w-sm text-sm leading-7 text-white/40">Nếu chưa tìm thấy câu trả lời, đội ngũ Altivox luôn sẵn sàng hỗ trợ trên Telegram.</p>
              <a href="https://t.me/thaidem57" target="_blank" rel="noreferrer" className="mt-7 inline-flex items-center gap-2 text-sm font-bold text-orange-400 hover:text-orange-300">
                <Send className="size-4" /> Nhắn đội ngũ hỗ trợ
              </a>
            </div>
            <div className="lp-reveal lp-d2">
              {faqs.map((faq) => <FaqItem key={faq.question} {...faq} />)}
            </div>
          </div>
        </section>

        <div className="lp-section-divider" />
        <section className="relative overflow-hidden px-5 py-28 lg:px-8 lg:py-40">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(249,115,22,.1),transparent_38%)]" />
          <div className="lp-reveal relative mx-auto max-w-4xl text-center">
            <div className="relative mx-auto grid size-14 place-items-center rounded-2xl bg-orange-500 text-white shadow-[0_18px_60px_rgba(249,115,22,.28)]">
              <div className="lp-pulse-ring" />
              <Zap className="size-6" fill="currentColor" />
            </div>
            <h2 className="mt-8 text-4xl font-black tracking-[-0.05em] sm:text-6xl lg:text-7xl">Sẵn sàng để shop tự vận hành?</h2>
            <p className="mx-auto mt-6 max-w-2xl text-base leading-8 text-white/45">Tạo tài khoản miễn phí hôm nay. Kết nối bot và nâng cấp khi bạn sẵn sàng nhận đơn thật.</p>
            <Link to={primaryHref} className="lp-btn-magnetic group mt-9 inline-flex items-center gap-2.5 rounded-full bg-orange-500 px-8 py-4 text-sm font-extrabold text-white shadow-[0_18px_45px_rgba(249,115,22,.24)] transition hover:bg-orange-400">
              {primaryLabel}<ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/[0.07] px-5 py-10 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
          <BrandMark />
          <div className="flex flex-wrap gap-x-6 gap-y-3 text-xs font-semibold text-white/30">
            <a href="#features" className="hover:text-white">Tính năng</a>
            <a href="#plans" className="hover:text-white">Gói dịch vụ</a>
            <a href="#faq" className="hover:text-white">FAQ</a>
            <Link to="/login" className="hover:text-white">Đăng nhập</Link>
          </div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/20">© {new Date().getFullYear()} Altivox Ecosystem</p>
        </div>
      </footer>
    </div>
  );
}
