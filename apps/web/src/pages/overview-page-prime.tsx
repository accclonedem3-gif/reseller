import { useEffect, useState } from "react";
import { useDarkMode } from "@/hooks/use-dark-mode";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bot, Check, CircleDollarSign, Crown, PackageCheck, RefreshCw, Wallet, X, Zap } from "lucide-react";

import {
  StudioBadge,
  StudioButton,
  StudioCard,
  StudioMetric,
  StudioSectionIntro,
} from "@/components/studio/studio-ui";
import { InfoHint } from "@/components/ui/info-hint";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import { formatCurrency, formatDate, formatStatusLabel } from "@/lib/format";
import { useLang } from "@/lib/lang";

const WELCOME_FEATURES = {
  vi: {
    pro: [
      "Bot Telegram tự động 24/7",
      "Mở shop bán hàng riêng",
      "Thanh toán PayOS & Binance Pay",
      "Kết nối nguồn hàng Tổng sỉ",
    ],
    ultra: [
      "Tất cả tính năng Pro",
      "Tạo kho sỉ riêng + API key",
      "Bảo hành tự động cho đại lý",
      "Báo cáo doanh thu realtime",
    ],
  },
  en: {
    pro: [
      "24/7 Telegram bot automation",
      "Open your own shop",
      "PayOS & Binance Pay payments",
      "Connect wholesale source",
    ],
    ultra: [
      "All Pro features",
      "Create your own wholesale + API key",
      "Automatic warranty for dealers",
      "Real-time revenue reports",
    ],
  },
  th: {
    pro: [
      "บอท Telegram อัตโนมัติ 24/7",
      "เปิดร้านค้าของตัวเอง",
      "ชำระผ่าน PayOS & Binance Pay",
      "เชื่อมต่อแหล่งสินค้าส่ง",
    ],
    ultra: [
      "ทุกฟีเจอร์ Pro",
      "สร้างคลังสินค้าส่ง + API key",
      "รับประกันอัตโนมัติสำหรับตัวแทน",
      "รายงานรายได้แบบเรียลไทม์",
    ],
  },
};

