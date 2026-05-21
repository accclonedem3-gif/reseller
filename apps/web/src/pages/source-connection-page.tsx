import type { AxiosError } from "axios";
import { RefreshCcw, Wallet, Wifi, WifiOff } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/auth/auth-provider";
import { Field } from "@/components/dashboard/field";
import { SectionHeading } from "@/components/dashboard/section-heading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/format";
import { hasSellerCapability } from "@/lib/seller-access";
import { useLang } from "@/lib/lang";

const T = {
  vi: {
    gateKicker: "Quyền truy cập nguồn",
    gateTitle: "Tính năng này không khả dụng",
    gateDesc: "Tài khoản của bạn không có quyền kết nối nguồn PRO nội bộ. Vui lòng nâng cấp gói để tiếp tục.",
    eyebrow: "Kết nối nguồn",
    title: "Kết nối nguồn PRO",
    desc: "Kết nối shop của bạn với nguồn sản phẩm từ seller cấp PRO để tự động đồng bộ catalog và xử lý đơn hàng.",
    statusKicker: "Trạng thái kết nối",
    loading: "Đang tải...",
    connected: "Đang hoạt động",
    notConnected: "Chưa kết nối với nguồn PRO nào.",
    fieldSource: "Nguồn PRO",
    fieldSeller: "Seller",
    fieldBalance: "Số dư nguồn",
    fieldLastSync: "Lần sync cuối",
    fieldLastOrder: "Đơn hàng cuối",
    fieldApiKey: "API Key",
    neverSync: "Chưa sync",
    noOrder: "Chưa có",
    syncCatalog: "Sync catalog",
    topup: "Nạp tiền",
    topupKicker: "Nạp ví kết nối",
    topupTitle: "Nạp tiền qua PayOS",
    topupDesc: "Nhập số tiền cần nạp (VND). Tối thiểu 10,000đ.",
    topupPh: "100000",
    topupCreating: "Đang tạo...",
    topupBtn: "Tạo lệnh nạp",
    topupMinErr: "Tối thiểu 10,000đ.",
    connectKicker: (connected: boolean) => connected ? "Thay đổi kết nối" : "Kết nối mới",
    connectTitle: (connected: boolean) => connected ? "Kết nối lại với key mới" : "Nhập API key từ nguồn PRO",
    connectDesc: "Liên hệ seller PRO để nhận API key dạng",
    connectNote: "Kết nối hiện tại sẽ được cập nhật với key mới. Số dư sẽ được giữ nguyên.",
    connecting: "Đang kết nối...",
    connect: "Kết nối",
    toastConnected: "Kết nối nguồn thành công! Đang đồng bộ sản phẩm...",
    toastSynced: (n: number) => `Đã đồng bộ ${n} sản phẩm từ nguồn.`,
    toastTopup: "Đã tạo lệnh nạp tiền. Vui lòng hoàn tất thanh toán.",
    statusLabels: { active: "Đang hoạt động", pending: "Đang xử lý", disabled: "Đã vô hiệu", revoked: "Đã thu hồi" },
  },
  en: {
    gateKicker: "Source access",
    gateTitle: "This feature is not available",
    gateDesc: "Your account does not have access to connect an internal PRO source. Please upgrade your plan to continue.",
    eyebrow: "Source connection",
    title: "Connect PRO source",
    desc: "Connect your shop to a PRO seller's source to automatically sync the catalog and process orders.",
    statusKicker: "Connection status",
    loading: "Loading...",
    connected: "Active",
    notConnected: "Not connected to any PRO source.",
    fieldSource: "PRO source",
    fieldSeller: "Seller",
    fieldBalance: "Source balance",
    fieldLastSync: "Last sync",
    fieldLastOrder: "Last order",
    fieldApiKey: "API Key",
    neverSync: "Never synced",
    noOrder: "None",
    syncCatalog: "Sync catalog",
    topup: "Top up",
    topupKicker: "Top up wallet",
    topupTitle: "Top up via PayOS",
    topupDesc: "Enter the amount to top up (VND). Minimum 10,000₫.",
    topupPh: "100000",
    topupCreating: "Creating...",
    topupBtn: "Create top-up",
    topupMinErr: "Minimum 10,000₫.",
    connectKicker: (connected: boolean) => connected ? "Change connection" : "New connection",
    connectTitle: (connected: boolean) => connected ? "Reconnect with new key" : "Enter API key from PRO source",
    connectDesc: "Contact the PRO seller to get an API key in the format",
    connectNote: "The current connection will be updated with the new key. Balance will be kept.",
    connecting: "Connecting...",
    connect: "Connect",
    toastConnected: "Source connected! Syncing products...",
    toastSynced: (n: number) => `Synced ${n} products from source.`,
    toastTopup: "Top-up order created. Please complete the payment.",
    statusLabels: { active: "Active", pending: "Pending", disabled: "Disabled", revoked: "Revoked" },
  },
  th: {
    gateKicker: "การเข้าถึงแหล่งสินค้า",
    gateTitle: "ฟีเจอร์นี้ไม่พร้อมใช้งาน",
    gateDesc: "บัญชีของคุณไม่มีสิทธิ์เชื่อมต่อแหล่งสินค้า PRO ภายใน กรุณาอัปเกรดแพ็กเกจเพื่อดำเนินการต่อ",
    eyebrow: "การเชื่อมต่อแหล่งสินค้า",
    title: "เชื่อมต่อแหล่งสินค้า PRO",
    desc: "เชื่อมต่อร้านค้าของคุณกับแหล่งสินค้าจาก seller ระดับ PRO เพื่อซิงค์แคตตาล็อกและจัดการคำสั่งซื้ออัตโนมัติ",
    statusKicker: "สถานะการเชื่อมต่อ",
    loading: "กำลังโหลด...",
    connected: "เชื่อมต่อแล้ว",
    notConnected: "ยังไม่ได้เชื่อมต่อกับแหล่งสินค้า PRO",
    fieldSource: "แหล่งสินค้า PRO",
    fieldSeller: "Seller",
    fieldBalance: "ยอดคงเหลือ",
    fieldLastSync: "ซิงค์ล่าสุด",
    fieldLastOrder: "คำสั่งซื้อล่าสุด",
    fieldApiKey: "API Key",
    neverSync: "ยังไม่เคยซิงค์",
    noOrder: "ยังไม่มี",
    syncCatalog: "ซิงค์แคตตาล็อก",
    topup: "เติมเงิน",
    topupKicker: "เติมกระเป๋าเงิน",
    topupTitle: "เติมเงินผ่าน PayOS",
    topupDesc: "ระบุจำนวนเงินที่ต้องการเติม (VND) ขั้นต่ำ 10,000₫",
    topupPh: "100000",
    topupCreating: "กำลังสร้าง...",
    topupBtn: "สร้างคำสั่งเติมเงิน",
    topupMinErr: "ขั้นต่ำ 10,000₫",
    connectKicker: (connected: boolean) => connected ? "เปลี่ยนการเชื่อมต่อ" : "เชื่อมต่อใหม่",
    connectTitle: (connected: boolean) => connected ? "เชื่อมต่อใหม่ด้วย key ใหม่" : "ใส่ API key จากแหล่งสินค้า PRO",
    connectDesc: "ติดต่อ seller PRO เพื่อรับ API key ในรูปแบบ",
    connectNote: "การเชื่อมต่อปัจจุบันจะถูกอัปเดตด้วย key ใหม่ ยอดคงเหลือจะยังคงเดิม",
    connecting: "กำลังเชื่อมต่อ...",
    connect: "เชื่อมต่อ",
    toastConnected: "เชื่อมต่อแหล่งสินค้าสำเร็จ! กำลังซิงค์สินค้า...",
    toastSynced: (n: number) => `ซิงค์ ${n} สินค้าจากแหล่งสินค้าแล้ว`,
    toastTopup: "สร้างคำสั่งเติมเงินแล้ว กรุณาดำเนินการชำระเงิน",
    statusLabels: { active: "ใช้งานอยู่", pending: "รอดำเนินการ", disabled: "ปิดใช้งาน", revoked: "ถูกเพิกถอน" },
  },
};

