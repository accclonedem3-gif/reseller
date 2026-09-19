import {
  AlertCircle,
  ArrowRight,
  Award,
  Bot,
  Box,
  Boxes,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Copy,
  CreditCard,
  ExternalLink,
  Gift,
  Layers,
  Lock,
  Menu,
  MessageCircle,
  Package,
  QrCode,
  Radio,
  RefreshCw,
  Send,
  Server,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  Terminal,
  TrendingUp,
  Users,
  Wallet,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState, useCallback } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "@/auth/auth-provider";
import { useScrollReveal } from "@/hooks/use-scroll-reveal";
import "./landing-animations.css";

// ── HIGH-END 2D CANVAS PLEXUS (Smooth Anti-Aliased Celestial Network) ───────
function HeroCanvasPlexus() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let displayWidth = canvas.offsetWidth;
    let displayHeight = canvas.offsetHeight;

    canvas.width = displayWidth * dpr;
    canvas.height = displayHeight * dpr;
    ctx.scale(dpr, dpr);

    const handleResize = () => {
      if (!canvas) return;
      displayWidth = canvas.offsetWidth;
      displayHeight = canvas.offsetHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = displayWidth * dpr;
      canvas.height = displayHeight * dpr;
      ctx.scale(dpr, dpr);
    };

    window.addEventListener("resize", handleResize);

    const nodeCount = displayWidth < 768 ? 40 : 75;
    interface Node {
      x: number;
      y: number;
      vx: number;
      vy: number;
      radius: number;
      alpha: number;
      color: string;
      glow: boolean;
    }

    const nodes: Node[] = [];
    const colors = [
      "249, 115, 22",  // #f97316 Radiant Orange
      "251, 146, 60",  // #fb923c Warm Orange
      "245, 158, 11",  // #f59e0b Amber
      "253, 186, 116", // #fdba74 Soft Peach
    ];

    for (let i = 0; i < nodeCount; i++) {
      nodes.push({
        x: Math.random() * displayWidth,
        y: Math.random() * displayHeight,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        radius: Math.random() * 1.8 + 1.2,
        alpha: Math.random() * 0.55 + 0.35,
        color: colors[Math.floor(Math.random() * colors.length)]!,
        glow: Math.random() > 0.65,
      });
    }

    let mouseX = -9999;
    let mouseY = -9999;

    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseX = e.clientX - rect.left;
      mouseY = e.clientY - rect.top;
    };

    const onMouseLeave = () => {
      mouseX = -9999;
      mouseY = -9999;
    };

    window.addEventListener("mousemove", onMouseMove, { passive: true });
    document.addEventListener("mouseleave", onMouseLeave);

    const maxDist = 120;
    const maxDistSq = maxDist * maxDist;

    const render = () => {
      ctx.clearRect(0, 0, displayWidth, displayHeight);

      for (let i = 0; i < nodes.length; i++) {
        const p = nodes[i]!;

        // Subtle gentle mouse attraction / repulsion
        const dxM = mouseX - p.x;
        const dyM = mouseY - p.y;
        const distMSq = dxM * dxM + dyM * dyM;
        if (distMSq < 22500 && distMSq > 0) {
          const distM = Math.sqrt(distMSq);
          const force = (1 - distM / 150) * 0.7;
          p.x -= (dxM / distM) * force;
          p.y -= (dyM / distM) * force;
        }

        p.x += p.vx;
        p.y += p.vy;

        if (p.x < 0) { p.x = 0; p.vx *= -1; }
        else if (p.x > displayWidth) { p.x = displayWidth; p.vx *= -1; }
        if (p.y < 0) { p.y = 0; p.vy *= -1; }
        else if (p.y > displayHeight) { p.y = displayHeight; p.vy *= -1; }

        // Connecting lines
        for (let j = i + 1; j < nodes.length; j++) {
          const p2 = nodes[j]!;
          const dx = p.x - p2.x;
          const dy = p.y - p2.y;
          const dSq = dx * dx + dy * dy;

          if (dSq < maxDistSq) {
            const dist = Math.sqrt(dSq);
            const lineAlpha = (1 - dist / maxDist) * 0.18;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = `rgba(249, 115, 22, ${lineAlpha})`;
            ctx.lineWidth = 0.75;
            ctx.stroke();
          }
        }

        // Circular anti-aliased dot
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.color}, ${p.alpha})`;
        ctx.fill();

        // Glowing halo on selected nodes
        if (p.glow) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius * 2.8, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${p.color}, 0.12)`;
          ctx.fill();
        }
      }

      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseleave", onMouseLeave);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none z-0 opacity-75"
    />
  );
}

