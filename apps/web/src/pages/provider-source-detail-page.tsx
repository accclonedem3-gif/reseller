import type { AxiosError } from "axios";
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  KeyRound,
  Package,
  RefreshCcw,
  Search,
  ShoppingBag,
  UserRound,
  Wallet,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api";
import { formatCurrency, formatDate, formatStatusLabel } from "@/lib/format";

type ProviderSourceOrder = {
  id: string;
  orderCode: string;
  sourceOrderCode: string | null;
  productName: string;
  quantity: number;
  salePrice: number;
  sourcePrice: number;
  totalSaleAmount: number;
  totalSourceAmount: number;
  profit: number;
  status: string;
  paymentStatus: string;
  createdAt: string;
  paidAt: string | null;
  deliveredAt: string | null;
  customer: {
    telegramUserId: string;
    telegramUsername: string | null;
    displayName: string | null;
  };
};

type ProviderSourceOrderPage = {
  items: ProviderSourceOrder[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

type ProviderSourceDetail = {
  source: {
    id: string;
    label: string;
    providerName: string;
    baseUrl: string;
    buyerKeyMasked: string;
    enabled: boolean;
    connectionStatus: string;
    sourceNotificationSyncEnabled: boolean;
    priceMarkupPercent: number | null;
    lastVerifiedAt: string | null;
    lastCatalogSyncAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  providerAccount: {
    sourceBotName: string;
    requesterName: string | null;
    requesterChatId: string | null;
  };
  seller: {
    id: string;
    displayName: string;
    tier: string;
    status: string;
  } | null;
  cloneBot: {
    shopId: string;
    shopName: string;
    shopSlug: string;
    shopStatus: string;
    telegramBotUsername: string | null;
  };
  balance: {
    available: boolean;
    walletCurrency: string | null;
    value: number | null;
    valueVnd: number | null;
    valueUsd: number | null;
    usdtBalance: number | null;
    text: string | null;
    updatedAt: string | null;
    error: string | null;
  };
  products: {
    total: number;
    approved: number;
    pending: number;
  };
  orderStats: {
    total: number;
    totalRevenue: number;
    totalSourceCost: number;
  };
  orders: ProviderSourceOrder[];
};

function statusTone(
  status?: string | null,
): "neutral" | "success" | "warning" | "danger" {
  const normalized = String(status || "").toLowerCase();
  if (
    ["active", "verified", "delivered", "paid", "completed"].includes(
      normalized,
    )
  ) {
    return "success";
  }
  if (
    ["failed", "disabled", "rejected", "canceled", "cancelled"].includes(
      normalized,
    )
  ) {
    return "danger";
  }
  if (
    [
      "pending",
      "awaiting_payment",
      "unpaid",
      "processing",
      "processing_purchase",
    ].includes(normalized)
  ) {
    return "warning";
  }
  return "neutral";
}

function displayBalance(balance: ProviderSourceDetail["balance"]) {
  if (!balance.available) return "Chưa lấy được";
  if (balance.text) return balance.text;
  if (balance.valueVnd != null) return formatCurrency(balance.valueVnd);
  if (balance.value == null) return "-";
  return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 4 }).format(balance.value)} ${balance.walletCurrency || ""}`.trim();
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-white/[0.05] py-3 last:border-0 sm:grid-cols-[150px_1fr] sm:items-center">
      <span
        className="text-[10px] font-black uppercase tracking-[0.14em]"
        style={{ color: "var(--tx-f)" }}
      >
        {label}
      </span>
      <div
        className="min-w-0 text-sm font-semibold"
        style={{ color: "var(--tx)" }}
      >
        {children}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  note,
  icon,
  tone = "orange",
}: {
  label: string;
  value: string | number;
  note?: string;
  icon: ReactNode;
  tone?: "orange" | "green" | "yellow" | "blue";
}) {
  const toneClass = {
    orange: "bg-orange-500/12 text-orange-300",
    green: "bg-emerald-500/12 text-emerald-300",
    yellow: "bg-amber-500/12 text-amber-300",
    blue: "bg-sky-500/12 text-sky-300",
  }[tone];

  return (
    <Card className="rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p
            className="text-[10px] font-black uppercase tracking-[0.16em]"
            style={{ color: "var(--tx-f)" }}
          >
            {label}
          </p>
          <p
            className="mt-2 truncate text-xl font-black"
            style={{ color: "var(--tx)" }}
          >
            {value}
          </p>
          {note ? (
            <p
              className="mt-1 truncate text-[11px]"
              style={{ color: "var(--tx-m)" }}
            >
              {note}
            </p>
          ) : null}
        </div>
        <div className={`rounded-xl p-2.5 ${toneClass}`}>{icon}</div>
      </div>
    </Card>
  );
}

function DetailSkeleton() {
  return (
    <div className="mx-auto max-w-[1280px] animate-pulse space-y-5">
      <div className="h-24 rounded-3xl bg-white/[0.04]" />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="h-28 rounded-2xl bg-white/[0.04]" />
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <div className="h-72 rounded-3xl bg-white/[0.04]" />
        <div className="h-72 rounded-3xl bg-white/[0.04]" />
      </div>
    </div>
  );
}

export function ProviderSourceDetailPage() {
  const { sourceId } = useParams<{ sourceId: string }>();
  const [orderPage, setOrderPage] = useState(1);
  const [orderSearchDraft, setOrderSearchDraft] = useState("");
  const [orderSearch, setOrderSearch] = useState("");
  const detailQuery = useQuery({
    queryKey: ["provider-source-detail", sourceId],
    enabled: Boolean(sourceId),
    queryFn: async () => {
      const response = await api.get<ProviderSourceDetail>(
        `/provider-sources/${sourceId}/detail`,
      );
      return response.data;
    },
    refetchOnWindowFocus: false,
  });
  const sourceOrdersQuery = useQuery({
    queryKey: ["provider-source-orders", sourceId, orderPage, orderSearch],
    enabled: Boolean(sourceId),
    queryFn: async () => {
      const response = await api.get<ProviderSourceOrderPage>(
        `/provider-sources/${sourceId}/orders`,
        {
          params: {
            page: orderPage,
            ...(orderSearch ? { search: orderSearch } : {}),
          },
        },
      );
      return response.data;
    },
    placeholderData: (previous) => previous,
    refetchOnWindowFocus: false,
  });

  if (detailQuery.isLoading) return <DetailSkeleton />;

  if (!sourceId || detailQuery.isError || !detailQuery.data) {
    const error = detailQuery.error as AxiosError<{ message?: string }> | null;
    return (
      <div className="mx-auto max-w-[760px] py-14">
        <Card className="text-center">
          <KeyRound className="mx-auto h-9 w-9 text-rose-300" />
          <h1
            className="mt-4 text-xl font-black"
            style={{ color: "var(--tx)" }}
          >
            Không mở được chi tiết nguồn
          </h1>
          <p className="mt-2 text-sm" style={{ color: "var(--tx-m)" }}>
            {error?.response?.data?.message ||
              "Nguồn không tồn tại hoặc không thuộc shop này."}
          </p>
          <Link to="/source-network" className="mt-5 inline-flex">
            <Button variant="secondary">
              <ArrowLeft className="h-4 w-4" /> Quay lại kết nối nguồn
            </Button>
          </Link>
        </Card>
      </div>
    );
  }

  const detail = detailQuery.data;
  const username = detail.cloneBot.telegramBotUsername?.replace(/^@/, "");
  const sourceOrders = sourceOrdersQuery.data?.items ?? [];
  const orderPagination = sourceOrdersQuery.data?.pagination;

  return (
    <div className="mx-auto max-w-[1280px] space-y-5 pb-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            to="/source-network"
            className="mb-3 inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-orange-400 transition hover:text-orange-300"
          >
            <ArrowLeft className="h-4 w-4" /> Kết nối nguồn
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-black" style={{ color: "var(--tx)" }}>
              {detail.source.label}
            </h1>
            <Badge tone={statusTone(detail.source.connectionStatus)}>
              {formatStatusLabel(detail.source.connectionStatus)}
            </Badge>
          </div>
          <p className="mt-1 text-sm" style={{ color: "var(--tx-m)" }}>
            Chi tiết key provider, bot kết nối, sản phẩm và lịch sử đơn hàng của
            nguồn này.
          </p>
        </div>
        <Button
          variant="secondary"
          disabled={detailQuery.isFetching || sourceOrdersQuery.isFetching}
          onClick={() =>
            void Promise.all([detailQuery.refetch(), sourceOrdersQuery.refetch()])
          }
        >
          <RefreshCcw
            className={`h-4 w-4 ${detailQuery.isFetching || sourceOrdersQuery.isFetching ? "animate-spin" : ""}`}
          />
          Làm mới
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Số dư tại nguồn"
          value={displayBalance(detail.balance)}
          note={
            detail.balance.available
              ? `Cập nhật ${formatDate(detail.balance.updatedAt)}`
              : detail.balance.error || undefined
          }
          icon={<Wallet className="h-5 w-5" />}
        />
        <StatCard
          label="Tổng sản phẩm"
          value={detail.products.total}
          note="Đã đồng bộ từ nguồn"
          icon={<Package className="h-5 w-5" />}
          tone="blue"
        />
        <StatCard
          label="Đã duyệt bán"
          value={detail.products.approved}
          note="Đang hiển thị trên bot clone"
          icon={<CheckCircle2 className="h-5 w-5" />}
          tone="green"
        />
        <StatCard
          label="Chưa cho bán"
          value={detail.products.pending}
          note="Seller cần kiểm tra và duyệt"
          icon={<Clock3 className="h-5 w-5" />}
          tone="yellow"
        />
        <StatCard
          label="Đơn hàng"
          value={detail.orderStats.total}
          note={`Doanh thu ${formatCurrency(detail.orderStats.totalRevenue)}`}
          icon={<ShoppingBag className="h-5 w-5" />}
        />
      </div>

      {!detail.balance.available && detail.balance.error ? (
        <div className="rounded-2xl border border-amber-400/20 bg-amber-500/[0.08] px-4 py-3 text-sm text-amber-200">
          Không lấy được số dư từ provider: {detail.balance.error}. Dữ liệu sản
          phẩm và đơn hàng bên dưới vẫn lấy từ hệ thống local.
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="rounded-2xl">
          <div className="flex items-center gap-3 border-b border-white/[0.06] pb-4">
            <div className="rounded-xl bg-orange-500/12 p-2.5 text-orange-300">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-black" style={{ color: "var(--tx)" }}>
                Thông tin key provider
              </h2>
              <p className="text-[11px]" style={{ color: "var(--tx-m)" }}>
                Credential luôn được che bớt để bảo vệ tài khoản nguồn.
              </p>
            </div>
          </div>
          <div className="mt-1">
            <InfoRow label="Provider">{detail.source.providerName}</InfoRow>
            <InfoRow label="Tên bot nguồn">
              {detail.providerAccount.sourceBotName || "Chưa xác định"}
            </InfoRow>
            <InfoRow label="Buyer / seller nguồn">
              {detail.providerAccount.requesterName ||
                detail.seller?.displayName ||
                "Chưa xác định"}
            </InfoRow>
            <InfoRow label="API / buyer key">
              <span className="font-mono text-xs">
                {detail.source.buyerKeyMasked}
              </span>
            </InfoRow>
            <InfoRow label="Base URL">
              <a
                href={detail.source.baseUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex max-w-full items-center gap-1.5 truncate text-orange-400 hover:text-orange-300"
              >
                <span className="truncate">{detail.source.baseUrl}</span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              </a>
            </InfoRow>
            <InfoRow label="Lãi mặc định">
              {detail.source.priceMarkupPercent ?? 0}%
            </InfoRow>
            <InfoRow label="Xác minh lần cuối">
              {formatDate(detail.source.lastVerifiedAt)}
            </InfoRow>
            <InfoRow label="Đồng bộ lần cuối">
              {formatDate(detail.source.lastCatalogSyncAt)}
            </InfoRow>
          </div>
        </Card>

        <Card className="rounded-2xl">
          <div className="flex items-center gap-3 border-b border-white/[0.06] pb-4">
            <div className="rounded-xl bg-sky-500/12 p-2.5 text-sky-300">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-black" style={{ color: "var(--tx)" }}>
                Seller & bot clone
              </h2>
              <p className="text-[11px]" style={{ color: "var(--tx-m)" }}>
                Shop của seller đang sử dụng key provider này.
              </p>
            </div>
          </div>
          <div className="mt-1">
            <InfoRow label="Seller">
              <span className="inline-flex items-center gap-2">
                <UserRound className="h-4 w-4 text-sky-300" />{" "}
                {detail.seller?.displayName || "-"}
              </span>
            </InfoRow>
            <InfoRow label="Gói tài khoản">
              <span className="inline-flex items-center gap-2">
                <Badge tone="neutral">
                  {formatStatusLabel(detail.seller?.tier)}
                </Badge>
                <Badge tone={statusTone(detail.seller?.status)}>
                  {formatStatusLabel(detail.seller?.status)}
                </Badge>
              </span>
            </InfoRow>
            <InfoRow label="Tên shop clone">{detail.cloneBot.shopName}</InfoRow>
            <InfoRow label="Tên bot clone">
              {username ? (
                <a
                  href={`https://t.me/${username}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-sky-300 hover:text-sky-200"
                >
                  @{username} <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : (
                "Bot Telegram chưa xác minh"
              )}
            </InfoRow>
            <InfoRow label="Trạng thái shop">
              <Badge tone={statusTone(detail.cloneBot.shopStatus)}>
                {formatStatusLabel(detail.cloneBot.shopStatus)}
              </Badge>
            </InfoRow>
            <InfoRow label="Thông báo nguồn">
              {detail.source.sourceNotificationSyncEnabled
                ? "Đang bật"
                : "Đang tắt"}
            </InfoRow>
            <InfoRow label="Giá vốn đơn hàng">
              {formatCurrency(detail.orderStats.totalSourceCost)}
            </InfoRow>
            <InfoRow label="Lợi nhuận tạm tính">
              <span
                className={
                  detail.orderStats.totalRevenue -
                    detail.orderStats.totalSourceCost >=
                  0
                    ? "text-emerald-300"
                    : "text-rose-300"
                }
              >
                {formatCurrency(
                  detail.orderStats.totalRevenue -
                    detail.orderStats.totalSourceCost,
                )}
              </span>
            </InfoRow>
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden rounded-2xl p-0">
        <div className="flex flex-col gap-3 border-b border-white/[0.06] px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="font-black" style={{ color: "var(--tx)" }}>
              Lịch sử đơn hàng
            </h2>
            <p className="text-[11px]" style={{ color: "var(--tx-m)" }}>
              {detail.orderStats.total} đơn đi qua nguồn này · 100 đơn mỗi trang
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <form
              className="flex min-w-0 items-stretch gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                setOrderPage(1);
                setOrderSearch(orderSearchDraft.trim());
              }}
            >
              <div className="relative min-w-0 flex-1 sm:w-[330px]">
                <Search
                  className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
                  style={{ color: "var(--tx-f)" }}
                />
                <input
                  value={orderSearchDraft}
                  onChange={(event) => setOrderSearchDraft(event.target.value)}
                  placeholder="Tìm mã đơn hệ thống hoặc mã đơn nguồn"
                  className="h-10 w-full rounded-xl pl-9 pr-3 text-xs outline-none"
                  style={{
                    background: "var(--inp)",
                    border: "1px solid var(--bd)",
                    color: "var(--tx)",
                  }}
                />
              </div>
              <Button type="submit" variant="secondary">
                <Search className="h-4 w-4" /> Tìm kiếm
              </Button>
              {orderSearch && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setOrderSearchDraft("");
                    setOrderSearch("");
                    setOrderPage(1);
                  }}
                >
                  Xóa lọc
                </Button>
              )}
            </form>
            <Badge tone="neutral">
              Giá vốn {formatCurrency(detail.orderStats.totalSourceCost)}
            </Badge>
          </div>
        </div>

        {sourceOrdersQuery.isError ? (
          <div className="px-5 py-14 text-center">
            <ShoppingBag className="mx-auto h-9 w-9 text-rose-300" />
            <p className="mt-3 text-sm font-bold text-rose-200">
              Không tải được lịch sử đơn hàng. Vui lòng thử lại.
            </p>
          </div>
        ) : sourceOrdersQuery.isLoading && !sourceOrdersQuery.data ? (
          <div className="px-5 py-14 text-center">
            <RefreshCcw className="mx-auto h-7 w-7 animate-spin text-orange-300" />
            <p className="mt-3 text-sm font-bold" style={{ color: "var(--tx-m)" }}>
              Đang tải lịch sử đơn hàng...
            </p>
          </div>
        ) : sourceOrders.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <ShoppingBag
              className="mx-auto h-9 w-9"
              style={{ color: "var(--tx-f)" }}
            />
            <p
              className="mt-3 text-sm font-bold"
              style={{ color: "var(--tx-m)" }}
            >
              {orderSearch
                ? "Không tìm thấy mã đơn phù hợp."
                : "Chưa có đơn hàng từ nguồn này."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1160px] text-left">
              <thead>
                <tr
                  className="border-b border-white/[0.06] text-[10px] font-black uppercase tracking-[0.12em]"
                  style={{ color: "var(--tx-f)" }}
                >
                  <th className="px-5 py-3">Mã đơn hệ thống</th>
                  <th className="px-4 py-3">Mã đơn nguồn</th>
                  <th className="px-4 py-3">Khách hàng</th>
                  <th className="px-4 py-3">Sản phẩm</th>
                  <th className="px-4 py-3 text-center">SL</th>
                  <th className="px-4 py-3 text-right">Giá nguồn</th>
                  <th className="px-4 py-3 text-right">Giá bán</th>
                  <th className="px-4 py-3 text-right">Lãi</th>
                  <th className="px-4 py-3">Trạng thái</th>
                  <th className="px-5 py-3">Thời gian</th>
                </tr>
              </thead>
              <tbody>
                {sourceOrders.map((order) => (
                  <tr
                    key={order.id}
                    className="border-b border-white/[0.045] text-xs last:border-0 hover:bg-white/[0.02]"
                  >
                    <td className="whitespace-nowrap px-5 py-3.5 font-black text-orange-300">
                      {order.orderCode}
                    </td>
                    <td
                      className="whitespace-nowrap px-4 py-3.5 font-mono font-bold"
                      style={{ color: "var(--tx-m)" }}
                    >
                      {order.sourceOrderCode || "—"}
                    </td>
                    <td className="px-4 py-3.5">
                      <p
                        className="max-w-[150px] truncate font-bold"
                        style={{ color: "var(--tx)" }}
                      >
                        {order.customer.displayName ||
                          order.customer.telegramUsername ||
                          order.customer.telegramUserId}
                      </p>
                      {order.customer.telegramUsername ? (
                        <p className="mt-0.5" style={{ color: "var(--tx-f)" }}>
                          @{order.customer.telegramUsername}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3.5">
                      <p
                        className="max-w-[260px] truncate font-bold"
                        style={{ color: "var(--tx)" }}
                      >
                        {order.productName}
                      </p>
                    </td>
                    <td
                      className="px-4 py-3.5 text-center font-bold"
                      style={{ color: "var(--tx-m)" }}
                    >
                      {order.quantity}
                    </td>
                    <td
                      className="whitespace-nowrap px-4 py-3.5 text-right"
                      style={{ color: "var(--tx-m)" }}
                    >
                      {formatCurrency(order.totalSourceAmount)}
                    </td>
                    <td
                      className="whitespace-nowrap px-4 py-3.5 text-right font-bold"
                      style={{ color: "var(--tx)" }}
                    >
                      {formatCurrency(order.totalSaleAmount)}
                    </td>
                    <td
                      className={`whitespace-nowrap px-4 py-3.5 text-right font-black ${order.profit >= 0 ? "text-emerald-300" : "text-rose-300"}`}
                    >
                      {formatCurrency(order.profit)}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex flex-col items-start gap-1">
                        <Badge tone={statusTone(order.status)}>
                          {formatStatusLabel(order.status)}
                        </Badge>
                        <span
                          className="text-[10px]"
                          style={{ color: "var(--tx-f)" }}
                        >
                          {formatStatusLabel(order.paymentStatus)}
                        </span>
                      </div>
                    </td>
                    <td
                      className="whitespace-nowrap px-5 py-3.5"
                      style={{ color: "var(--tx-m)" }}
                    >
                      {formatDate(order.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {orderPagination && orderPagination.total > 0 && (
          <div className="flex flex-col gap-3 border-t border-white/[0.06] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[11px] font-bold" style={{ color: "var(--tx-m)" }}>
              {orderPagination.total.toLocaleString("vi-VN")} đơn · trang{" "}
              {orderPagination.page}/{orderPagination.totalPages}
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={orderPage <= 1 || sourceOrdersQuery.isFetching}
                onClick={() => setOrderPage((current) => Math.max(1, current - 1))}
              >
                <ChevronLeft className="h-4 w-4" /> Trang trước
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={
                  orderPage >= orderPagination.totalPages ||
                  sourceOrdersQuery.isFetching
                }
                onClick={() =>
                  setOrderPage((current) =>
                    Math.min(orderPagination.totalPages, current + 1),
                  )
                }
              >
                Trang sau <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