type SourceConnection = {
  id: string;
  status: string;
  balance: number;
  currency: string;
  lastCatalogSyncAt: string | null;
  lastOrderedAt: string | null;
  apiKey: {
    id: string;
    label: string;
    keyPrefix: string;
    status: string;
    expiresAt: string | null;
  } | null;
  upstreamSeller: { id: string; displayName: string; tier: string };
  upstreamShop: { id: string; name: string; slug: string };
};

function getApiError(error: unknown, fallback: string) {
  const axiosError = error as AxiosError<{ message?: string | string[] }>;
  const msg = axiosError.response?.data?.message;
  if (Array.isArray(msg)) return msg.join(", ");
  if (typeof msg === "string" && msg.trim()) return msg;
  return fallback;
}

function StatusBadge({ status, labels }: { status: string; labels: Record<string, string> }) {
  const normalized = status.toLowerCase();
  const tone =
    normalized === "active"
      ? "success"
      : ["disabled", "revoked"].includes(normalized)
        ? "danger"
        : "warning";
  return <Badge tone={tone}>{labels[normalized] ?? normalized}</Badge>;
}

export function SourceConnectionPage() {
  const { session } = useAuth();
  const { lang } = useLang();
  const t = T[lang];
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [topupAmount, setTopupAmount] = useState("");
  const [showTopupForm, setShowTopupForm] = useState(false);

  const canUse = hasSellerCapability(session, "source_internal_use");

  const connectionQuery = useQuery({
    queryKey: ["seller-source-connection"],
    queryFn: async () =>
      (await api.get<SourceConnection | null>("/seller/source-connection")).data,
    enabled: canUse,
  });

  const connectMutation = useMutation({
    mutationFn: async (apiKey: string) =>
      (await api.post<SourceConnection>("/seller/source-connection", { apiKey })).data,
    onSuccess: async (data) => {
      queryClient.setQueryData(["seller-source-connection"], data);
      setApiKeyInput("");
      showToast({ tone: "success", message: t.toastConnected });
      try {
        const syncResult = await api.post<{ synced: number }>("/seller/source-connection/sync-catalog");
        showToast({ tone: "success", message: t.toastSynced(syncResult.data.synced) });
        queryClient.invalidateQueries({ queryKey: ["seller-source-connection"] });
      } catch {
        // sync error is non-fatal
      }
    },
    onError: (err) => showToast({ tone: "error", message: getApiError(err, t.gateDesc) }),
  });

  const syncMutation = useMutation({
    mutationFn: async () =>
      (await api.post<{ synced: number }>("/seller/source-connection/sync-catalog")).data,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["seller-source-connection"] });
      showToast({ tone: "success", message: t.toastSynced(data.synced) });
    },
    onError: (err) => showToast({ tone: "error", message: getApiError(err, t.gateDesc) }),
  });

  const topupMutation = useMutation({
    mutationFn: async (amount: number) =>
      (await api.post<{ checkoutUrl: string; qrCode: string | null; expiresAt: string; amount: number }>(
        "/seller/source-connection/topup-payos",
        { amount },
      )).data,
    onSuccess: (data) => {
      setShowTopupForm(false);
      setTopupAmount("");
      if (data.checkoutUrl) window.open(data.checkoutUrl, "_blank");
      showToast({ tone: "success", message: t.toastTopup });
    },
    onError: (err) => showToast({ tone: "error", message: getApiError(err, t.gateDesc) }),
  });

  if (!canUse) {
    return (
      <Card>
        <p className="app-kicker">{t.gateKicker}</p>
        <h2 className="mt-3 font-display text-3xl font-semibold text-white">{t.gateTitle}</h2>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-400">{t.gateDesc}</p>
      </Card>
    );
  }

  const connection = connectionQuery.data;
  const isConnected = Boolean(connection && connection.status === "active");

  return (
    <div className="space-y-6">
      <SectionHeading eyebrow={t.eyebrow} title={t.title} description={t.desc} />

      <Card>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="app-kicker">{t.statusKicker}</p>
            {connectionQuery.isLoading ? (
              <p className="text-sm text-slate-400">{t.loading}</p>
            ) : isConnected && connection ? (
              <div className="mt-3 space-y-4">
                <div className="flex items-center gap-2">
                  <Wifi className="h-4 w-4 text-emerald-400" />
                  <StatusBadge status={connection.status} labels={t.statusLabels} />
                </div>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <Field label={t.fieldSource}>
                    <span className="text-white">{connection.upstreamShop.name}</span>
                  </Field>
                  <Field label={t.fieldSeller}>
                    <span className="text-white">{connection.upstreamSeller.displayName}</span>
                  </Field>
                  <Field label={t.fieldBalance}>
                    <span className="font-semibold text-emerald-400">
                      {formatCurrency(connection.balance)}
                    </span>
                  </Field>
                  <Field label={t.fieldLastSync}>
                    <span className="text-slate-300">
                      {connection.lastCatalogSyncAt ? formatDate(connection.lastCatalogSyncAt) : t.neverSync}
                    </span>
                  </Field>
                  <Field label={t.fieldLastOrder}>
                    <span className="text-slate-300">
                      {connection.lastOrderedAt ? formatDate(connection.lastOrderedAt) : t.noOrder}
                    </span>
                  </Field>
                  {connection.apiKey && (
                    <Field label={t.fieldApiKey}>
                      <span className="font-mono text-xs text-slate-300">
                        {connection.apiKey.keyPrefix}…
                      </span>
                    </Field>
                  )}
                </div>
              </div>
            ) : (
              <div className="mt-3 flex items-center gap-2 text-slate-400">
                <WifiOff className="h-4 w-4" />
                <span className="text-sm">{t.notConnected}</span>
              </div>
            )}
          </div>

          {isConnected && (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
              >
                <RefreshCcw className={`h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
                {t.syncCatalog}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setShowTopupForm((v) => !v)}>
                <Wallet className="h-4 w-4" />
                {t.topup}
              </Button>
            </div>
          )}
        </div>
      </Card>

      {isConnected && showTopupForm && (
        <Card>
          <p className="app-kicker">{t.topupKicker}</p>
          <h3 className="mt-2 text-lg font-semibold text-white">{t.topupTitle}</h3>
          <p className="mt-1 text-sm text-slate-400">{t.topupDesc}</p>
          <div className="mt-5 flex max-w-xs gap-3">
            <Input
              type="number"
              placeholder={t.topupPh}
              value={topupAmount}
              onChange={(e) => setTopupAmount(e.target.value)}
              min={10000}
              step={10000}
            />
            <Button
              onClick={() => {
                const amt = parseInt(topupAmount.replace(/[,.]/g, ""), 10);
                if (!Number.isInteger(amt) || amt < 10000) {
                  showToast({ tone: "error", message: t.topupMinErr });
                  return;
                }
                topupMutation.mutate(amt);
              }}
              disabled={topupMutation.isPending || !topupAmount}
            >
              {topupMutation.isPending ? t.topupCreating : t.topupBtn}
            </Button>
          </div>
        </Card>
      )}

      <Card>
        <p className="app-kicker">{t.connectKicker(isConnected)}</p>
        <h3 className="mt-2 text-lg font-semibold text-white">{t.connectTitle(isConnected)}</h3>
        <p className="mt-1 text-sm text-slate-400">
          {t.connectDesc}{" "}
          <code className="rounded bg-white/5 px-1 py-0.5 text-xs text-emerald-300">isk_…</code>
          {lang === "vi" ? ", sau đó dán vào đây." : lang === "th" ? " แล้ววางที่นี่" : ", then paste it here."}
        </p>

        <div className="mt-5 flex max-w-xl gap-3">
          <Input
            placeholder="isk_xxxxxxxxxxxxxxxxxxxx"
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            className="font-mono text-sm"
          />
          <Button
            onClick={() => connectMutation.mutate(apiKeyInput.trim())}
            disabled={connectMutation.isPending || !apiKeyInput.trim()}
          >
            {connectMutation.isPending ? t.connecting : t.connect}
          </Button>
        </div>

        {isConnected && (
          <p className="mt-3 text-xs text-slate-500">{t.connectNote}</p>
        )}
      </Card>
    </div>
  );
}