const T = {
  vi: {
    welcomePrefix: "Chào mừng đến với",
    welcomeDesc: (tier: string) => `Gói ${tier} đã được kích hoạt. Bắt đầu vận hành thôi!`,
    autoClose: "Tự động đóng sau vài giây",
    kicker: "Trung tâm vận hành",
    title: "Tổng quan bán hàng",
    desc: (shop: string) =>
      `Theo dõi bot, ví nguồn, đơn gần đây và nhịp bán của ${shop} từ một màn hình gọn và dễ quét.`,
    shopLabel: (name: string) => `Shop: ${name}`,
    shopEmpty: "Chưa đặt tên",
    active: "Đang hoạt động",
    refresh: "Làm mới",
    botStatus: "Trạng thái bot",
    botIdle: "Đang chờ",
    lastSync: (date: string) => `Lần đồng bộ gần nhất: ${date}`,
    sourceWallet: "Ví bot nguồn",
    sourceWalletDesc: "Số dư ví dùng để lấy hàng từ nguồn cung cấp.",
    revenue: "Doanh thu tháng",
    revenueDesc: (n: number) => `${n} đơn đã giao thành công trong kỳ hiện tại.`,
    watchOrders: "Đơn cần theo dõi",
    watchOrdersDesc: "Bao gồm đơn chờ thanh toán, chờ hàng hoặc đang xử lý mua nguồn.",
    recentFlow: "Luồng đơn gần đây",
    latestOrders: "Đơn mới nhất",
    tableHint: "Hiển thị các đơn mới nhất để seller quét nhanh mã đơn, trạng thái và tổng tiền.",
    tableHintLabel: "Xem ghi chú cho Đơn mới nhất",
    colOrder: "Mã đơn",
    colProduct: "Sản phẩm",
    colCustomer: "Khách",
    colStatus: "Trạng thái",
    colTotal: "Tổng tiền",
    noOrders: "Chưa có đơn hàng nào để hiển thị.",
    latestOrderPanel: "Đơn mới nhất",
    noData: "Chưa có dữ liệu",
    noNewOrder: "Chưa có đơn mới",
    orderValue: "Giá trị đơn",
    buyer: "Khách mua",
    topBuyers: "Top người mua",
    highValue: "Khách giá trị cao",
    orderCount: (n: number) => `${n} đơn đã mua`,
    noBuyers: "Chưa có dữ liệu người mua nổi bật.",
  },
  en: {
    welcomePrefix: "Welcome to",
    welcomeDesc: (tier: string) => `${tier} plan activated. Let's get started!`,
    autoClose: "Auto-closes in a few seconds",
    kicker: "Operations Center",
    title: "Sales Overview",
    desc: (shop: string) =>
      `Monitor bot, source wallet, recent orders, and sales pace for ${shop} from one clean screen.`,
    shopLabel: (name: string) => `Shop: ${name}`,
    shopEmpty: "Unnamed",
    active: "Active",
    refresh: "Refresh",
    botStatus: "Bot Status",
    botIdle: "Idle",
    lastSync: (date: string) => `Last sync: ${date}`,
    sourceWallet: "Source Bot Wallet",
    sourceWalletDesc: "Wallet balance used to purchase from the source provider.",
    revenue: "Monthly Revenue",
    revenueDesc: (n: number) => `${n} orders delivered successfully this period.`,
    watchOrders: "Orders to Monitor",
    watchOrdersDesc: "Includes awaiting payment, waiting for stock, or processing from source.",
    recentFlow: "Recent Order Flow",
    latestOrders: "Latest Orders",
    tableHint: "Shows the most recent orders for a quick scan of codes, status, and totals.",
    tableHintLabel: "View note for Latest Orders",
    colOrder: "Order Code",
    colProduct: "Product",
    colCustomer: "Customer",
    colStatus: "Status",
    colTotal: "Total",
    noOrders: "No orders to display yet.",
    latestOrderPanel: "Latest Order",
    noData: "No data yet",
    noNewOrder: "No new orders",
    orderValue: "Order Value",
    buyer: "Buyer",
    topBuyers: "Top Buyers",
    highValue: "High-Value Customers",
    orderCount: (n: number) => `${n} orders`,
    noBuyers: "No notable buyers yet.",
  },
  th: {
    welcomePrefix: "ยินดีต้อนรับสู่",
    welcomeDesc: (tier: string) => `เปิดใช้งานแพ็กเกจ ${tier} แล้ว มาเริ่มกันเลย!`,
    autoClose: "ปิดอัตโนมัติในไม่กี่วินาที",
    kicker: "ศูนย์ปฏิบัติการ",
    title: "ภาพรวมการขาย",
    desc: (shop: string) =>
      `ติดตามบอท กระเป๋าแหล่งสินค้า คำสั่งซื้อล่าสุด และจังหวะการขายของ ${shop} จากหน้าจอเดียว`,
    shopLabel: (name: string) => `ร้าน: ${name}`,
    shopEmpty: "ยังไม่ตั้งชื่อ",
    active: "กำลังทำงาน",
    refresh: "รีเฟรช",
    botStatus: "สถานะบอท",
    botIdle: "รอดำเนินการ",
    lastSync: (date: string) => `ซิงค์ล่าสุด: ${date}`,
    sourceWallet: "กระเป๋าบอทแหล่งสินค้า",
    sourceWalletDesc: "ยอดคงเหลือสำหรับสั่งซื้อสินค้าจากแหล่ง",
    revenue: "รายได้เดือนนี้",
    revenueDesc: (n: number) => `จัดส่งสำเร็จ ${n} คำสั่งในช่วงนี้`,
    watchOrders: "คำสั่งซื้อต้องติดตาม",
    watchOrdersDesc: "รวมรอชำระเงิน รอสต็อก หรือกำลังซื้อจากแหล่ง",
    recentFlow: "กระแสคำสั่งซื้อล่าสุด",
    latestOrders: "คำสั่งซื้อล่าสุด",
    tableHint: "แสดงคำสั่งซื้อล่าสุดเพื่อดูรหัส สถานะ และยอดเงินได้รวดเร็ว",
    tableHintLabel: "ดูหมายเหตุสำหรับคำสั่งซื้อล่าสุด",
    colOrder: "รหัสคำสั่ง",
    colProduct: "สินค้า",
    colCustomer: "ลูกค้า",
    colStatus: "สถานะ",
    colTotal: "ยอดรวม",
    noOrders: "ยังไม่มีคำสั่งซื้อให้แสดง",
    latestOrderPanel: "คำสั่งล่าสุด",
    noData: "ยังไม่มีข้อมูล",
    noNewOrder: "ยังไม่มีคำสั่งใหม่",
    orderValue: "มูลค่าคำสั่ง",
    buyer: "ผู้ซื้อ",
    topBuyers: "ผู้ซื้อสูงสุด",
    highValue: "ลูกค้ามูลค่าสูง",
    orderCount: (n: number) => `ซื้อ ${n} คำสั่ง`,
    noBuyers: "ยังไม่มีข้อมูลผู้ซื้อเด่น",
  },
};

