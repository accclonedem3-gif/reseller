import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Lock, Mail, Pencil, ShieldCheck, Store, User, X } from "lucide-react";

import { useAuth } from "@/auth/auth-provider";
import { ReadOnlyNotice } from "@/components/ui/read-only-notice";
import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { useLang } from "@/lib/lang";

const T = {
  vi: {
    title: "Hồ sơ",
    cardAccount: "Tài khoản",
    cardShop: "Shop đang vận hành",
    cardRecovery: "Email khôi phục",
    cardSecurity: "Đổi mật khẩu",
    displayName: "Tên hiển thị",
    username: "Username",
    recoveryEmail: "Email khôi phục",
    systemRole: "Vai trò",
    businessTier: "Gói tài khoản",
    expiresAt: "Hết hạn",
    shopName: "Tên shop",
    tagline: "Tagline",
    supportTelegram: "Telegram hỗ trợ",
    supportZalo: "Zalo hỗ trợ",
    warrantyLink: "Link bảo hành",
    notSet: "Chưa thêm",
    noTagline: "Chưa có tagline",
    copyLink: "Sao chép",
    copied: "Đã sao chép!",
    editShop: "Chỉnh sửa",
    cancel: "Hủy",
    saveShop: "Lưu thay đổi",
    savingShop: "Đang lưu...",
    shopSaved: "Đã cập nhật thông tin shop.",
    recoveryDesc: "Dùng khi quên thông tin đăng nhập",
    saveEmail: "Lưu email",
    saving: "Đang lưu...",
    minChars: "Tối thiểu 6 ký tự",
    currentPassword: "Mật khẩu hiện tại",
    newPassword: "Mật khẩu mới",
    confirmPassword: "Xác nhận mật khẩu mới",
    changePassword: "Cập nhật mật khẩu",
    changing: "Đang cập nhật...",
    statOrders: "Đơn tháng này",
    statProfit: "Lợi nhuận",
    statUsers: "Người dùng",
    statDaysLeft: "Ngày còn lại",
    daysLeft: (n: number) => `còn ${n} ngày`,
  },
  en: {
    title: "Profile",
    cardAccount: "Account",
    cardShop: "Active Shop",
    cardRecovery: "Recovery Email",
    cardSecurity: "Change Password",
    displayName: "Display Name",
    username: "Username",
    recoveryEmail: "Recovery Email",
    systemRole: "Role",
    businessTier: "Account Tier",
    expiresAt: "Expires",
    shopName: "Shop Name",
    tagline: "Tagline",
    supportTelegram: "Telegram Support",
    supportZalo: "Zalo Support",
    warrantyLink: "Warranty Link",
    notSet: "Not set",
    noTagline: "No tagline",
    copyLink: "Copy",
    copied: "Copied!",
    editShop: "Edit",
    cancel: "Cancel",
    saveShop: "Save Changes",
    savingShop: "Saving...",
    shopSaved: "Shop info updated.",
    recoveryDesc: "Used to reset your password if you lose access",
    saveEmail: "Save Email",
    saving: "Saving...",
    minChars: "Minimum 6 characters",
    currentPassword: "Current Password",
    newPassword: "New Password",
    confirmPassword: "Confirm New Password",
    changePassword: "Update Password",
    changing: "Updating...",
    statOrders: "Orders this month",
    statProfit: "Profit",
    statUsers: "Bot users",
    statDaysLeft: "Days left",
    daysLeft: (n: number) => `${n} days left`,
  },
  th: {
    title: "โปรไฟล์",
    cardAccount: "บัญชี",
    cardShop: "ร้านค้าที่ใช้งาน",
    cardRecovery: "อีเมลกู้คืน",
    cardSecurity: "เปลี่ยนรหัสผ่าน",
    displayName: "ชื่อที่แสดง",
    username: "ชื่อผู้ใช้",
    recoveryEmail: "อีเมลกู้คืน",
    systemRole: "บทบาท",
    businessTier: "แพ็กเกจ",
    expiresAt: "หมดอายุ",
    shopName: "ชื่อร้านค้า",
    tagline: "คำโปรย",
    supportTelegram: "Telegram ช่วยเหลือ",
    supportZalo: "Zalo ช่วยเหลือ",
    warrantyLink: "ลิงก์รับประกัน",
    notSet: "ยังไม่ได้ตั้งค่า",
    noTagline: "ยังไม่มีคำโปรย",
    copyLink: "คัดลอก",
    copied: "คัดลอกแล้ว!",
    editShop: "แก้ไข",
    cancel: "ยกเลิก",
    saveShop: "บันทึก",
    savingShop: "กำลังบันทึก...",
    shopSaved: "อัปเดตข้อมูลร้านค้าแล้ว",
    recoveryDesc: "ใช้รับลิงก์รีเซ็ตรหัสผ่านเมื่อเข้าถึงบัญชีไม่ได้",
    saveEmail: "บันทึกอีเมล",
    saving: "กำลังบันทึก...",
    minChars: "อย่างน้อย 6 ตัวอักษร",
    currentPassword: "รหัสผ่านปัจจุบัน",
    newPassword: "รหัสผ่านใหม่",
    confirmPassword: "ยืนยันรหัสผ่านใหม่",
    changePassword: "อัปเดตรหัสผ่าน",
    changing: "กำลังอัปเดต...",
    statOrders: "คำสั่งเดือนนี้",
    statProfit: "กำไร",
    statUsers: "ผู้ใช้บอท",
    statDaysLeft: "วันที่เหลือ",
    daysLeft: (n: number) => `เหลือ ${n} วัน`,
  },
} as const;

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3" style={{ borderBottom: "1px solid var(--bd)" }}>
      <span className="shrink-0 text-[12px]" style={{ color: "var(--tx-f)" }}>{label}</span>
      <span className="text-right text-[13px] font-semibold" style={{ color: "var(--tx)" }}>{children}</span>
    </div>
  );
}