// ── SPOTLIGHT CARD (Linear / Vercel Aesthetic Hover Light Beam) ─────────────
function SpotlightCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [opacity, setOpacity] = useState(0);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!divRef.current) return;
    const rect = divRef.current.getBoundingClientRect();
    setPosition({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  return (
    <div
      ref={divRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setOpacity(1)}
      onMouseLeave={() => setOpacity(0)}
      className={`relative overflow-hidden rounded-2xl border border-[#363850] bg-[#252840]/90 backdrop-blur-xl transition-all duration-300 hover:border-orange-500/50 hover:shadow-2xl hover:shadow-orange-500/10 ${className}`}
    >
      <div
        className="pointer-events-none absolute -inset-px transition-opacity duration-300 z-0"
        style={{
          opacity,
          background: `radial-gradient(450px circle at ${position.x}px ${position.y}px, rgba(249, 115, 22, 0.16), transparent 70%)`,
        }}
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
}

// ── Hook: Count Up Animation ────────────────────────────────────────────────
function useCountUp(target: number, duration = 1800) {
  const [value, setValue] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => {
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
      },
      { threshold: 0.25 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [target, duration]);
  return { ref, value };
}

// ── Interactive Telegram Simulator ──────────────────────────────────────────
type SimStep = "welcome" | "product_selected" | "payment_qr" | "success";

interface SimProduct {
  id: string;
  name: string;
  priceVnd: string;
  priceUsd: string;
  badge: string;
  stock: number;
}

const SIM_PRODUCTS: SimProduct[] = [
  { id: "netflix", name: "🎬 Netflix Premium 1T", priceVnd: "65.000đ", priceUsd: "$2.60", badge: "Hot", stock: 142 },
  { id: "chatgpt", name: "🤖 ChatGPT Plus (Mail Riêng)", priceVnd: "450.000đ", priceUsd: "$18.00", badge: "Auto 2s", stock: 38 },
  { id: "spotify", name: "🎵 Spotify Premium 1 Năm", priceVnd: "220.000đ", priceUsd: "$8.80", badge: "Bảo hành", stock: 85 },
  { id: "telegram", name: "💎 Telegram Premium 3T", priceVnd: "190.000đ", priceUsd: "$7.60", badge: "Sale", stock: 210 },
];

function TelegramSimulator() {
  const [step, setStep] = useState<SimStep>("welcome");
  const [selectedProduct, setSelectedProduct] = useState<SimProduct>(SIM_PRODUCTS[0]!);
  const [isTyping, setIsTyping] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    setTimeout(() => {
      if (chatScrollRef.current) {
        chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
      }
    }, 60);
  };

  const handleSelectProduct = (prod: SimProduct) => {
    setSelectedProduct(prod);
    setIsTyping(true);
    setTimeout(() => {
      setIsTyping(false);
      setStep("product_selected");
      scrollToBottom();
    }, 450);
  };

  const handleChoosePayment = () => {
    setIsTyping(true);
    setTimeout(() => {
      setIsTyping(false);
      setStep("payment_qr");
      scrollToBottom();
    }, 500);
  };

  const handleSimulatePayment = () => {
    setIsTyping(true);
    setTimeout(() => {
      setIsTyping(false);
      setStep("success");
      setShowCelebration(true);
      setTimeout(() => setShowCelebration(false), 3500);
      scrollToBottom();
    }, 850);
  };

  const handleReset = () => {
    setStep("welcome");
    setShowCelebration(false);
    scrollToBottom();
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="w-full max-w-[490px] mx-auto rounded-2xl overflow-hidden shadow-2xl border border-[#363850] bg-[#1a1d2e] text-slate-100 font-sans text-sm backdrop-blur-xl transition-all duration-300 hover:border-orange-500/50 hover:shadow-orange-500/10 relative">
      {/* Celebration particle bursts */}
      {showCelebration && (
        <div className="absolute inset-0 pointer-events-none z-30 flex items-center justify-center overflow-hidden">
          <div className="absolute w-32 h-32 bg-orange-500/20 rounded-full animate-ping" />
          <div className="text-2xl animate-bounce">🎉 ⚡ 🚀</div>
        </div>
      )}

      {/* Telegram App Header */}
      <div className="bg-[#252840] px-4 py-3 border-b border-[#363850] flex items-center justify-between select-none">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-orange-500 to-amber-400 flex items-center justify-center font-bold text-white shadow-md">
              <Bot className="w-5 h-5" />
            </div>
            <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 rounded-full border-2 border-[#252840]" />
          </div>
          <div>
            <div className="flex items-center gap-1.5 font-semibold text-white text-sm">
              <span>Altivox Shop Bot</span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-orange-500/20 text-orange-400 border border-orange-500/30">
                VERIFIED
              </span>
            </div>
            <div className="text-[11px] text-emerald-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Tự động giao hàng 24/7 (2 giây)
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleReset}
            title="Thử lại kịch bản"
            className="px-2.5 py-1 rounded-lg bg-[#1a1d2e] hover:bg-slate-800 text-xs text-slate-300 flex items-center gap-1.5 border border-[#363850] transition-colors"
          >
            <RefreshCw className="w-3 h-3 text-orange-400" />
            Reset
          </button>
        </div>
      </div>

      {/* Simulator Chat Body */}
      <div
        ref={chatScrollRef}
        className="p-4 space-y-3.5 h-[410px] overflow-y-auto bg-[#131624] bg-[radial-gradient(#252840_1px,transparent_1px)] [background-size:16px_16px]"
      >
        {/* System Date Badge */}
        <div className="flex justify-center">
          <span className="px-3 py-0.5 rounded-full text-[11px] bg-[#252840] text-slate-400 border border-[#363850]">
            Hôm nay • Trải nghiệm thực tế của khách hàng
          </span>
        </div>

        {/* Message 1: Initial Bot Greeting */}
        <div className="flex gap-2 max-w-[92%] lp-msg-pop">
          <div className="w-7 h-7 rounded-full bg-orange-500/20 border border-orange-500/30 flex-shrink-0 flex items-center justify-center text-orange-400 mt-1">
            <Bot className="w-3.5 h-3.5" />
          </div>
          <div className="bg-[#252840] rounded-2xl rounded-tl-sm p-3 shadow-md border border-[#363850] space-y-2">
            <p className="text-xs leading-relaxed text-slate-200">
              👋 Chào mừng bạn đến với <b>Altivox Digital Store</b>!
              <br />
              ⚡ Hệ thống giao tài khoản tự động <b>24/7</b>, thanh toán nhận hàng sau <b>2 giây</b>.
            </p>
            <p className="text-xs text-slate-400 font-medium">
              Vui lòng chọn sản phẩm bạn muốn đặt:
            </p>

            {/* Inline Product Buttons */}
            <div className="grid grid-cols-2 gap-1.5 pt-1">
              {SIM_PRODUCTS.map((prod) => (
                <button
                  key={prod.id}
                  onClick={() => handleSelectProduct(prod)}
                  className={`text-left p-2 rounded-xl border text-xs transition-all duration-200 flex flex-col justify-between ${
                    selectedProduct.id === prod.id && step !== "welcome"
                      ? "bg-orange-500/20 border-orange-500/70 text-white shadow-sm"
                      : "bg-[#1a1d2e] border-[#363850] hover:border-orange-500/50 text-slate-200 hover:bg-[#202438]"
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="font-semibold truncate text-[11px]">{prod.name}</span>
                  </div>
                  <div className="flex items-center justify-between mt-1 text-[10px]">
                    <span className="text-orange-400 font-bold">{prod.priceVnd}</span>
                    <span className="text-slate-400">Kho: {prod.stock}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* User Selection Message */}
        {step !== "welcome" && (
          <div className="flex justify-end lp-msg-pop">
            <div className="bg-orange-600 text-white rounded-2xl rounded-tr-sm px-3.5 py-2 text-xs shadow-md max-w-[80%]">
              Tôi muốn mua: <b>{selectedProduct.name}</b>
            </div>
          </div>
        )}

        {/* Message 2: Order Summary & Payment Choice */}
        {step !== "welcome" && (
          <div className="flex gap-2 max-w-[92%] lp-msg-pop">
            <div className="w-7 h-7 rounded-full bg-orange-500/20 border border-orange-500/30 flex-shrink-0 flex items-center justify-center text-orange-400 mt-1">
              <Bot className="w-3.5 h-3.5" />
            </div>
            <div className="bg-[#252840] rounded-2xl rounded-tl-sm p-3 shadow-md border border-[#363850] space-y-2.5 w-full">
              <div className="text-xs font-semibold text-white border-b border-[#363850] pb-1.5 flex items-center justify-between">
                <span>📦 Thông tin đơn hàng #{Math.floor(Math.random() * 89999 + 10000)}</span>
                <span className="text-emerald-400 text-[10px]">Sẵn hàng trong kho</span>
              </div>

              <div className="space-y-1 text-xs text-slate-300">
                <div className="flex justify-between">
                  <span className="text-slate-400">Sản phẩm:</span>
                  <span className="font-semibold text-white">{selectedProduct.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Số tiền VND:</span>
                  <span className="text-orange-400 font-bold font-mono">{selectedProduct.priceVnd}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Quy đổi USD:</span>
                  <span className="text-cyan-400 font-mono">{selectedProduct.priceUsd} USDT</span>
                </div>
              </div>

              {step === "product_selected" && (
                <div className="pt-1 flex gap-2">
                  <button
                    onClick={handleChoosePayment}
                    className="w-full py-2 px-3 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-bold text-xs shadow-md transition-all flex items-center justify-center gap-1.5"
                  >
                    <QrCode className="w-3.5 h-3.5" />
                    <span>Thanh Toán VietQR / USDT</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Message 3: QR Code & Payment Instruction */}
        {(step === "payment_qr" || step === "success") && (
          <div className="flex gap-2 max-w-[92%] lp-msg-pop">
            <div className="w-7 h-7 rounded-full bg-orange-500/20 border border-orange-500/30 flex-shrink-0 flex items-center justify-center text-orange-400 mt-1">
              <Bot className="w-3.5 h-3.5" />
            </div>
            <div className="bg-[#252840] rounded-2xl rounded-tl-sm p-3.5 shadow-md border border-[#363850] space-y-3 w-full">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-white flex items-center gap-1.5">
                  <CreditCard className="w-3.5 h-3.5 text-orange-400" />
                  Mã QR Thanh Toán Tự Động
                </span>
                <span className="text-amber-400 font-mono text-[11px] animate-pulse">
                  ⏱ Hết hạn: 04:58
                </span>
              </div>

              {/* Mock QR visual */}
              <div className="bg-white p-3 rounded-xl flex items-center justify-center max-w-[170px] mx-auto shadow-inner">
                <div className="text-center space-y-1">
                  <div className="w-32 h-32 bg-[#1a1d2e] rounded-lg p-2 flex flex-col items-center justify-center text-white relative">
                    <QrCode className="w-20 h-20 text-orange-400" />
                    <div className="text-[8px] uppercase tracking-widest text-slate-400 mt-1 font-mono">
                      VIETQR 24/7
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-[#1a1d2e] p-2.5 rounded-xl border border-[#363850] text-[11px] space-y-1 font-mono">
                <div className="flex justify-between">
                  <span className="text-slate-400">Ngân hàng:</span>
                  <span className="text-white font-semibold">MBBANK (Quân Đội)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Số tiền:</span>
                  <span className="text-emerald-400 font-bold">{selectedProduct.priceVnd}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Nội dung CK:</span>
                  <span className="text-orange-400 font-bold">ALTIVOX 89201</span>
                </div>
              </div>

              {step === "payment_qr" && (
                <button
                  onClick={handleSimulatePayment}
                  className="w-full py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg shadow-emerald-600/20 transition-all flex items-center justify-center gap-1.5 animate-pulse"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Tôi Đã Chuyển Khoản (Giả Lập)</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Message 4: Instant Automated Delivery */}
        {step === "success" && (
          <div className="flex gap-2 max-w-[92%] lp-msg-pop">
            <div className="w-7 h-7 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex-shrink-0 flex items-center justify-center text-emerald-400 mt-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
            </div>
            <div className="bg-[#252840] rounded-2xl rounded-tl-sm p-3.5 shadow-md border border-emerald-500/40 space-y-2.5 w-full">
              <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400">
                <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                <span>Thanh toán thành công! Giao hàng tự động sau 1.8s</span>
              </div>

              <div className="p-2.5 rounded-xl bg-[#1a1d2e] border border-emerald-500/30 text-xs font-mono space-y-1">
                <div className="text-slate-400 text-[10px]">Tài khoản bàn giao:</div>
                <div className="text-emerald-300 font-semibold select-all break-all">
                  vip_customer_99@altivox.io | Pass: P@ssw0rd2026!
                </div>
                <div className="pt-1 flex items-center justify-between text-[10px]">
                  <span className="text-slate-400">Hạn sử dụng: 30 ngày</span>
                  <button
                    onClick={() => handleCopy("vip_customer_99@altivox.io | Pass: P@ssw0rd2026!")}
                    className="text-orange-400 hover:underline flex items-center gap-1"
                  >
                    <Copy className="w-3 h-3" />
                    <span>{copied ? "Đã chép!" : "Sao chép"}</span>
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-1.5 text-[11px] text-slate-300">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Đã kích hoạt bảo hành 1-đổi-1 tự động trên Bot.</span>
              </div>
            </div>
          </div>
        )}

        {/* Typing indicator */}
        {isTyping && (
          <div className="flex gap-2 items-center text-xs text-slate-400 lp-msg-pop">
            <div className="w-7 h-7 rounded-full bg-orange-500/20 flex items-center justify-center text-orange-400">
              <Bot className="w-3.5 h-3.5" />
            </div>
            <div className="bg-[#252840] rounded-xl px-3 py-1.5 flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-orange-400 rounded-full lp-typing-dot-1" />
              <span className="w-1.5 h-1.5 bg-orange-400 rounded-full lp-typing-dot-2" />
              <span className="w-1.5 h-1.5 bg-orange-400 rounded-full lp-typing-dot-3" />
            </div>
          </div>
        )}
      </div>

      {/* Simulator Bottom Bar */}
      <div className="bg-[#252840] px-4 py-2.5 border-t border-[#363850] flex items-center justify-between text-xs text-slate-400">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
          <span>Thời gian phản hồi thực tế: <b>1.8s</b></span>
        </div>
        <span className="text-slate-400 text-[11px]">Telegram Bot API v7.2</span>
      </div>
    </div>
  );
}

// ── Main Landing Page Component ─────────────────────────────────────────────
export function LandingPage() {
  const { session } = useAuth();
  const revealRef = useScrollReveal();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeFaq, setActiveFaq] = useState<number | null>(0);
  const [annualBilling, setAnnualBilling] = useState(false);

  // Force dark mode on mount so body, CSS vars and backgrounds are unified
  useEffect(() => {
    const prevTheme = localStorage.getItem("theme");
    document.documentElement.classList.add("dark");
    document.documentElement.style.colorScheme = "dark";
    return () => {
      if (prevTheme !== "dark") {
        document.documentElement.classList.remove("dark");
        document.documentElement.style.colorScheme = "light";
      }
    };
  }, []);

  // Counters
  const countOrders = useCountUp(150000, 1600);
  const countUptime = useCountUp(99, 1400);
  const countBots = useCountUp(2400, 1800);

  return (
    <div
      ref={revealRef}
      style={{ backgroundColor: "#1a1d2e", color: "#f8fafc" }}
      className="min-h-screen bg-[#1a1d2e] text-[#f8fafc] font-sans selection:bg-orange-500 selection:text-white relative overflow-x-hidden"
    >
      {/* Dynamic Ambient Background Glows matching web theme */}
      <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[1100px] h-[650px] bg-gradient-to-b from-orange-500/15 via-orange-500/5 to-transparent blur-[130px] lp-ambient-glow" />
      <div className="pointer-events-none absolute top-[900px] right-0 w-[550px] h-[550px] bg-indigo-500/10 blur-[150px]" />
      <div className="pointer-events-none absolute top-[1900px] left-0 w-[600px] h-[600px] bg-orange-600/10 blur-[160px]" />

      {/* ── Navigation Bar ────────────────────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#1a1d2e]/90 backdrop-blur-xl border-b border-[#363850] transition-all">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Brand Logo matching login-page-studio.tsx */}
          <Link to="/" className="flex items-center gap-3 group">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-orange-500 text-white shadow-lg shadow-orange-500/30 group-hover:scale-105 transition-transform">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div className="flex flex-col">
              <div className="text-lg font-black uppercase tracking-tight text-[#f8fafc]">
                Altivox <span className="text-orange-500">AI</span>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#94a3b8] -mt-1 hidden sm:block">
                Reseller Platform
              </span>
            </div>
          </Link>

          {/* Desktop Links */}
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-300">
            <a href="#features" className="hover:text-orange-400 transition-colors">
              Tính Năng
            </a>
            <a href="#simulator" className="hover:text-orange-400 transition-colors flex items-center gap-1.5">
              <span>Demo Bot</span>
              <span className="px-1.5 py-0.2 text-[10px] rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                Live
              </span>
            </a>
            <a href="#compare" className="hover:text-orange-400 transition-colors">
              So Sánh
            </a>
            <a href="#pricing" className="hover:text-orange-400 transition-colors">
              Bảng Giá
            </a>
            <a href="#faq" className="hover:text-orange-400 transition-colors">
              Hỏi Đáp
            </a>
          </div>

          {/* Action CTAs */}
          <div className="hidden sm:flex items-center gap-3">
            {session?.user ? (
              <Link
                to="/dashboard"
                className="px-4 py-2 rounded-xl text-sm font-semibold bg-orange-500 hover:bg-orange-600 text-white shadow-md shadow-orange-500/20 transition-all flex items-center gap-1.5"
              >
                Vào Dashboard
                <ArrowRight className="w-4 h-4" />
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  className="px-4 py-2 rounded-xl text-sm font-medium text-slate-300 hover:text-white hover:bg-white/5 transition-all"
                >
                  Đăng nhập
                </Link>
                <Link
                  to="/register"
                  className="lp-btn-radiant px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white shadow-lg shadow-orange-500/25 flex items-center gap-1.5 transition-all"
                >
                  Tạo Bot Ngay
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </>
            )}
          </div>

          {/* Mobile menu toggle */}
          <div className="sm:hidden flex items-center">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 rounded-lg bg-[#252840] border border-[#363850] text-slate-300"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile menu dropdown */}
        {mobileMenuOpen && (
          <div className="sm:hidden bg-[#1a1d2e] border-b border-[#363850] px-4 py-4 space-y-3">
            <a
              href="#features"
              onClick={() => setMobileMenuOpen(false)}
              className="block text-slate-300 hover:text-orange-400 font-medium text-sm py-1.5"
            >
              Tính Năng
            </a>
            <a
              href="#simulator"
              onClick={() => setMobileMenuOpen(false)}
              className="block text-slate-300 hover:text-orange-400 font-medium text-sm py-1.5"
            >
              Demo Bot Trực Tiếp
            </a>
            <a
              href="#compare"
              onClick={() => setMobileMenuOpen(false)}
              className="block text-slate-300 hover:text-orange-400 font-medium text-sm py-1.5"
            >
              So Sánh Thủ Công vs Auto
            </a>
            <a
              href="#pricing"
              onClick={() => setMobileMenuOpen(false)}
              className="block text-slate-300 hover:text-orange-400 font-medium text-sm py-1.5"
            >
              Bảng Giá
            </a>
            <a
              href="#faq"
              onClick={() => setMobileMenuOpen(false)}
              className="block text-slate-300 hover:text-orange-400 font-medium text-sm py-1.5"
            >
              Hỏi Đáp
            </a>
            <div className="pt-3 border-t border-[#363850] flex flex-col gap-2">
              <Link
                to="/login"
                className="w-full text-center py-2 rounded-xl text-sm font-medium bg-[#252840] text-slate-200 border border-[#363850]"
              >
                Đăng nhập
              </Link>
              <Link
                to="/register"
                className="w-full text-center py-2 rounded-xl text-sm font-semibold bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-lg"
              >
                Tạo Bot Miễn Phí
              </Link>
            </div>
          </div>
        )}
      </nav>

      {/* ── HERO SECTION WITH INTERACTIVE CANVAS PLEXUS ───────────── */}
      <section
        style={{ backgroundColor: "#1a1d2e" }}
        className="pt-28 pb-20 md:pt-36 md:pb-28 relative overflow-hidden bg-[#1a1d2e]"
      >
        {/* Ambient Gradient Orbs */}
        <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[550px] bg-gradient-to-b from-orange-500/18 via-orange-500/5 to-transparent blur-[120px]" />
        <div className="pointer-events-none absolute top-[25%] right-[-5%] w-[450px] h-[450px] bg-indigo-500/10 blur-[140px]" />

        {/* Smooth Anti-Aliased 2D Canvas Plexus */}
        <HeroCanvasPlexus />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center">
            {/* Left Column: Hero Pitch */}
            <div className="lg:col-span-7 space-y-7 text-center lg:text-left">
              {/* Shimmer Badge */}
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-orange-500/30 bg-orange-500/10 text-xs font-semibold text-orange-300 backdrop-blur-md lp-hero-anim-1">
                <Sparkles className="w-3.5 h-3.5 text-amber-400 animate-spin" />
                <span>Nền tảng Tự Động Hóa Telegram Reseller 4.0</span>
                <span className="w-1 h-1 rounded-full bg-orange-400" />
                <span className="text-white/80">Không Cần Biết Code</span>
              </div>

              {/* Main Headline */}
              <h1 className="text-4xl sm:text-5xl md:text-6xl font-black uppercase tracking-tight text-white leading-[1.12] lp-hero-anim-2">
                Biến Telegram Thành{" "}
                <span className="bg-clip-text text-transparent bg-gradient-to-r from-orange-400 via-amber-300 to-yellow-400">
                  Cỗ Máy Bán Hàng Tự Động
                </span>{" "}
                24/7 Không Nghỉ
              </h1>

              {/* Subtitle */}
              <p className="text-base sm:text-lg text-slate-300 leading-relaxed max-w-2xl mx-auto lg:mx-0 lp-hero-anim-3">
                Đồng bộ đa nguồn kho sỉ, thanh toán <b className="text-white">VietQR & USDT tự động khớp 2 giây</b>,
                tự check tài khoản và bảo hành 1-đổi-1. Quản lý doanh thu VND/USD chuẩn xác
                ngay cả khi bạn đang ngủ.
              </p>

              {/* Primary Call To Actions */}
              <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4 pt-2 lp-hero-anim-4">
                <Link
                  to="/register"
                  className="lp-btn-radiant w-full sm:w-auto px-7 py-3.5 rounded-xl font-bold text-base bg-gradient-to-r from-orange-500 via-amber-500 to-orange-600 text-white shadow-xl shadow-orange-500/30 hover:shadow-orange-500/45 flex items-center justify-center gap-2 group transition-all"
                >
                  <span>Tạo Bot Miễn Phí Ngay</span>
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </Link>
                <a
                  href="#simulator"
                  className="w-full sm:w-auto px-6 py-3.5 rounded-xl font-semibold text-base text-slate-200 hover:text-white bg-[#252840] hover:bg-slate-800 border border-[#363850] hover:border-orange-500/50 transition-all flex items-center justify-center gap-2 shadow-sm"
                >
                  <Bot className="w-5 h-5 text-orange-400" />
                  <span>Trải Nghiệm Demo Bot</span>
                </a>
              </div>

              {/* Social Proof Badges */}
              <div className="pt-4 flex flex-wrap items-center justify-center lg:justify-start gap-6 text-xs text-slate-300 lp-hero-anim-5">
                <div className="flex items-center gap-2">
                  <div className="flex -space-x-2">
                    {[1, 2, 3, 4].map((i) => (
                      <div
                        key={i}
                        className="w-6 h-6 rounded-full bg-[#252840] border-2 border-[#1a1d2e] flex items-center justify-center text-[9px] font-bold text-slate-300"
                      >
                        U{i}
                      </div>
                    ))}
                  </div>
                  <span><b className="text-white">2,400+</b> chủ shop tin dùng</span>
                </div>
                <div className="flex items-center gap-1.5 text-amber-400 font-medium">
                  <Star className="w-4 h-4 fill-amber-400" />
                  <span className="text-slate-200"><b className="text-amber-400">4.9/5</b> Đánh giá hài lòng</span>
                </div>
                <div className="flex items-center gap-1.5 text-emerald-400 font-medium">
                  <ShieldCheck className="w-4 h-4" />
                  <span>An toàn 100% qua API</span>
                </div>
              </div>
            </div>

            {/* Right Column: Live Interactive Telegram Simulator */}
            <div id="simulator" className="lg:col-span-5 relative scroll-mt-24">
              <div className="absolute -inset-4 bg-gradient-to-tr from-orange-500/20 via-amber-500/10 to-transparent rounded-3xl blur-2xl -z-10" />
              <TelegramSimulator />
            </div>
          </div>
        </div>
      </section>

      {/* ── LIVE STATS STRIP ─────────────────────────────────────── */}
      <section className="py-12 border-y border-[#363850] bg-[#141624] backdrop-blur-md relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 text-center">
            {/* Stat 1 */}
            <div ref={countOrders.ref} className="space-y-1.5">
              <div className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight font-mono">
                {countOrders.value.toLocaleString()}+
              </div>
              <div className="text-xs sm:text-sm text-slate-400 font-medium">
                Đơn hàng tự động / tháng
              </div>
            </div>

            {/* Stat 2 */}
            <div className="space-y-1.5">
              <div className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight font-mono">
                &lt; 2.0s
              </div>
              <div className="text-xs sm:text-sm text-slate-400 font-medium">
                Tốc độ thanh toán & giao kho
              </div>
            </div>

            {/* Stat 3 */}
            <div ref={countUptime.ref} className="space-y-1.5">
              <div className="text-3xl sm:text-4xl font-extrabold text-emerald-400 tracking-tight font-mono">
                {countUptime.value}.98%
              </div>
              <div className="text-xs sm:text-sm text-slate-400 font-medium">
                Hệ thống vận hành liên tục
              </div>
            </div>

            {/* Stat 4 */}
            <div ref={countBots.ref} className="space-y-1.5">
              <div className="text-3xl sm:text-4xl font-extrabold text-orange-400 tracking-tight font-mono">
                {countBots.value.toLocaleString()}+
              </div>
              <div className="text-xs sm:text-sm text-slate-400 font-medium">
                Telegram Bot đang hoạt động
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── BENTO GRID: 4 CORE ARCHITECTURAL PILLARS WITH SPOTLIGHT ─ */}
      <section id="features" className="py-24 relative scroll-mt-16 bg-[#1a1d2e]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Section Header */}
          <div className="text-center max-w-3xl mx-auto space-y-4 mb-16 lp-reveal">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/10 text-orange-400 border border-orange-500/20 text-xs font-semibold">
              <Boxes className="w-3.5 h-3.5" />
              <span>HỆ THỐNG VẬN HÀNH THẾ HỆ MỚI</span>
            </div>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black uppercase text-white tracking-tight">
              Tất Cả Công Cụ Bạn Cần Để{" "}
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-orange-400 to-amber-300">
                Tăng Trưởng Doanh Thu
              </span>
            </h2>
            <p className="text-base text-slate-300">
              Kiến trúc hiện đại giúp bạn loại bỏ 100% thao tác thủ công, tập trung tìm kiếm khách hàng
              và mở rộng kinh doanh.
            </p>
          </div>

          {/* Bento Grid */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
            {/* Card 1: Multi-source Smart Inventory (Spans 8 cols) */}
            <SpotlightCard className="md:col-span-12 lg:col-span-8 p-8 lp-reveal">
              <div className="relative z-10 flex flex-col justify-between h-full space-y-6">
                <div className="space-y-3">
                  <div className="w-12 h-12 rounded-2xl bg-orange-500/10 border border-orange-500/30 flex items-center justify-center text-orange-400 shadow-md">
                    <Boxes className="w-6 h-6" />
                  </div>
                  <h3 className="text-2xl font-bold text-white tracking-tight">
                    Kho Hàng Đa Nguồn & Tự So Sánh Giá Rẻ Nhất
                  </h3>
                  <p className="text-slate-300 text-sm leading-relaxed max-w-xl">
                    Kết nối không giới hạn các API nguồn (DongVan, Taphoammo, Hotmail, v.v.) hoặc kho nội bộ.
                    Hệ thống tự động so sánh nguồn giá rẻ nhất khi khách bấm mua, tự đổi nguồn dự phòng
                    khi một kho hết hàng, và tự động đồng bộ tỷ giá <b>VND & USD</b> thời gian thực.
                  </p>
                </div>

                {/* Mock UI: Multi-provider Sync */}
                <div className="bg-[#1a1d2e] rounded-2xl p-4 border border-[#363850] space-y-2.5 font-mono text-xs">
                  <div className="flex items-center justify-between text-slate-400 pb-2 border-b border-[#363850] font-sans">
                    <span className="flex items-center gap-1.5 font-semibold text-slate-200">
                      <Server className="w-3.5 h-3.5 text-orange-400" />
                      Nhà Cung Cấp Đang Kết Nối (Active Failover)
                    </span>
                    <span className="text-[11px] text-emerald-400 font-mono">3/3 Sẵn sàng</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
                    <div className="bg-[#252840] p-2.5 rounded-xl border border-emerald-500/40 flex flex-col justify-between">
                      <div className="flex items-center justify-between">
                        <span className="text-white font-semibold">DongVan API</span>
                        <span className="w-2 h-2 rounded-full bg-emerald-400" />
                      </div>
                      <div className="text-emerald-400 font-bold mt-1">42,000đ (Thấp nhất)</div>
                      <span className="text-[10px] text-slate-400 mt-1">Kho: 1,820 • Tự chọn</span>
                    </div>

                    <div className="bg-[#252840] p-2.5 rounded-xl border border-[#363850] flex flex-col justify-between">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-300 font-semibold">Taphoammo API</span>
                        <span className="w-2 h-2 rounded-full bg-emerald-400" />
                      </div>
                      <div className="text-slate-300 font-bold mt-1">45,000đ</div>
                      <span className="text-[10px] text-slate-400 mt-1">Kho: 540 • Dự phòng 1</span>
                    </div>

                    <div className="bg-[#252840] p-2.5 rounded-xl border border-[#363850] flex flex-col justify-between">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-300 font-semibold">Kho Nội Bộ</span>
                        <span className="w-2 h-2 rounded-full bg-cyan-400" />
                      </div>
                      <div className="text-cyan-400 font-bold mt-1">$1.80 USD</div>
                      <span className="text-[10px] text-slate-400 mt-1">Kho: 320 • Auto sync</span>
                    </div>
                  </div>
                </div>
              </div>
            </SpotlightCard>

            {/* Card 2: 2-Second VietQR & USDT Payments (Spans 4 cols) */}
            <SpotlightCard className="md:col-span-12 lg:col-span-4 p-8 lp-reveal">
              <div className="relative z-10 flex flex-col justify-between h-full space-y-6">
                <div className="space-y-3">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-md">
                    <QrCode className="w-6 h-6" />
                  </div>
                  <h3 className="text-2xl font-bold text-white tracking-tight">
                    Thanh Toán Tự Động 2s
                  </h3>
                  <p className="text-slate-300 text-sm leading-relaxed">
                    Khách quét <b>VietQR</b> tự khớp lệnh chuyển khoản ngân hàng trong 1.5s không mất phí trung gian.
                    Tích hợp sẵn <b>USDT Crypto</b> cho khách quốc tế.
                  </p>
                </div>

                <div className="bg-[#1a1d2e] p-4 rounded-2xl border border-[#363850] space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Giao dịch gần nhất:</span>
                    <span className="text-emerald-400 font-mono font-bold">+180,000đ</span>
                  </div>
                  <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 w-[95%] rounded-full animate-pulse" />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>Khớp lệnh VietQR</span>
                    <span className="text-slate-200 font-mono font-semibold">1.2 giây</span>
                  </div>
                </div>
              </div>
            </SpotlightCard>

            {/* Card 3: 24/7 Auto Warranty & Account Check (Spans 4 cols) */}
            <SpotlightCard className="md:col-span-12 lg:col-span-4 p-8 lp-reveal">
              <div className="relative z-10 flex flex-col justify-between h-full space-y-6">
                <div className="space-y-3">
                  <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-md">
                    <ShieldCheck className="w-6 h-6" />
                  </div>
                  <h3 className="text-2xl font-bold text-white tracking-tight">
                    Tự Check Bảo Hành 24/7
                  </h3>
                  <p className="text-slate-300 text-sm leading-relaxed">
                    Bot tự động kiểm tra cookie/token trước khi giao. Khi khách bấm báo lỗi,
                    bot tự test acc và đổi mới 1-đổi-1 trong 3 giây. Không lo khách réo lúc nửa đêm.
                  </p>
                </div>

                <div className="bg-[#1a1d2e] p-3.5 rounded-2xl border border-[#363850] font-mono text-xs space-y-1.5 text-slate-300">
                  <div className="flex items-center gap-1.5 text-[11px] text-cyan-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Auto-Verifier Passed</span>
                  </div>
                  <div className="text-[10px] text-slate-400">
                    Ping test: <span className="text-white">Valid session (HTTP 200)</span>
                  </div>
                  <div className="text-[10px] text-emerald-400">
                    Tự đổi acc mới: <span className="font-bold">Hoàn tất (2.8s)</span>
                  </div>
                </div>
              </div>
            </SpotlightCard>

            {/* Card 4: B2B Wholesale & Affiliate Network (Spans 8 cols) */}
            <SpotlightCard className="md:col-span-12 lg:col-span-8 p-8 lp-reveal">
              <div className="relative z-10 flex flex-col justify-between h-full space-y-6">
                <div className="space-y-3">
                  <div className="w-12 h-12 rounded-2xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400 shadow-md">
                    <TrendingUp className="w-6 h-6" />
                  </div>
                  <h3 className="text-2xl font-bold text-white tracking-tight">
                    Mạng Lưới Cộng Tác Viên & Đại Lý B2B
                  </h3>
                  <p className="text-slate-300 text-sm leading-relaxed max-w-xl">
                    Tạo bot con riêng cho CTV, phân cấp bậc giá sỉ VIP 1, VIP 2, tự động trích hoa hồng affiliate.
                    Bạn nắm kho gốc, hàng trăm CTV bán hàng cho bạn mà không sợ lộ nguồn.
                  </p>
                </div>

                {/* Tier Matrix Mockup */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs font-sans">
                  <div className="bg-[#1a1d2e] p-3 rounded-xl border border-[#363850] space-y-1">
                    <div className="text-slate-400 font-semibold text-[11px]">Khách Lẻ</div>
                    <div className="text-white font-bold text-sm">Giá Niêm Yết</div>
                    <div className="text-[10px] text-slate-400">Mua trực tiếp trên bot</div>
                  </div>
                  <div className="bg-[#1a1d2e] p-3 rounded-xl border border-purple-500/40 space-y-1">
                    <div className="text-purple-400 font-semibold text-[11px]">CTV Cấp 1</div>
                    <div className="text-purple-300 font-bold text-sm">Chiết Khấu 15%</div>
                    <div className="text-[10px] text-slate-400">Tự động trừ ví bot</div>
                  </div>
                  <div className="bg-[#1a1d2e] p-3 rounded-xl border border-amber-500/40 space-y-1">
                    <div className="text-amber-400 font-semibold text-[11px]">Tổng Đại Lý VIP</div>
                    <div className="text-amber-300 font-bold text-sm">Giá Sỉ Gốc + API</div>
                    <div className="text-[10px] text-slate-400">Tích hợp vào web riêng</div>
                  </div>
                </div>
              </div>
            </SpotlightCard>
          </div>
        </div>
      </section>

      {/* ── COMPARISON MATRIX: BÁN HÀNG THỦ CÔNG VS ALTIVOX ────────── */}
      <section id="compare" className="py-20 bg-[#141624] border-y border-[#363850] relative scroll-mt-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto space-y-3 mb-14 lp-reveal">
            <h2 className="text-3xl sm:text-4xl font-black uppercase text-white tracking-tight">
              Tại Sao Phải Nâng Cấp Lên{" "}
              <span className="text-orange-400">Altivox Automated</span>?
            </h2>
            <p className="text-sm sm:text-base text-slate-300">
              So sánh hiệu quả giữa cách bán hàng thủ công truyền thống và hệ thống tự động hoá hoàn toàn.
            </p>
          </div>

          <div className="overflow-x-auto lp-reveal">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-[#363850] text-slate-400 text-xs uppercase tracking-wider">
                  <th className="py-4 px-4 font-semibold">Tiêu chí so sánh</th>
                  <th className="py-4 px-4 font-semibold text-rose-400">Bán Hàng Thủ Công (Cũ)</th>
                  <th className="py-4 px-4 font-semibold text-emerald-400 bg-orange-500/10 rounded-t-xl">
                    Altivox Automated Platform (Mới)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#363850] text-slate-300">
                <tr>
                  <td className="py-4 px-4 font-medium text-white flex items-center gap-2">
                    <Clock3 className="w-4 h-4 text-slate-400" />
                    Thời gian trả hàng cho khách
                  </td>
                  <td className="py-4 px-4 text-rose-300/80">
                    15 - 45 phút (chỉ khi bạn online thức trực chat)
                  </td>
                  <td className="py-4 px-4 text-emerald-300 font-semibold bg-orange-500/10">
                    Dưới 2 giây (24/7/365 kể cả lúc ngủ hay đi chơi)
                  </td>
                </tr>
                <tr>
                  <td className="py-4 px-4 font-medium text-white flex items-center gap-2">
                    <QrCode className="w-4 h-4 text-slate-400" />
                    Xác nhận thanh toán
                  </td>
                  <td className="py-4 px-4 text-rose-300/80">
                    Phải mở app ngân hàng check biến động, dễ bị làm giả bill chuyển khoản
                  </td>
                  <td className="py-4 px-4 text-emerald-300 font-semibold bg-orange-500/10">
                    VietQR & USDT tự khớp mã nội dung 100%, chống bill ảo tuyệt đối
                  </td>
                </tr>
                <tr>
                  <td className="py-4 px-4 font-medium text-white flex items-center gap-2">
                    <Boxes className="w-4 h-4 text-slate-400" />
                    Nguồn hàng & Tồn kho
                  </td>
                  <td className="py-4 px-4 text-rose-300/80">
                    Nhập tay file Excel, hết hàng phải đi tìm nhà cung cấp gấp
                  </td>
                  <td className="py-4 px-4 text-emerald-300 font-semibold bg-orange-500/10">
                    Tự động đồng bộ nhiều API kho sỉ, tự chọn giá rẻ nhất
                  </td>
                </tr>
                <tr>
                  <td className="py-4 px-4 font-medium text-white flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-slate-400" />
                    Xử lý bảo hành khi acc lỗi
                  </td>
                  <td className="py-4 px-4 text-rose-300/80">
                    Khách nhắn tin hối thúc cãi nhau, check acc thủ công mất hàng giờ
                  </td>
                  <td className="py-4 px-4 text-emerald-300 font-semibold bg-orange-500/10">
                    Khách bấm 1 nút trên Bot, hệ thống tự test và đổi acc mới trong 3 giây
                  </td>
                </tr>
                <tr>
                  <td className="py-4 px-4 font-medium text-white flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-slate-400" />
                    Khả năng mở rộng (Scale)
                  </td>
                  <td className="py-4 px-4 text-rose-300/80">
                    Phải thuê thêm nhiều nhân viên trực chat, tốn chi phí cố định
                  </td>
                  <td className="py-4 px-4 text-emerald-300 font-semibold bg-orange-500/10">
                    1 mình bạn quản trị hàng nghìn đơn/ngày không giới hạn
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── 3 EASY SETUP STEPS ────────────────────────────────────── */}
      <section className="py-24 relative bg-[#1a1d2e]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto space-y-3 mb-16 lp-reveal">
            <div className="text-orange-400 text-xs font-bold tracking-wider uppercase">
              Cực Kỳ Dễ Dàng
            </div>
            <h2 className="text-3xl sm:text-4xl font-black uppercase text-white tracking-tight">
              Bắt Đầu Bán Hàng Sau 3 Bước Đơn Giản
            </h2>
            <p className="text-slate-300 text-sm sm:text-base">
              Chỉ mất chưa đầy 3 phút để cài đặt bot và sẵn sàng nhận thanh toán đầu tiên.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
            {/* Step 1 */}
            <SpotlightCard className="p-8 relative space-y-4 lp-reveal">
              <div className="text-5xl font-black text-orange-500/20 font-mono">01</div>
              <div className="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/30 flex items-center justify-center text-orange-400 font-bold">
                <Bot className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-bold text-white">Tạo Bot Trên Telegram</h3>
              <p className="text-sm text-slate-300 leading-relaxed">
                Mở <b>@BotFather</b> trên Telegram, tạo bot mới và dán Token vào hệ thống Altivox.
                Không cần cấu hình server hay webhook phức tạp.
              </p>
            </SpotlightCard>

            {/* Step 2 */}
            <SpotlightCard className="p-8 relative space-y-4 lp-reveal">
              <div className="text-5xl font-black text-amber-500/20 font-mono">02</div>
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 font-bold">
                <Layers className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-bold text-white">Nhập Kho Hoặc Nối API Sỉ</h3>
              <p className="text-sm text-slate-300 leading-relaxed">
                Tải lên danh sách tài khoản có sẵn hoặc liên kết trực tiếp API nhà cung cấp sỉ.
                Tùy chỉnh giá bán lẻ, giá sỉ và cài đặt tỷ giá USD/VND theo ý muốn.
              </p>
            </SpotlightCard>

            {/* Step 3 */}
            <SpotlightCard className="p-8 relative space-y-4 lp-reveal">
              <div className="text-5xl font-black text-emerald-500/20 font-mono">03</div>
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold">
                <Wallet className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-bold text-white">Bật VietQR & Nhận Tiền</h3>
              <p className="text-sm text-slate-300 leading-relaxed">
                Điền số tài khoản ngân hàng của bạn. Khi khách mua hàng trên Telegram,
                tiền sẽ chảy thẳng về tài khoản ngân hàng của bạn theo thời gian thực!
              </p>
            </SpotlightCard>
          </div>
        </div>
      </section>

      {/* ── PRICING TIERS WITH MONTHLY / ANNUAL SWITCHER ───────────── */}
      <section id="pricing" className="py-24 bg-[#141624] border-t border-[#363850] relative scroll-mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto space-y-4 mb-12 lp-reveal">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/10 text-orange-400 border border-orange-500/30 text-xs font-semibold">
              <Award className="w-3.5 h-3.5" />
              <span>BẢNG GIÁ MINH BẠCH</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-black uppercase text-white tracking-tight">
              Lựa Chọn Gói Phù Hợp Cho Doanh Nghiệp Bạn
            </h2>
            <p className="text-slate-300 text-sm sm:text-base">
              Không phí ẩn, không chia sẻ phần trăm doanh thu đơn hàng. Nâng cấp hoặc hủy gói bất kỳ lúc nào.
            </p>

            {/* Billing cycle toggle */}
            <div className="pt-4 flex items-center justify-center gap-3">
              <span className={`text-xs font-semibold ${!annualBilling ? "text-white" : "text-slate-400"}`}>
                Thanh Toán Hàng Tháng
              </span>
              <button
                onClick={() => setAnnualBilling(!annualBilling)}
                className={`relative w-14 h-7 rounded-full p-0.5 transition-colors border ${
                  annualBilling ? "bg-orange-500 border-orange-400" : "bg-[#252840] border-[#363850]"
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full bg-white transition-transform ${
                    annualBilling ? "translate-x-7 shadow-md" : "translate-x-0.5"
                  }`}
                />
              </button>
              <div className="flex items-center gap-1.5">
                <span className={`text-xs font-semibold ${annualBilling ? "text-white" : "text-slate-400"}`}>
                  Thanh Toán 1 Năm
                </span>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-bold border border-emerald-500/30">
                  TIẾT KIỆM 16%
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-6xl mx-auto items-stretch">
            {/* Tier 1: Free Trial */}
            <SpotlightCard className="p-8 flex flex-col justify-between lp-reveal">
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-bold text-white">Trải Nghiệm (Free)</h3>
                  <p className="text-xs text-slate-400 mt-1">Khám phá giao diện & cấu hình thử nghiệm</p>
                </div>

                <div className="flex items-baseline gap-1 font-mono">
                  <span className="text-4xl font-extrabold text-slate-300">0đ</span>
                  <span className="text-slate-500 text-xs">/dùng thử</span>
                </div>

                <ul className="space-y-3 text-xs text-slate-300">
                  <li className="flex items-center gap-2.5 text-rose-400">
                    <XCircle className="w-4 h-4 flex-shrink-0" />
                    <span><b>Chặn tạo đơn</b> (Khách vào bot không thể mua hàng)</span>
                  </li>
                  <li className="flex items-center gap-2.5 text-rose-400">
                    <XCircle className="w-4 h-4 flex-shrink-0" />
                    <span><b>Không có</b> chiến dịch Tele Campaign</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <Check className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    <span>Trải nghiệm toàn bộ Dashboard quản trị</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <Check className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    <span>Tạo Bot & cấu hình catalog sản phẩm mẫu</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <Check className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    <span>Cài đặt tỷ giá VND/USD & ngân hàng VietQR</span>
                  </li>
                </ul>

                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300 flex items-start gap-2 leading-relaxed">
                  <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                  <span>Cần nâng cấp gói <b>PRO</b> để bot chính thức mở bán & nhận đơn tự động.</span>
                </div>
              </div>

              <div className="pt-6">
                <Link
                  to="/register"
                  className="w-full py-3 rounded-xl bg-[#1a1d2e] hover:bg-slate-800 text-slate-200 font-semibold text-xs flex items-center justify-center border border-[#363850] transition-colors"
                >
                  Đăng Ký Trải Nghiệm
                </Link>
              </div>
            </SpotlightCard>

            {/* Tier 2: Pro Seller (Highlight) */}
            <div className="relative rounded-2xl p-px bg-gradient-to-b from-orange-500 to-amber-500 shadow-2xl shadow-orange-500/20 lp-reveal">
              <div className="h-full rounded-2xl p-8 flex flex-col justify-between bg-[#252840] relative overflow-hidden">
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-gradient-to-r from-orange-500 to-amber-500 text-white font-bold text-[11px] uppercase tracking-wider shadow-md">
                  Được Chọn Nhiều Nhất
                </div>

                <div className="space-y-5 pt-1">
                  <div>
                    <h3 className="text-lg font-bold text-white flex items-center gap-1.5">
                      <span>Chuyên Nghiệp (PRO)</span>
                      <Sparkles className="w-4 h-4 text-amber-400" />
                    </h3>
                    <p className="text-xs text-orange-300 mt-1">Mở khóa bán hàng 24/7 + Tặng kèm Tele Campaign</p>
                  </div>

                  <div className="flex items-baseline gap-1 font-mono">
                    <span className="text-4xl font-extrabold text-orange-400">
                      {annualBilling ? "167.000đ" : "199.000đ"}
                    </span>
                    <span className="text-slate-400 text-xs">/tháng</span>
                    {annualBilling && (
                      <span className="text-[10px] text-emerald-400 font-sans ml-1">
                        (2.006.000đ / năm)
                      </span>
                    )}
                  </div>

                  {/* Tele Campaign Plus Bonus Callout */}
                  <div className="p-3 rounded-xl bg-gradient-to-r from-orange-500/20 via-amber-500/15 to-transparent border border-orange-500/40 text-xs text-orange-200 flex items-start gap-2.5">
                    <Gift className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                    <div className="space-y-0.5">
                      <div className="font-bold text-amber-300 text-xs flex items-center gap-1.5">
                        <span>TẶNG GÓI PLUS TELE CAMPAIGN</span>
                      </div>
                      <div className="text-[11px] text-slate-300 leading-snug">
                        Userbot Telegram kéo mem, phát tin & chạy chiến dịch nhóm tự động.
                      </div>
                    </div>
                  </div>

                  <ul className="space-y-2.5 text-xs text-slate-300">
                    <li className="flex items-center gap-2.5 text-white font-medium">
                      <Check className="w-4 h-4 text-orange-400 flex-shrink-0" />
                      <span><b>Mở khóa bán hàng tự động 24/7</b> (Không giới hạn đơn)</span>
                    </li>
                    <li className="flex items-center gap-2.5">
                      <Check className="w-4 h-4 text-orange-400 flex-shrink-0" />
                      <span>Thanh toán tự động 2s: <b>VietQR & USDT Crypto</b></span>
                    </li>
                    <li className="flex items-center gap-2.5">
                      <Check className="w-4 h-4 text-orange-400 flex-shrink-0" />
                      <span><b>Bot Telegram full tính năng</b> (Webhook & Polling 24/7)</span>
                    </li>
                    <li className="flex items-center gap-2.5">
                      <Check className="w-4 h-4 text-orange-400 flex-shrink-0" />
                      <span>Kết nối <b>10 API nhà cung cấp sỉ</b> (Tự so sánh giá rẻ nhất)</span>
                    </li>
                    <li className="flex items-center gap-2.5">
                      <Check className="w-4 h-4 text-orange-400 flex-shrink-0" />
                      <span><b>Auto check bảo hành 1-đổi-1</b> tự động trong 3 giây</span>
                    </li>
                    <li className="flex items-center gap-2.5">
                      <Check className="w-4 h-4 text-orange-400 flex-shrink-0" />
                      <span>Đồng bộ đa tiền tệ <b>VND & USD</b> thông minh</span>
                    </li>
                  </ul>
                </div>

                <div className="pt-6">
                  <Link
                    to="/register"
                    className="lp-btn-radiant w-full py-3.5 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-orange-500/25 transition-all"
                  >
                    <span>Nâng Cấp Gói PRO Ngay</span>
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            </div>

            {/* Tier 3: Enterprise / Ultra */}
            <SpotlightCard className="p-8 flex flex-col justify-between lp-reveal">
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-bold text-white">Toàn Năng (ULTRA)</h3>
                  <p className="text-xs text-slate-400 mt-1">Dành cho tổng đại lý & mạng lưới CTV sỉ lớn</p>
                </div>

                <div className="flex items-baseline gap-1 font-mono">
                  <span className="text-4xl font-extrabold text-white">
                    {annualBilling ? "234.000đ" : "279.000đ"}
                  </span>
                  <span className="text-slate-400 text-xs">/tháng</span>
                </div>

                <ul className="space-y-3 text-xs text-slate-300">
                  <li className="flex items-center gap-2.5 text-white font-semibold">
                    <Check className="w-4 h-4 text-amber-400 flex-shrink-0" />
                    <span><b>Tất cả quyền lợi của gói PRO</b></span>
                  </li>
                  <li className="flex items-center gap-2.5 text-amber-300 font-medium">
                    <Check className="w-4 h-4 text-amber-400 flex-shrink-0" />
                    <span><b>Gói Tele Campaign Nâng Cao</b> (Full tính năng không giới hạn)</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <Check className="w-4 h-4 text-amber-400 flex-shrink-0" />
                    <span>Cấp <b>B2B API Key</b> cho CTV & đại lý tích hợp vào web riêng</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <Check className="w-4 h-4 text-amber-400 flex-shrink-0" />
                    <span>Hệ thống phân cấp chiết khấu sỉ không giới hạn tầng</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <Check className="w-4 h-4 text-amber-400 flex-shrink-0" />
                    <span>Hạ tầng server ưu tiên cao, tốc độ phản hồi <b>&lt; 0.8s</b></span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <Check className="w-4 h-4 text-amber-400 flex-shrink-0" />
                    <span>Đội ngũ kỹ thuật hỗ trợ 1-1 qua Telegram riêng</span>
                  </li>
                </ul>
              </div>

              <div className="pt-6">
                <Link
                  to="/register"
                  className="w-full py-3 rounded-xl bg-[#1a1d2e] hover:bg-slate-800 text-slate-200 font-semibold text-xs flex items-center justify-center border border-[#363850] transition-colors"
                >
                  Đăng Ký Gói ULTRA
                </Link>
              </div>
            </SpotlightCard>
          </div>
        </div>
      </section>

      {/* ── FAQ ACCORDION ─────────────────────────────────────────── */}
      <section id="faq" className="py-24 bg-[#1a1d2e] border-t border-[#363850] relative scroll-mt-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center space-y-3 mb-14 lp-reveal">
            <div className="text-orange-400 text-xs font-bold tracking-wider uppercase">
              Giải Đáp Thắc Mắc
            </div>
            <h2 className="text-3xl sm:text-4xl font-black uppercase text-white tracking-tight">
              Câu Hỏi Thường Gặp (FAQ)
            </h2>
            <p className="text-slate-300 text-sm">
              Mọi thứ bạn cần biết trước khi bắt đầu kinh doanh tự động với Altivox.
            </p>
          </div>

          <div className="space-y-3.5 lp-reveal">
            {[
              {
                q: "Tôi không biết lập trình hay code, có tự cài đặt bot được không?",
                a: "Hoàn toàn được! Altivox được thiết kế dưới dạng 'No-Code' 100%. Bạn chỉ cần tạo một con Bot miễn phí trên @BotFather của Telegram, sao chép mã Token dán vào Altivox là hệ thống tự động kết nối trong 30 giây.",
              },
              {
                q: "Gói Free dùng thử khác gì so với gói PRO?",
                a: "Gói Free cho phép bạn trải nghiệm toàn bộ giao diện quản trị, tạo bot thử nghiệm, thêm sản phẩm và cấu hình giá. Tuy nhiên, bot ở gói Free sẽ chặn tạo đơn (khách không thể thanh toán mua hàng) và không có công cụ Tele Campaign. Nâng cấp PRO chỉ 199.000đ/tháng để mở khóa bán hàng 24/7 và được tặng ngay gói Plus Tele Campaign kéo mem, phát tin tự động!",
              },
              {
                q: "Tiền thanh toán của khách mua hàng sẽ chuyển về đâu?",
                a: "Tiền chuyển thẳng trực tiếp về tài khoản ngân hàng cá nhân của bạn thông qua mã VietQR tự động, hoặc ví Crypto USDT riêng của bạn. Altivox KHÔNG giữ tiền và KHÔNG thu bất kỳ % chiết khấu giao dịch nào trên từng đơn hàng.",
              },
              {
                q: "Cơ chế quản lý đồng bộ tiền tệ VND & USD hoạt động thế nào?",
                a: "Hệ thống vận hành gốc bằng VND hoặc USD tuỳ bạn chọn. Nếu bạn nhập kho sỉ quốc tế tính bằng USD, Altivox tự quy đổi sang VND theo tỷ giá thị trường. Khách hàng trên Telegram có thể xem giá và thanh toán bằng VND (VietQR) hoặc USD (USDT), số dư và lịch sử giao dịch được đồng bộ chuẩn xác 100%.",
              },
              {
                q: "Nếu nhà cung cấp sỉ (DongVan, Taphoammo...) bị hết hàng thì sao?",
                a: "Hệ thống hỗ trợ cơ chế 'Active Failover'. Bạn có thể kết nối nhiều nguồn sỉ cùng lúc. Nếu nguồn giá rẻ nhất hết hàng hoặc bảo trì, hệ thống tự động chuyển sang nguồn dự phòng số 2 hoặc kho nội bộ của bạn để giao ngay cho khách mà không làm đứt quãng đơn hàng.",
              },
            ].map((item, idx) => {
              const isOpen = activeFaq === idx;
              return (
                <div
                  key={idx}
                  className="rounded-2xl border border-[#363850] bg-[#252840]/90 backdrop-blur-md overflow-hidden transition-all duration-200"
                >
                  <button
                    onClick={() => setActiveFaq(isOpen ? null : idx)}
                    className="w-full px-6 py-4.5 text-left flex items-center justify-between gap-4 font-semibold text-sm sm:text-base text-white hover:text-orange-400 transition-colors"
                  >
                    <span>{item.q}</span>
                    <ChevronDown
                      className={`w-4 h-4 flex-shrink-0 text-slate-400 transition-transform duration-200 ${
                        isOpen ? "rotate-180 text-orange-400" : ""
                      }`}
                    />
                  </button>
                  {isOpen && (
                    <div className="px-6 pb-5 text-sm text-slate-300 leading-relaxed border-t border-[#363850] pt-3">
                      {item.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── RADIANT BOTTOM CTA ────────────────────────────────────── */}
      <section className="py-20 relative overflow-hidden bg-[#1a1d2e]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="rounded-3xl p-10 sm:p-14 bg-gradient-to-r from-orange-600 via-amber-600 to-orange-500 shadow-2xl shadow-orange-500/30 text-center space-y-6 relative overflow-hidden lp-reveal">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.2),transparent_70%)] pointer-events-none" />

            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black uppercase text-white tracking-tight max-w-2xl mx-auto">
              Sẵn Sàng Tự Động Hóa 100% Cửa Hàng Của Bạn?
            </h2>
            <p className="text-orange-100 text-sm sm:text-base max-w-xl mx-auto">
              Tham gia cùng hơn 2,400+ Reseller thông minh đang tiết kiệm hàng trăm giờ mỗi tháng
              và nhân đôi doanh thu với Altivox.
            </p>

            <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                to="/register"
                className="w-full sm:w-auto px-8 py-4 rounded-xl font-black uppercase tracking-wide text-sm bg-white text-orange-600 hover:bg-slate-100 shadow-xl transition-all flex items-center justify-center gap-2 group"
              >
                <span>Bắt Đầu Miễn Phí Ngay</span>
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Link>
              <a
                href="https://t.me"
                target="_blank"
                rel="noreferrer"
                className="w-full sm:w-auto px-6 py-4 rounded-xl font-semibold text-sm text-white hover:bg-white/10 border border-white/30 transition-all flex items-center justify-center gap-2"
              >
                <MessageCircle className="w-5 h-5" />
                <span>Gia Nhập Cộng Đồng Telegram</span>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTER ────────────────────────────────────────────────── */}
      <footer className="border-t border-[#363850] bg-[#141624] py-12 text-xs text-slate-400">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-orange-500 flex items-center justify-center text-white font-bold shadow-md shadow-orange-500/30">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <span className="font-bold text-slate-200 text-sm">Altivox AI Platform</span>
              <span className="text-slate-600">•</span>
              <span>© {new Date().getFullYear()} Altivox Ecosystem. All rights reserved.</span>
            </div>

            <div className="flex items-center gap-6 text-slate-400">
              <span className="flex items-center gap-1.5 text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                All Systems Operational (99.98%)
              </span>
              <Link to="/login" className="hover:text-orange-400 transition-colors">
                Đăng Nhập
              </Link>
              <Link to="/register" className="hover:text-orange-400 transition-colors">
                Đăng Ký
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
