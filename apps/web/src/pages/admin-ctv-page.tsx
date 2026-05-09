import type { AxiosError } from "axios";
import {
  LockKeyhole,
  PencilLine,
  Search,
  ShieldPlus,
  Store,
  Trash2,
  UnlockKeyhole,
  UserRoundPlus,
  Wallet,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { EmptyState } from "@/components/dashboard/empty-state";
import { Field } from "@/components/dashboard/field";
import { SectionHeading } from "@/components/dashboard/section-heading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { formatCurrency, formatDate, formatStatusLabel } from "@/lib/format";

type SellerAccount = {
  id: string;
  username: string;
  recoveryEmail: string | null;
  status: string;
  createdAt: string;
  displayName: string | null;
  sellerStatus: string | null;
  sellerTier: "free" | "pro" | "ultra" | null;
  sellerTierStartedAt: string | null;
  sellerTierExpiresAt: string | null;
  shopId: string | null;
  shopName: string | null;
  shopSlug: string | null;
  shopStatus: string | null;
  walletBalance: number;
  orderCount: number;
  customerCount: number;
  depositCount: number;
};

function getApiErrorMessage(error: unknown) {
  const axiosError = error as AxiosError<{ message?: string | string[] }>;
  const msg = axiosError.response?.data?.message;
  if (Array.isArray(msg)) return msg.join(", ");
  if (typeof msg === "string" && msg.trim()) return msg;
  return "Có lỗi xảy ra. Hãy kiểm tra lại dữ liệu rồi thử lại.";
}

function TierBadge({ tier }: { tier: SellerAccount["sellerTier"] }) {
  if (tier === "ultra")
    return (
      <span className="inline-flex items-center rounded-full border border-yellow-500/30 bg-yellow-500/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-yellow-300">
        ULTRA
      </span>
    );
  if (tier === "pro")
    return (
      <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-300">
        PRO
      </span>
    );
  return (
    <span className="inline-flex items-center rounded-full border border-white/10 bg-slate-700/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
      FREE
    </span>
  );
}

function toDateInputValue(iso: string | null | undefined) {
  if (!iso) return "";
  return iso.slice(0, 10);
}

function TierModal({
  account,
  onClose,
  onConfirm,
  loading,
}: {
  account: SellerAccount;
  onClose: () => void;
  onConfirm: (tier: "FREE" | "PRO" | "ULTRA", tierStartedAt: string | null, tierExpiresAt: string | null) => void;
  loading: boolean;
}) {
  const initialTier = (account.sellerTier?.toUpperCase() ?? "PRO") as "FREE" | "PRO" | "ULTRA";
  const [tier, setTier] = useState<"FREE" | "PRO" | "ULTRA">(initialTier);
  const [startedAt, setStartedAt] = useState(toDateInputValue(account.sellerTierStartedAt));
  const [expiresAt, setExpiresAt] = useState(toDateInputValue(account.sellerTierExpiresAt));
  const overlayRef = useRef<HTMLDivElement>(null);

  function handleStartedAtChange(val: string) {
    setStartedAt(val);
    // Tự tính expires = started + 30 ngày nếu chưa set expires
    if (val && !expiresAt) {
      const d = new Date(val);
      d.setDate(d.getDate() + 30);
      setExpiresAt(d.toISOString().slice(0, 10));
    }
  }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="w-full max-w-sm rounded-[20px] border border-white/10 bg-[#1e2a47] p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <p className="font-semibold text-white">Thay đổi gói CTV</p>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-2 text-sm text-slate-400">{account.displayName || account.username}</p>
        <div className="mt-4 space-y-2">
          {(["FREE", "PRO", "ULTRA"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTier(t)}
              className={`flex w-full items-center justify-between rounded-[12px] border px-4 py-3 text-sm font-semibold transition ${
                tier === t
                  ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-300"
                  : "border-white/8 bg-[#18233c] text-slate-300 hover:border-white/15"
              }`}
            >
              {t}
              {t === "FREE" && <span className="text-xs text-slate-500">Chỉ xem</span>}
              {t === "PRO" && <span className="text-xs text-slate-500">Seller thường</span>}
              {t === "ULTRA" && <span className="text-xs text-yellow-600">Nguồn nội bộ — chỉ admin cấp</span>}
            </button>
          ))}
        </div>
        <div className="mt-4 space-y-3">
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Ngày bắt đầu</p>
            <input
              type="date"
              value={startedAt}
              onChange={(e) => handleStartedAtChange(e.target.value)}
              className="w-full rounded-[12px] border border-white/10 bg-[#18233c] px-3 py-2 text-sm text-white outline-none focus:border-emerald-300/50"
            />
          </div>
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Ngày hết hạn</p>
            <input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="w-full rounded-[12px] border border-white/10 bg-[#18233c] px-3 py-2 text-sm text-white outline-none focus:border-emerald-300/50"
            />
          </div>
        </div>
        <div className="mt-4 flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={loading}>
            Hủy
          </Button>
          <Button
            className="flex-1"
            onClick={() =>
              onConfirm(
                tier,
                startedAt ? new Date(startedAt).toISOString() : null,
                expiresAt ? new Date(expiresAt).toISOString() : null,
              )
            }
            disabled={loading}
          >
            {loading ? "Đang lưu..." : "Lưu"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function CreateEditPanel({
  editingAccount,
  onCancel,
  onSuccess,
}: {
  editingAccount: SellerAccount | null;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const { showToast } = useToast();
  const [displayName, setDisplayName] = useState(editingAccount?.displayName || "");
  const [username, setUsername] = useState(editingAccount?.username || "");
  const [recoveryEmail, setRecoveryEmail] = useState(editingAccount?.recoveryEmail || "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [shopName, setShopName] = useState(editingAccount?.shopName || "");
  const [sellerTier, setSellerTier] = useState<string>(editingAccount?.sellerTier || "pro");

  const isEditMode = Boolean(editingAccount);

  const isFormInvalid = useMemo(() => {
    const re = recoveryEmail.trim();
    const badEmail = re.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(re);
    return (
      displayName.trim().length < 2 ||
      username.trim().length < 2 ||
      badEmail ||
      (isEditMode
        ? Boolean(password) && (password.length < 6 || confirmPassword !== password)
        : password.length < 6 || confirmPassword !== password)
    );
  }, [confirmPassword, displayName, isEditMode, password, recoveryEmail, username]);

  const createMutation = useMutation({
    mutationFn: () =>
      api.post("/admin/ctv", {
        displayName,
        username,
        recoveryEmail: recoveryEmail.trim() || undefined,
        password,
        shopName: shopName.trim() || undefined,
        sellerTier: sellerTier.toUpperCase(),
      }),
    onSuccess: async (res) => {
      showToast({ tone: "success", message: `Đã tạo tài khoản ${res.data.displayName}.` });
      onSuccess();
    },
    onError: (e) => showToast({ tone: "error", message: getApiErrorMessage(e) }),
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      api.put(`/admin/ctv/${editingAccount?.id}`, {
        displayName,
        username,
        recoveryEmail: recoveryEmail.trim() || null,
        password: password.trim() || undefined,
        shopName: shopName.trim() || undefined,
        sellerTier: sellerTier.toUpperCase(),
      }),
    onSuccess: async () => {
      showToast({ tone: "success", message: "Đã cập nhật tài khoản seller." });
      onSuccess();
    },
    onError: (e) => showToast({ tone: "error", message: getApiErrorMessage(e) }),
  });

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="font-semibold text-white">
          {isEditMode ? "Chỉnh sửa CTV" : "Tạo tài khoản CTV"}
        </p>
        {isEditMode && (
          <button type="button" onClick={onCancel} className="text-slate-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="mt-4 space-y-4">
        <Field label="Tên hiển thị">
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="VD: Seller Miền Nam" />
        </Field>
        <Field label="Username đăng nhập">
          <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="VD: sellermiennam" />
        </Field>
        <Field label="Email khôi phục" hint="Tùy chọn">
          <Input value={recoveryEmail} onChange={(e) => setRecoveryEmail(e.target.value)} placeholder="seller@example.com" type="email" />
        </Field>
        <Field label="Tên shop" hint="Tùy chọn">
          <Input value={shopName} onChange={(e) => setShopName(e.target.value)} placeholder="VD: Seller Miền Nam Shop" />
        </Field>
        <Field label="Gói">
          <select
            className="w-full rounded-[14px] border border-white/10 bg-[#121a2e] px-3 py-2.5 text-sm font-medium text-white outline-none focus:border-emerald-300/50"
            value={sellerTier}
            onChange={(e) => setSellerTier(e.target.value)}
          >
            <option value="free" className="bg-slate-950">FREE — Chỉ xem</option>
            <option value="pro" className="bg-slate-950">PRO — Seller thường</option>
            <option value="ultra" className="bg-slate-950">ULTRA — Nguồn nội bộ (chỉ admin cấp)</option>
          </select>
        </Field>
        <Field label="Mật khẩu" hint={isEditMode ? "Để trống nếu không đổi" : "Tối thiểu 6 ký tự"}>
          <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder={isEditMode ? "Để trống nếu không đổi" : "Nhập mật khẩu"} type="password" />
        </Field>
        <Field label="Xác nhận mật khẩu">
          <Input value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Nhập lại mật khẩu" type="password" />
        </Field>
        <Button className="w-full" disabled={isSubmitting || isFormInvalid} onClick={() => isEditMode ? updateMutation.mutate() : createMutation.mutate()}>
          {isSubmitting ? (isEditMode ? "Đang lưu..." : "Đang tạo...") : (isEditMode ? "Lưu thay đổi" : "Tạo tài khoản")}
        </Button>
        {isEditMode && (
          <Button className="w-full" variant="secondary" onClick={onCancel}>
            Hủy chỉnh sửa
          </Button>
        )}
      </div>
    </Card>
  );
}

export function AdminCtvPage() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [search, setSearch] = useState("");
  const [filterTier, setFilterTier] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [editingAccount, setEditingAccount] = useState<SellerAccount | null>(null);
  const [tierModalAccount, setTierModalAccount] = useState<SellerAccount | null>(null);
  const [showCreatePanel, setShowCreatePanel] = useState(false);

  const accountsQuery = useQuery({
    queryKey: ["admin", "sellers", { filterTier, filterStatus, search }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterTier) params.set("tier", filterTier.toUpperCase());
      if (filterStatus) params.set("status", filterStatus.toUpperCase());
      if (search) params.set("search", search);
      return (await api.get<SellerAccount[]>(`/admin/sellers?${params}`)).data;
    },
  });

  const tierMutation = useMutation({
    mutationFn: async ({ userId, tier, tierStartedAt, tierExpiresAt }: { userId: string; tier: string; tierStartedAt: string | null; tierExpiresAt: string | null }) => {
      await api.put(`/admin/sellers/${userId}/tier`, { tier });
      await api.put(`/admin/sellers/${userId}/tier-dates`, { tierStartedAt, tierExpiresAt });
    },
    onSuccess: async () => {
      showToast({ tone: "success", message: "Đã cập nhật gói CTV." });
      setTierModalAccount(null);
      await queryClient.invalidateQueries({ queryKey: ["admin", "sellers"] });
    },
    onError: (e) => showToast({ tone: "error", message: getApiErrorMessage(e) }),
  });

  const statusMutation = useMutation({
    mutationFn: ({ account, action }: { account: SellerAccount; action: "lock" | "unlock" }) =>
      api.post(`/admin/ctv/${account.id}/${action}`),
    onSuccess: async (res) => {
      showToast({ tone: "success", message: res.data?.message || "Đã cập nhật trạng thái." });
      await queryClient.invalidateQueries({ queryKey: ["admin", "sellers"] });
    },
    onError: (e) => showToast({ tone: "error", message: getApiErrorMessage(e) }),
  });

  const deleteMutation = useMutation({
    mutationFn: ({ account, force }: { account: SellerAccount; force?: boolean }) =>
      api.delete(`/admin/ctv/${account.id}${force ? "?force=true" : ""}`),
    onSuccess: async (_, { account }) => {
      showToast({ tone: "success", message: `Đã xóa tài khoản ${account.username}.` });
      if (editingAccount?.id === account.id) setEditingAccount(null);
      await queryClient.invalidateQueries({ queryKey: ["admin", "sellers"] });
    },
    onError: (e) => showToast({ tone: "error", message: getApiErrorMessage(e) }),
  });

  const accounts = accountsQuery.data || [];

  function handleFormSuccess() {
    setEditingAccount(null);
    setShowCreatePanel(false);
    queryClient.invalidateQueries({ queryKey: ["admin", "sellers"] });
  }

  const showSidePanel = showCreatePanel || Boolean(editingAccount);

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Quản trị hệ thống"
        title="Tài khoản CTV"
        description="Tạo và quản lý tài khoản seller theo gói FREE / PRO / ULTRA."
      />

      {tierModalAccount && (
        <TierModal
          account={tierModalAccount}
          onClose={() => setTierModalAccount(null)}
          onConfirm={(tier, tierStartedAt, tierExpiresAt) => tierMutation.mutate({ userId: tierModalAccount.id, tier, tierStartedAt, tierExpiresAt })}
          loading={tierMutation.isPending}
        />
      )}

      <div className={`grid gap-6 ${showSidePanel ? "xl:grid-cols-[1fr_340px]" : ""}`}>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                className="w-full rounded-[12px] border border-white/10 bg-[#18233c] py-2.5 pl-9 pr-4 text-sm text-white placeholder-slate-500 outline-none focus:border-emerald-300/40"
                placeholder="Tìm theo email hoặc tên..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select
              className="rounded-[12px] border border-white/10 bg-[#18233c] px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-300/40"
              value={filterTier}
              onChange={(e) => setFilterTier(e.target.value)}
            >
              <option value="" className="bg-slate-950">Tất cả gói</option>
              <option value="free" className="bg-slate-950">FREE</option>
              <option value="pro" className="bg-slate-950">PRO</option>
              <option value="ultra" className="bg-slate-950">ULTRA</option>
            </select>
            <select
              className="rounded-[12px] border border-white/10 bg-[#18233c] px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-300/40"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="" className="bg-slate-950">Tất cả trạng thái</option>
              <option value="active" className="bg-slate-950">Active</option>
              <option value="disabled" className="bg-slate-950">Disabled</option>
            </select>
            <Button
              size="sm"
              onClick={() => { setShowCreatePanel(true); setEditingAccount(null); }}
            >
              <UserRoundPlus className="h-4 w-4" />
              Tạo CTV
            </Button>
          </div>

          <Card className="p-0 overflow-hidden">
            {accounts.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title="Không có tài khoản"
                  description="Chưa có CTV nào khớp với bộ lọc hiện tại."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/6">
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">CTV</th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Gói</th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Shop</th>
                      <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">Ví</th>
                      <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">Đơn</th>
                      <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">Ngày tạo</th>
                      <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">Hành động</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map((account) => (
                      <tr
                        key={account.id}
                        className={`border-b border-white/4 transition hover:bg-white/[0.02] ${editingAccount?.id === account.id ? "bg-emerald-500/5" : ""}`}
                      >
                        <td className="px-4 py-3">
                          <p className="font-semibold text-white">{account.displayName || account.username}</p>
                          <p className="text-xs text-slate-400">{account.username}</p>
                          {account.status !== "active" && (
                            <span className="mt-1 inline-flex items-center rounded-full border border-red-500/30 bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-300">
                              {formatStatusLabel(account.status)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <TierBadge tier={account.sellerTier} />
                          {account.sellerTierExpiresAt && (
                            <p className="mt-0.5 text-[11px] text-slate-500">
                              đến {new Date(account.sellerTierExpiresAt).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" })}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-slate-300">{account.shopName || "—"}</p>
                          {account.shopStatus && account.shopStatus !== "active" && (
                            <p className="text-xs text-slate-500">{formatStatusLabel(account.shopStatus)}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-white">
                          {formatCurrency(account.walletBalance)}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-300">
                          {account.orderCount}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-400 text-xs">
                          {formatDate(account.createdAt)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              title="Đổi gói"
                              onClick={() => setTierModalAccount(account)}
                              className="rounded-[8px] border border-white/8 bg-[#18233c] p-1.5 text-slate-400 transition hover:text-emerald-300"
                            >
                              <ShieldPlus className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              title="Chỉnh sửa"
                              onClick={() => { setEditingAccount(account); setShowCreatePanel(false); }}
                              className="rounded-[8px] border border-white/8 bg-[#18233c] p-1.5 text-slate-400 transition hover:text-white"
                            >
                              <PencilLine className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              title={account.status === "active" ? "Khóa" : "Mở khóa"}
                              onClick={() =>
                                statusMutation.mutate({
                                  account,
                                  action: account.status === "active" ? "lock" : "unlock",
                                })
                              }
                              className="rounded-[8px] border border-white/8 bg-[#18233c] p-1.5 text-slate-400 transition hover:text-yellow-300"
                            >
                              {account.status === "active" ? (
                                <LockKeyhole className="h-3.5 w-3.5" />
                              ) : (
                                <UnlockKeyhole className="h-3.5 w-3.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              title="Xóa"
                              disabled={deleteMutation.isPending}
                              onClick={() => {
                                const hasData = account.orderCount > 0 || account.depositCount > 0 || account.walletBalance > 0;
                                if (hasData) {
                                  const msg = [
                                    `Tài khoản ${account.username} có dữ liệu:`,
                                    account.orderCount > 0 ? `• ${account.orderCount} đơn hàng` : null,
                                    account.depositCount > 0 ? `• ${account.depositCount} giao dịch nạp` : null,
                                    account.walletBalance > 0 ? `• Số dư ${account.walletBalance.toLocaleString()}₫` : null,
                                    "",
                                    "Xóa sẽ mất toàn bộ dữ liệu. Tiếp tục?",
                                  ].filter((l) => l !== null).join("\n");
                                  if (confirm(msg)) deleteMutation.mutate({ account, force: true });
                                } else {
                                  if (confirm(`Xóa tài khoản ${account.username}?`))
                                    deleteMutation.mutate({ account });
                                }
                              }}
                              className="rounded-[8px] border border-white/8 bg-[#18233c] p-1.5 text-slate-400 transition hover:text-red-400 disabled:opacity-40"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <p className="text-xs text-slate-500">{accounts.length} tài khoản</p>
        </div>

        {showSidePanel && (
          <CreateEditPanel
            editingAccount={editingAccount}
            onCancel={() => { setEditingAccount(null); setShowCreatePanel(false); }}
            onSuccess={handleFormSuccess}
          />
        )}
      </div>
    </div>
  );
}