function TierBadge({ tier }: { tier: string | null | undefined }) {
  if (!tier) return null;
  const isUltra = tier === "ultra";
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-black"
      style={isUltra
        ? { background: "rgba(139,92,246,0.15)", color: "rgb(167,139,250)" }
        : { background: "rgba(249,115,22,0.12)", color: "rgb(249,115,22)" }}>
      {isUltra && "★ "}{tier.charAt(0).toUpperCase() + tier.slice(1)}
    </span>
  );
}

function Alert({ type, children }: { type: "error" | "success"; children: React.ReactNode }) {
  return (
    <div className="rounded-xl px-4 py-3 text-[13px]"
      style={type === "error"
        ? { background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "rgb(239,68,68)" }
        : { background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)", color: "rgb(16,185,129)" }}>
      {children}
    </div>
  );
}

function CardSection({ icon: Icon, title, right, children }: {
  icon: React.ElementType; title: string; right?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
      <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--bd)" }}>
        <div className="flex items-center gap-2.5">
          <Icon className="h-4 w-4" style={{ color: "rgb(249,115,22)" }} />
          <h2 className="text-[15px] font-black" style={{ color: "var(--tx)" }}>{title}</h2>
        </div>
        {right}
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

const inputCls = "w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors";
const inputStyle = { background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx)" };

export function ProfilePage() {
  const { session, changePassword, updateRecoveryEmail } = useAuth();
  const { lang } = useLang();
  const t = T[lang];
  const queryClient = useQueryClient();

  const shopQuery = useQuery({
    queryKey: ["shop", "profile"],
    queryFn: async () => (await api.get("/shops/current")).data,
  });

  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const monthEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const revenueQuery = useQuery({
    queryKey: ["reports", "revenue", monthStart, monthEnd],
    queryFn: async () => (await api.get("/reports/revenue", { params: { startDate: monthStart, endDate: monthEnd } })).data,
  });

  const walletsQuery = useQuery({
    queryKey: ["wallet", "customer-wallets"],
    queryFn: async () => (await api.get("/wallet/customer-wallets")).data,
  });

  const shopData = shopQuery.data;
  const revSummary = revenueQuery.data?.summary;
  const usersCount = walletsQuery.data?.items?.length ?? 0;

  const daysLeft = (() => {
    if (!session?.user.sellerTierExpiresAt) return null;
    const diff = Math.ceil((new Date(session.user.sellerTierExpiresAt).getTime() - Date.now()) / 86400000);
    return diff > 0 ? diff : 0;
  })();

  const avatarInitials = (session?.user.displayName || session?.user.email || "S").slice(0, 2).toUpperCase();

  // ── shop edit ──────────────────────────────────
  const [editingShop, setEditingShop] = useState(false);
  const [shopForm, setShopForm] = useState({ name: "", tagline: "", supportTelegram: "", supportZalo: "" });
  const [shopError, setShopError] = useState<string | null>(null);
  const [shopSuccess, setShopSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (shopData && !editingShop) {
      setShopForm({
        name: shopData.name || "", tagline: shopData.tagline || "",
        supportTelegram: shopData.supportTelegram || "", supportZalo: shopData.supportZalo || "",
      });
    }
  }, [shopData, editingShop]);

  const shopMutation = useMutation({
    mutationFn: (form: typeof shopForm) => api.put("/shops/current", form),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["shop", "profile"] });
      void queryClient.invalidateQueries({ queryKey: ["shop"] });
      setEditingShop(false);
      setShopError(null);
      setShopSuccess(t.shopSaved);
      setTimeout(() => setShopSuccess(null), 3000);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setShopError(msg || "Không thể cập nhật thông tin shop.");
    },
  });

  function handleShopSave(e: React.FormEvent) {
    e.preventDefault();
    setShopError(null);
    if (!shopForm.name.trim() || shopForm.name.trim().length < 2) {
      setShopError("Tên shop phải có ít nhất 2 ký tự.");
      return;
    }
    shopMutation.mutate(shopForm);
  }

  function cancelEdit() {
    setEditingShop(false);
    setShopError(null);
    if (shopData) setShopForm({ name: shopData.name || "", tagline: shopData.tagline || "", supportTelegram: shopData.supportTelegram || "", supportZalo: shopData.supportZalo || "" });
  }

  // ── password / recovery ────────────────────────
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword]         = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [recoveryEmail, setRecoveryEmail]     = useState(session?.user.recoveryEmail || "");
  const [error, setError]             = useState<string | null>(null);
  const [success, setSuccess]         = useState<string | null>(null);
  const [emailError, setEmailError]   = useState<string | null>(null);
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting]     = useState(false);
  const [emailSubmitting, setEmailSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => { setRecoveryEmail(session?.user.recoveryEmail || ""); }, [session?.user.recoveryEmail]);

  const shopSlug     = shopData?.slug as string | undefined;
  const warrantyLink = shopSlug ? `${window.location.origin}/bao-hanh?shop=${shopSlug}` : null;

  function handleCopyLink() {
    if (!warrantyLink) return;
    navigator.clipboard.writeText(warrantyLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function handleUpdateRecoveryEmail(e: React.FormEvent) {
    e.preventDefault();
    setEmailError(null); setEmailSuccess(null);
    const normalizedEmail = recoveryEmail.trim();
    if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setEmailError("Email không hợp lệ.");
      return;
    }
    try {
      setEmailSubmitting(true);
      await updateRecoveryEmail(normalizedEmail || null);
      setEmailSuccess(normalizedEmail ? "Đã lưu email khôi phục." : "Đã xóa email khôi phục.");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setEmailError(msg || "Không thể cập nhật email.");
    } finally { setEmailSubmitting(false); }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setSuccess(null);
    if (!currentPassword || !newPassword || !confirmPassword) { setError("Vui lòng điền đầy đủ thông tin."); return; }
    if (newPassword.length < 6) { setError("Mật khẩu mới phải có ít nhất 6 ký tự."); return; }
    if (newPassword !== confirmPassword) { setError("Mật khẩu xác nhận không khớp."); return; }
    if (currentPassword === newPassword) { setError("Mật khẩu mới phải khác mật khẩu hiện tại."); return; }
    try {
      setSubmitting(true);
      await changePassword(currentPassword, newPassword);
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      setSuccess("Đổi mật khẩu thành công.");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg || "Không thể đổi mật khẩu lúc này.");
    } finally { setSubmitting(false); }
  }

  const tier = session?.user.sellerTier;
  const isUltra = tier === "ultra";

  return (
    <div className="space-y-5">
      {session?.user.sellerReadOnly ? <ReadOnlyNotice /> : null}

      {/* ── Hero banner ── */}
      <div className="rounded-2xl px-6 py-5" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
        <div className="flex flex-wrap items-center justify-between gap-6">
          {/* Left: avatar + name */}
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-xl font-black text-white shadow-lg"
              style={{ background: isUltra ? "rgb(139,92,246)" : "rgb(249,115,22)" }}>
              {avatarInitials}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-black" style={{ color: "var(--tx)" }}>
                  {session?.user.displayName || "Seller"}
                </h1>
                {tier && (
                  <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-black"
                    style={isUltra
                      ? { background: "rgba(139,92,246,0.15)", color: "rgb(167,139,250)", border: "1px solid rgba(139,92,246,0.25)" }
                      : { background: "rgba(249,115,22,0.12)", color: "rgb(249,115,22)", border: "1px solid rgba(249,115,22,0.25)" }}>
                    {isUltra ? "★ Ultra · Tổng si" : `★ ${tier.charAt(0).toUpperCase() + tier.slice(1)}`}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[12px]" style={{ color: "var(--tx-f)" }}>
                {session?.user.email?.split("@")[0]} · {session?.user.email}
              </p>
            </div>
          </div>

          {/* Right: 4 stats */}
          <div className="flex items-center gap-6 xl:gap-10">
            {[
              { label: t.statOrders, value: revSummary?.deliveredOrders ?? "—", color: "rgb(52,211,153)" },
              { label: t.statProfit, value: revSummary?.estimatedProfit ? (revSummary.estimatedProfit >= 1000 ? `${Math.round(revSummary.estimatedProfit / 1000)}k` : String(revSummary.estimatedProfit)) : "—", color: "rgb(45,212,191)" },
              { label: t.statUsers, value: usersCount || "—", color: "rgb(56,189,248)" },
              { label: t.statDaysLeft, value: daysLeft ?? "—", color: "rgb(249,115,22)" },
            ].map(({ label, value, color }) => (
              <div key={label} className="text-center">
                <p className="text-2xl font-black tabular-nums" style={{ color }}>{value}</p>
                <p className="mt-0.5 text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── 2-col grid ── */}
      <div className="grid gap-5 xl:grid-cols-2">
        {/* Left column */}
        <div className="space-y-5">
          {/* Account info */}
          <CardSection icon={User} title={t.cardAccount}>
            <InfoRow label={t.displayName}>{session?.user.displayName || "Seller"}</InfoRow>
            <InfoRow label={t.username}>
              <span className="font-mono text-[12px]">{session?.user.email?.split("@")[0]}</span>
            </InfoRow>
            <InfoRow label={t.recoveryEmail}>
              <span className="font-mono text-[12px]" style={{ color: session?.user.recoveryEmail ? "var(--tx)" : "var(--tx-f)" }}>
                {session?.user.recoveryEmail || "—"}
              </span>
            </InfoRow>
            <InfoRow label={t.systemRole}>
              <span className="rounded-full px-2.5 py-0.5 text-[11px] font-black"
                style={{ background: "rgba(52,211,153,0.12)", color: "rgb(52,211,153)" }}>
                {session?.user.role === "super_admin" ? "Admin" : "Seller"}
              </span>
            </InfoRow>
            <InfoRow label={t.businessTier}>
              <TierBadge tier={tier} />
            </InfoRow>
            {session?.user.sellerTierExpiresAt && (
              <InfoRow label={t.expiresAt}>
                <span className="flex items-center gap-2">
                  <span>{new Date(session.user.sellerTierExpiresAt).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" })}</span>
                  {daysLeft !== null && (
                    <span className="rounded-full px-2 py-0.5 text-[11px] font-black"
                      style={{ background: daysLeft <= 7 ? "rgba(239,68,68,0.12)" : "rgba(249,115,22,0.12)", color: daysLeft <= 7 ? "rgb(248,113,113)" : "rgb(249,115,22)" }}>
                      {t.daysLeft(daysLeft)}
                    </span>
                  )}
                </span>
              </InfoRow>
            )}
          </CardSection>

          {/* Recovery email */}
          <CardSection icon={Mail} title={t.cardRecovery}
            right={<span className="text-[11px]" style={{ color: "var(--tx-f)" }}>{t.recoveryDesc}</span>}>
            <form onSubmit={handleUpdateRecoveryEmail} className="space-y-4">
              <div>
                <p className="mb-1.5 text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>Địa chỉ email</p>
                <input
                  type="email"
                  value={recoveryEmail}
                  onChange={(e) => setRecoveryEmail(e.target.value)}
                  placeholder="name@example.com"
                  className={inputCls}
                  style={inputStyle}
                />
              </div>
              {emailError   && <Alert type="error">{emailError}</Alert>}
              {emailSuccess && <Alert type="success">{emailSuccess}</Alert>}
              <div className="flex items-center justify-end gap-2">
                <button type="button" onClick={() => setRecoveryEmail(session?.user.recoveryEmail || "")}
                  className="rounded-xl px-4 py-2 text-[13px] font-black transition hover:opacity-80"
                  style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-f)" }}>
                  Hủy
                </button>
                <button type="submit" disabled={emailSubmitting}
                  className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-[13px] font-black transition hover:opacity-80 disabled:opacity-40"
                  style={{ background: "rgb(249,115,22)", color: "#fff" }}>
                  <Check className="h-3.5 w-3.5" />
                  {emailSubmitting ? t.saving : t.saveEmail}
                </button>
              </div>
            </form>
          </CardSection>
        </div>

        {/* Right column */}
        <div className="space-y-5">
          {/* Shop */}
          <CardSection icon={Store} title={t.cardShop}
            right={!editingShop ? (
              <button type="button" onClick={() => { setEditingShop(true); setShopSuccess(null); }}
                className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-black transition hover:opacity-80"
                style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-f)" }}>
                <Pencil className="h-3 w-3" /> {t.editShop}
              </button>
            ) : undefined}>

            {!editingShop ? (
              <>
                <InfoRow label={t.shopName}>{shopData?.name || "—"}</InfoRow>
                <InfoRow label={t.tagline}>
                  <span style={{ color: shopData?.tagline ? "var(--tx)" : "var(--tx-f)" }}>
                    {shopData?.tagline || t.noTagline}
                  </span>
                </InfoRow>
                <InfoRow label={t.supportTelegram}>
                  <span style={{ color: shopData?.supportTelegram ? "var(--tx)" : "var(--tx-f)" }}>
                    {shopData?.supportTelegram || t.notSet}
                  </span>
                </InfoRow>
                <InfoRow label={t.supportZalo}>
                  <span style={{ color: shopData?.supportZalo ? "var(--tx)" : "var(--tx-f)" }}>
                    {shopData?.supportZalo || t.notSet}
                  </span>
                </InfoRow>
                {shopSuccess && <div className="mt-3"><Alert type="success">{shopSuccess}</Alert></div>}
                {warrantyLink && (
                  <div className="mt-4 rounded-xl p-3.5" style={{ background: "rgba(249,115,22,0.06)", border: "1px solid rgba(249,115,22,0.2)" }}>
                    <p className="mb-2 text-[10px] font-black uppercase tracking-widest" style={{ color: "rgb(249,115,22)" }}>
                      {t.warrantyLink}
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="min-w-0 flex-1 truncate text-[11px] font-mono" style={{ color: "var(--tx-f)" }}>
                        {warrantyLink}
                      </code>
                      <button type="button" onClick={handleCopyLink}
                        className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-black transition"
                        style={copied
                          ? { background: "rgba(52,211,153,0.15)", color: "rgb(52,211,153)" }
                          : { background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-f)" }}>
                        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        {copied ? t.copied : t.copyLink}
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <form onSubmit={handleShopSave} className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    { key: "name" as const, label: t.shopName, ph: t.shopName },
                    { key: "tagline" as const, label: t.tagline, ph: t.noTagline },
                    { key: "supportTelegram" as const, label: t.supportTelegram, ph: "@username" },
                    { key: "supportZalo" as const, label: t.supportZalo, ph: "0xxxxxxxxx" },
                  ].map(({ key, label, ph }) => (
                    <div key={key}>
                      <p className="mb-1.5 text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{label}</p>
                      <input className={inputCls} style={inputStyle} value={shopForm[key]} placeholder={ph}
                        onChange={(e) => setShopForm((f) => ({ ...f, [key]: e.target.value }))} />
                    </div>
                  ))}
                </div>
                {shopError && <Alert type="error">{shopError}</Alert>}
                <div className="flex items-center gap-2 pt-1">
                  <button type="submit" disabled={shopMutation.isPending}
                    className="rounded-xl px-4 py-2 text-[13px] font-black transition hover:opacity-80 disabled:opacity-40"
                    style={{ background: "rgb(249,115,22)", color: "#fff" }}>
                    {shopMutation.isPending ? t.savingShop : t.saveShop}
                  </button>
                  <button type="button" onClick={cancelEdit}
                    className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-[13px] font-black transition hover:opacity-80"
                    style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-f)" }}>
                    <X className="h-3.5 w-3.5" /> {t.cancel}
                  </button>
                </div>
              </form>
            )}
          </CardSection>

          {/* Password */}
          <CardSection icon={Lock} title={t.cardSecurity}
            right={<span className="text-[11px]" style={{ color: "var(--tx-f)" }}>{t.minChars}</span>}>
            <form onSubmit={handleChangePassword} className="space-y-3">
              <div>
                <p className="mb-1.5 text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{t.currentPassword}</p>
                <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="••••••••" className={inputCls} style={inputStyle} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="mb-1.5 text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{t.newPassword}</p>
                  <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••" className={inputCls} style={inputStyle} />
                </div>
                <div>
                  <p className="mb-1.5 text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{t.confirmPassword}</p>
                  <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••" className={inputCls} style={inputStyle} />
                </div>
              </div>
              {error   && <Alert type="error">{error}</Alert>}
              {success && <Alert type="success">{success}</Alert>}
              <div className="flex justify-end pt-1">
                <button type="submit" disabled={submitting}
                  className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-black transition hover:opacity-80 disabled:opacity-40"
                  style={{ background: "rgb(249,115,22)", color: "#fff" }}>
                  <KeyRound className="h-3.5 w-3.5" />
                  {submitting ? t.changing : t.changePassword}
                </button>
              </div>
            </form>
          </CardSection>
        </div>
      </div>
    </div>
  );
}