function getStatusTone(status: string) {
  if (status === "delivered") return "success" as const;
  if (status === "paid_waiting_stock") return "warning" as const;
  if (status === "failed" || status === "refunded") return "danger" as const;
  return "neutral" as const;
}

function WelcomeOverlay({ tier, onDismiss }: { tier: string; onDismiss: () => void }) {
  const { lang } = useLang();
  const t = T[lang];
  const [shown, setShown] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [barShrunk, setBarShrunk] = useState(false);
  const isDark = useDarkMode();

  useEffect(() => {
    const raf1 = requestAnimationFrame(() => {
      setShown(true);
      requestAnimationFrame(() => setBarShrunk(true));
    });
    const timer = setTimeout(() => handleDismiss(), 5000);
    return () => {
      cancelAnimationFrame(raf1);
      clearTimeout(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleDismiss() {
    setLeaving(true);
    setTimeout(onDismiss, 350);
  }

  const isPro = tier === "pro";
  const tierLabel = isPro ? "Pro" : "Ultra";
  const features: string[] = WELCOME_FEATURES[lang][isPro ? "pro" : "ultra"] ?? [];

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center px-4",
        "bg-black/80 backdrop-blur-md",
        "transition-opacity duration-300",
        leaving ? "opacity-0 pointer-events-none" : "opacity-100",
      )}
      onClick={handleDismiss}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className={cn(
            "absolute -left-32 -top-32 h-96 w-96 rounded-full opacity-20 blur-3xl",
            isPro ? "bg-emerald-500" : "bg-violet-500",
          )}
        />
        <div
          className={cn(
            "absolute -bottom-32 -right-32 h-96 w-96 rounded-full opacity-15 blur-3xl",
            isPro ? "bg-teal-400" : "bg-purple-600",
          )}
        />
      </div>

      <div
        className={cn(
          "relative w-full max-w-sm rounded-[28px] p-7 text-center",
          "border shadow-[0_48px_120px_rgba(0,0,0,0.8)]",
          "transition-all duration-500 ease-out",
          shown && !leaving
            ? "scale-100 translate-y-0 opacity-100"
            : "scale-90 translate-y-6 opacity-0",
          isPro ? "border-emerald-400/30" : "border-violet-400/30",
          isDark && (isPro
            ? "bg-[linear-gradient(160deg,#0c1c14,#091510)]"
            : "bg-[linear-gradient(160deg,#100d1e,#0b0918)]"),
        )}
        style={!isDark ? { backgroundColor: "var(--surface)" } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={handleDismiss}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-slate-500 transition hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="mb-5 flex justify-center">
          <div
            className={cn(
              "flex h-20 w-20 items-center justify-center rounded-[24px]",
              isPro
                ? "bg-[linear-gradient(135deg,#34D399,#10B981)] shadow-[0_0_48px_rgba(52,211,153,0.5)]"
                : "bg-[linear-gradient(135deg,#a78bfa,#7c3aed)] shadow-[0_0_48px_rgba(139,92,246,0.5)]",
            )}
          >
            {isPro ? (
              <Zap className="h-9 w-9 text-[#07131e]" />
            ) : (
              <Crown className="h-9 w-9 text-white" />
            )}
          </div>
        </div>

        <h2 className="text-[1.6rem] font-black leading-tight text-white">
          {t.welcomePrefix}{" "}
          <span className={isPro ? "text-emerald-300" : "text-violet-300"}>
            {tierLabel}!
          </span>
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          {t.welcomeDesc(tierLabel)}
        </p>

        <div className="mt-5 space-y-2.5 text-left">
          {features.map((f) => (
            <div key={f} className="flex items-center gap-2.5">
              <div
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                  isPro
                    ? "bg-emerald-500/20 text-emerald-300"
                    : "bg-violet-500/20 text-violet-300",
                )}
              >
                <Check className="h-3 w-3 stroke-[2.5]" />
              </div>
              <span className="text-sm text-slate-300">{f}</span>
            </div>
          ))}
        </div>

        <div className="mt-6 h-1 overflow-hidden rounded-full bg-white/[0.08]">
          <div
            className={cn(
              "h-full rounded-full",
              isPro ? "bg-emerald-400" : "bg-violet-400",
            )}
            style={{
              width: barShrunk ? "0%" : "100%",
              transition: barShrunk ? "width 5000ms linear" : "none",
            }}
          />
        </div>
        <p className="mt-2 text-xs text-slate-600">{t.autoClose}</p>
      </div>
    </div>
  );
}

export function OverviewPagePrime() {
  const { lang } = useLang();
  const t = T[lang];

  const [searchParams, setSearchParams] = useSearchParams();
  const welcomeTier = searchParams.get("welcome");

  function dismissWelcome() {
    setSearchParams((p) => {
      p.delete("welcome");
      return p;
    });
  }

  const shopQuery = useQuery({
    queryKey: ["shop"],
    queryFn: async () => (await api.get("/shops/current")).data,
  });
  const sourceWalletQuery = useQuery({
    queryKey: ["wallet", "source-balance", "overview"],
    queryFn: async () => (await api.get("/wallet/source-balance")).data,
    retry: false,
  });
  const ordersQuery = useQuery({
    queryKey: ["orders", "overview"],
    queryFn: async () => (await api.get("/orders")).data,
  });
  const revenueQuery = useQuery({
    queryKey: ["revenue", "overview"],
    queryFn: async () => (await api.get("/reports/revenue")).data,
  });
  const topBuyersQuery = useQuery({
    queryKey: ["top-buyers", "overview"],
    queryFn: async () => (await api.get("/reports/top-buyers")).data,
  });

  const orders = ordersQuery.data || [];
  const topBuyers = topBuyersQuery.data || [];
  const deliveredOrders = orders.filter(
    (item: any) => String(item.status || "").toLowerCase() === "delivered",
  );
  const watchOrders = orders.filter((item: any) =>
    ["awaiting_payment", "paid", "processing_purchase", "paid_waiting_stock"].includes(
      String(item.status || "").toLowerCase(),
    ),
  );
  const latestOrder = orders[0];

  const sourceWalletValue =
    sourceWalletQuery.data?.walletCurrency === "VND"
      ? formatCurrency(Number(sourceWalletQuery.data?.balance || 0))
      : sourceWalletQuery.data?.balanceText ||
        `${Number(sourceWalletQuery.data?.balance || 0)} ${
          sourceWalletQuery.data?.walletCurrency || ""
        }`.trim();

  const refreshAll = () => {
    void Promise.all([
      shopQuery.refetch(),
      sourceWalletQuery.refetch(),
      ordersQuery.refetch(),
      revenueQuery.refetch(),
      topBuyersQuery.refetch(),
    ]);
  };

  const shopName = shopQuery.data?.name || t.shopEmpty;

  return (
    <div className="space-y-6">
      {welcomeTier && (
        <WelcomeOverlay tier={welcomeTier} onDismiss={dismissWelcome} />
      )}
      <StudioSectionIntro
        kicker={t.kicker}
        title={t.title}
        description={t.desc(shopName)}
        actions={
          <>
            <StudioBadge tone="neutral">
              {t.shopLabel(shopQuery.data?.name || t.shopEmpty)}
            </StudioBadge>
            <StudioBadge tone="success">
              {shopQuery.data?.status ? formatStatusLabel(shopQuery.data.status) : t.active}
            </StudioBadge>
            <StudioButton variant="secondary" onClick={refreshAll}>
              <RefreshCw className="h-4 w-4" />
              {t.refresh}
            </StudioButton>
          </>
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StudioMetric
          label={t.botStatus}
          value={shopQuery.data?.status ? formatStatusLabel(shopQuery.data.status) : t.botIdle}
          description={t.lastSync(formatDate(shopQuery.data?.lastCatalogSyncAt))}
          icon={Bot}
          tone="sky"
        />
        <StudioMetric
          label={`${t.sourceWallet}${sourceWalletQuery.data?.botSource ? ` · ${sourceWalletQuery.data.botSource}` : ""}`}
          value={sourceWalletValue}
          description={t.sourceWalletDesc}
          icon={Wallet}
          tone="amber"
        />
        <StudioMetric
          label={t.revenue}
          value={formatCurrency(revenueQuery.data?.summary?.grossRevenue || 0)}
          description={t.revenueDesc(deliveredOrders.length)}
          icon={CircleDollarSign}
          tone="emerald"
        />
        <StudioMetric
          label={t.watchOrders}
          value={String(watchOrders.length)}
          description={t.watchOrdersDesc}
          icon={PackageCheck}
          tone="violet"
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
        <StudioCard>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                {t.recentFlow}
              </p>
              <h2 className="mt-3 text-3xl font-semibold text-white">{t.latestOrders}</h2>
            </div>
            <InfoHint
              content={t.tableHint}
              label={t.tableHintLabel}
            />
          </div>

          <div className="app-table-wrap mt-6">
            <table className="app-table">
              <thead>
                <tr>
                  <th>{t.colOrder}</th>
                  <th>{t.colProduct}</th>
                  <th>{t.colCustomer}</th>
                  <th>{t.colStatus}</th>
                  <th className="text-right">{t.colTotal}</th>
                </tr>
              </thead>
              <tbody>
                {orders.slice(0, 6).map((order: any) => (
                  <tr key={order.id}>
                    <td>
                      <p className="font-semibold text-white">{order.orderCode}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">
                        {formatDate(order.createdAt)}
                      </p>
                    </td>
                    <td>
                      <p className="font-medium text-white">{order.productName}</p>
                      <p className="mt-1 text-sm text-slate-500">{order.product?.sourceName || "-"}</p>
                    </td>
                    <td>{order.customer?.telegramUsername || order.customer?.name || "-"}</td>
                    <td>
                      <StudioBadge tone={getStatusTone(order.status)}>
                        {formatStatusLabel(order.status)}
                      </StudioBadge>
                    </td>
                    <td className="text-right font-semibold text-white">
                      {formatCurrency(order.totalSaleAmount)}
                    </td>
                  </tr>
                ))}
                {!orders.length ? (
                  <tr>
                    <td colSpan={5} className="text-sm text-slate-400">
                      {t.noOrders}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </StudioCard>

        <div className="space-y-6">
          <StudioCard>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                  {t.latestOrderPanel}
                </p>
                <h2 className="mt-3 text-2xl font-semibold text-white">
                  {latestOrder?.orderCode || t.noData}
                </h2>
                <p className="mt-2 text-sm text-slate-400">
                  {latestOrder
                    ? `${latestOrder.productName} • ${formatDate(latestOrder.createdAt)}`
                    : t.noNewOrder}
                </p>
              </div>
              {latestOrder ? (
                <StudioBadge tone={getStatusTone(latestOrder.status)}>
                  {formatStatusLabel(latestOrder.status)}
                </StudioBadge>
              ) : null}
            </div>

            <div className="mt-6 grid gap-3">
              <div className="rounded-[20px] border border-white/8 bg-white/[0.03] p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                  {t.orderValue}
                </p>
                <p className="mt-2 text-lg font-semibold text-white">
                  {latestOrder ? formatCurrency(latestOrder.totalSaleAmount) : "-"}
                </p>
              </div>
              <div className="rounded-[20px] border border-white/8 bg-white/[0.03] p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                  {t.buyer}
                </p>
                <p className="mt-2 text-lg font-semibold text-white">
                  {latestOrder?.customer?.telegramUsername || latestOrder?.customer?.name || "-"}
                </p>
              </div>
            </div>
          </StudioCard>

          <StudioCard>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                  {t.topBuyers}
                </p>
                <h2 className="mt-3 text-2xl font-semibold text-white">{t.highValue}</h2>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-[16px] border border-emerald-300/20 bg-emerald-400/10 text-emerald-100">
                <CircleDollarSign className="h-5 w-5" />
              </div>
            </div>

            <div className="mt-6 space-y-3">
              {topBuyers.slice(0, 4).map((buyer: any, index: number) => (
                <div
                  key={buyer.customerId}
                  className="flex items-center justify-between rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-[16px] border border-white/8 bg-slate-950/45 text-sm font-semibold text-white">
                      {String(index + 1).padStart(2, "0")}
                    </div>
                    <div>
                      <p className="font-medium text-white">{buyer.name}</p>
                      <p className="mt-1 text-sm text-slate-500">{t.orderCount(buyer.totalOrders)}</p>
                    </div>
                  </div>
                  <p className="font-semibold text-emerald-200">{formatCurrency(buyer.totalSpent)}</p>
                </div>
              ))}
              {!topBuyers.length ? (
                <div className="rounded-[22px] border border-dashed border-white/10 bg-white/[0.02] px-4 py-6 text-sm text-slate-400">
                  {t.noBuyers}
                </div>
              ) : null}
            </div>
          </StudioCard>
        </div>
      </section>
    </div>
  );
}
