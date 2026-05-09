import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Pencil, ShieldCheck, Store, UserCircle2, X } from "lucide-react";

import { useAuth } from "@/auth/auth-provider";
import { SectionHeading } from "@/components/dashboard/section-heading";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CardHeader } from "@/components/ui/card-header";
import { Input } from "@/components/ui/input";
import { ReadOnlyNotice } from "@/components/ui/read-only-notice";
import { api } from "@/lib/api";
import { formatRoleLabel } from "@/lib/format";
import { useLang } from "@/lib/lang";

const T = {
  vi: {
    eyebrow: "Tài khoản & bảo mật", title: "Hồ sơ seller",
    desc: "Thông tin tài khoản, shop đang vận hành và cài đặt bảo mật.",
    statAccount: "Tài khoản", statShop: "Shop", statTier: "Tier",
    cardAccount: "Tài khoản", cardShop: "Shop đang vận hành",
    cardRecovery: "Khôi phục tài khoản", cardSecurity: "Bảo mật tài khoản",
    displayName: "Tên hiển thị", username: "Username",
    recoveryEmail: "Email khôi phục", systemRole: "System role", businessTier: "Business tier",
    shopName: "Tên shop", tagline: "Tagline",
    supportTelegram: "Hỗ trợ Telegram", supportZalo: "Hỗ trợ Zalo",
    warrantyLink: "Link bảo hành",
    notSet: "Chưa thêm", noTagline: "Chưa có tagline",
    copyLink: "Sao chép link", copied: "Đã sao chép!",
    editShop: "Chỉnh sửa", cancel: "Hủy", saveShop: "Lưu thay đổi", savingShop: "Đang lưu...",
    shopSaved: "Đã cập nhật thông tin shop.",
    recoveryDesc: "Email để nhận link reset mật khẩu khi quên thông tin đăng nhập.",
    optional: "Có thể để trống", saveEmail: "Lưu email", saving: "Đang lưu...",
    securityDesc: "Nhập mật khẩu hiện tại và thiết lập mật khẩu mới.",
    minChars: "Tối thiểu 6 ký tự",
    currentPassword: "Mật khẩu hiện tại", newPassword: "Mật khẩu mới",
    confirmPassword: "Xác nhận mật khẩu mới",
    changePassword: "Đổi mật khẩu", changing: "Đang cập nhật...",
  },
  en: {
    eyebrow: "Account & Security", title: "Seller Profile",
    desc: "Account information, active shop, and security settings.",
    statAccount: "Account", statShop: "Shop", statTier: "Tier",
    cardAccount: "Account", cardShop: "Active Shop",
    cardRecovery: "Account Recovery", cardSecurity: "Account Security",
    displayName: "Display Name", username: "Username",
    recoveryEmail: "Recovery Email", systemRole: "System Role", businessTier: "Business Tier",
    shopName: "Shop Name", tagline: "Tagline",
    supportTelegram: "Support Telegram", supportZalo: "Support Zalo",
    warrantyLink: "Warranty Link",
    notSet: "Not set", noTagline: "No tagline",
    copyLink: "Copy link", copied: "Copied!",
    editShop: "Edit", cancel: "Cancel", saveShop: "Save Changes", savingShop: "Saving...",
    shopSaved: "Shop info updated.",
    recoveryDesc: "Used to receive a password reset link if you lose access.",
    optional: "Optional", saveEmail: "Save Email", saving: "Saving...",
    securityDesc: "Enter your current password and set a new one for this seller account.",
    minChars: "Minimum 6 characters",
    currentPassword: "Current Password", newPassword: "New Password",
    confirmPassword: "Confirm New Password",
    changePassword: "Change Password", changing: "Updating...",
  },
  th: {
    eyebrow: "บัญชีและความปลอดภัย", title: "โปรไฟล์ผู้ขาย",
    desc: "ข้อมูลบัญชี ร้านค้าที่ใช้งาน และการตั้งค่าความปลอดภัย",
    statAccount: "บัญชี", statShop: "ร้านค้า", statTier: "แพ็กเกจ",
    cardAccount: "บัญชี", cardShop: "ร้านค้าที่ใช้งาน",
    cardRecovery: "การกู้คืนบัญชี", cardSecurity: "ความปลอดภัยบัญชี",
    displayName: "ชื่อที่แสดง", username: "ชื่อผู้ใช้",
    recoveryEmail: "อีเมลกู้คืน", systemRole: "บทบาทระบบ", businessTier: "แพ็กเกจ",
    shopName: "ชื่อร้านค้า", tagline: "คำโปรย",
    supportTelegram: "Telegram ช่วยเหลือ", supportZalo: "Zalo ช่วยเหลือ",
    warrantyLink: "ลิงก์รับประกัน",
    notSet: "ยังไม่ได้ตั้งค่า", noTagline: "ยังไม่มีคำโปรย",
    copyLink: "คัดลอกลิงก์", copied: "คัดลอกแล้ว!",
    editShop: "แก้ไข", cancel: "ยกเลิก", saveShop: "บันทึกการเปลี่ยนแปลง", savingShop: "กำลังบันทึก...",
    shopSaved: "อัปเดตข้อมูลร้านค้าแล้ว",
    recoveryDesc: "ใช้รับลิงก์รีเซ็ตรหัสผ่านเมื่อเข้าถึงบัญชีไม่ได้",
    optional: "ไม่บังคับ", saveEmail: "บันทึกอีเมล", saving: "กำลังบันทึก...",
    securityDesc: "ใส่รหัสผ่านปัจจุบันและตั้งรหัสผ่านใหม่",
    minChars: "อย่างน้อย 6 ตัวอักษร",
    currentPassword: "รหัสผ่านปัจจุบัน", newPassword: "รหัสผ่านใหม่",
    confirmPassword: "ยืนยันรหัสผ่านใหม่",
    changePassword: "เปลี่ยนรหัสผ่าน", changing: "กำลังอัปเดต...",
  },
} as const;

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3" style={{ borderBottom: "1px solid var(--bd)" }}>
      <span className="shrink-0 text-[10px] font-black uppercase tracking-[0.15em]" style={{ color: "var(--tx-f)" }}>
        {label}
      </span>
      <span className="text-right text-sm font-semibold" style={{ color: "var(--tx)" }}>
        {children}
      </span>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-[10px] font-black uppercase tracking-[0.15em] mb-1.5" style={{ color: "var(--tx-f)" }}>
      {children}
    </label>
  );
}

function TierBadge({ tier }: { tier: string | null | undefined }) {
  if (!tier) return null;
  const isUltra = tier === "ultra";
  const isPro   = tier === "pro";
  return (
    <span
      className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.14em]"
      style={
        isUltra
          ? { background: "rgba(139,92,246,0.15)", color: "rgb(167,139,250)" }
          : isPro
          ? { background: "rgba(249,115,22,0.12)", color: "rgb(249,115,22)" }
          : { background: "var(--inp)", color: "var(--tx-m)" }
      }
    >
      {tier.toUpperCase()}
    </span>
  );
}

function Alert({ type, children }: { type: "error" | "success"; children: React.ReactNode }) {
  const isError = type === "error";
  return (
    <div
      className="rounded-[12px] border px-4 py-3 text-sm"
      style={
        isError
          ? { background: "rgba(239,68,68,0.08)", borderColor: "rgba(239,68,68,0.2)", color: "rgb(239,68,68)" }
          : { background: "rgba(16,185,129,0.08)", borderColor: "rgba(16,185,129,0.2)", color: "rgb(16,185,129)" }
      }
    >
      {children}
    </div>
  );
}

export function ProfilePage() {
  const { session, changePassword, updateRecoveryEmail } = useAuth();
  const { lang } = useLang();
  const t = T[lang];
  const queryClient = useQueryClient();

  const shopQuery = useQuery({
    queryKey: ["shop", "profile"],
    queryFn: async () => (await api.get("/shops/current")).data,
  });

  const shopData = shopQuery.data;

  // ── shop edit state ──────────────────────────
  const [editingShop, setEditingShop] = useState(false);
  const [shopForm, setShopForm] = useState({
    name: "", tagline: "", supportTelegram: "", supportZalo: "",
  });
  const [shopError, setShopError] = useState<string | null>(null);
  const [shopSuccess, setShopSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (shopData && !editingShop) {
      setShopForm({
        name:            shopData.name           || "",
        tagline:         shopData.tagline         || "",
        supportTelegram: shopData.supportTelegram || "",
        supportZalo:     shopData.supportZalo     || "",
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
      setShopError(msg || (lang === "vi" ? "Không thể cập nhật thông tin shop." : "Could not update shop info."));
    },
  });

  function handleShopSave(e: React.FormEvent) {
    e.preventDefault();
    setShopError(null);
    if (!shopForm.name.trim() || shopForm.name.trim().length < 2) {
      setShopError(lang === "vi" ? "Tên shop phải có ít nhất 2 ký tự." : "Shop name must be at least 2 characters.");
      return;
    }
    shopMutation.mutate(shopForm);
  }

  function cancelEdit() {
    setEditingShop(false);
    setShopError(null);
    if (shopData) {
      setShopForm({
        name:            shopData.name           || "",
        tagline:         shopData.tagline         || "",
        supportTelegram: shopData.supportTelegram || "",
        supportZalo:     shopData.supportZalo     || "",
      });
    }
  }

  // ── password / recovery ──────────────────────
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword]         = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [recoveryEmail, setRecoveryEmail]     = useState(session?.user.recoveryEmail || "");
  const [error, setError]           = useState<string | null>(null);
  const [success, setSuccess]       = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
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
      setEmailError(lang === "vi" ? "Email không hợp lệ." : "Invalid email address.");
      return;
    }
    try {
      setEmailSubmitting(true);
      await updateRecoveryEmail(normalizedEmail || null);
      setEmailSuccess(normalizedEmail
        ? lang === "vi" ? "Đã lưu email khôi phục." : "Recovery email saved."
        : lang === "vi" ? "Đã xóa email khôi phục." : "Recovery email removed.",
      );
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setEmailError(msg || (lang === "vi" ? "Không thể cập nhật email." : "Could not update email."));
    } finally { setEmailSubmitting(false); }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setSuccess(null);
    if (!currentPassword || !newPassword || !confirmPassword) {
      setError(lang === "vi" ? "Vui lòng điền đầy đủ thông tin." : "Please fill in all fields.");
      return;
    }
    if (newPassword.length < 6) {
      setError(lang === "vi" ? "Mật khẩu mới phải có ít nhất 6 ký tự." : "New password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(lang === "vi" ? "Mật khẩu xác nhận không khớp." : "Passwords do not match.");
      return;
    }
    if (currentPassword === newPassword) {
      setError(lang === "vi" ? "Mật khẩu mới phải khác mật khẩu hiện tại." : "New password must be different.");
      return;
    }
    try {
      setSubmitting(true);
      await changePassword(currentPassword, newPassword);
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      setSuccess(lang === "vi" ? "Đổi mật khẩu thành công." : "Password changed successfully.");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg || (lang === "vi" ? "Không thể đổi mật khẩu lúc này." : "Could not change password."));
    } finally { setSubmitting(false); }
  }

  const inputCls = "w-full rounded-[10px] border px-3 py-2 text-sm outline-none transition-colors";
  const inputStyle = { background: "var(--inp)", borderColor: "var(--bd)", color: "var(--tx)" };

  return (
    <div className="space-y-5">
      {session?.user.sellerReadOnly ? <ReadOnlyNotice /> : null}

      <SectionHeading
        eyebrow={t.eyebrow}
        title={t.title}
        description={t.desc}
        gradient="violet"
        stats={[
          { icon: UserCircle2, label: t.statAccount, value: session?.user.displayName || "Seller", iconCls: "text-violet-400", bgCls: "bg-violet-500/15" },
          { icon: Store, label: t.statShop, value: shopData?.name || "—", iconCls: "text-amber-400", bgCls: "bg-amber-500/15" },
          { icon: ShieldCheck, label: t.statTier, value: formatRoleLabel(session?.user.sellerTier || session?.user.role), iconCls: "text-emerald-400", bgCls: "bg-emerald-500/15" },
        ]}
      />

      <div className="grid gap-5 xl:grid-cols-2">
        {/* Account card — read only */}
        <Card>
          <CardHeader icon={UserCircle2} title={t.cardAccount} iconCls="text-violet-400" iconBg="bg-violet-500/10" />
          <div className="mt-4">
            <InfoRow label={t.displayName}>{session?.user.displayName || "Seller"}</InfoRow>
            <InfoRow label={t.username}>{session?.user.email}</InfoRow>
            <InfoRow label={t.recoveryEmail}>
              <span style={{ color: session?.user.recoveryEmail ? "var(--tx)" : "var(--tx-f)" }}>
                {session?.user.recoveryEmail || t.notSet}
              </span>
            </InfoRow>
            <InfoRow label={t.systemRole}>{formatRoleLabel(session?.user.role)}</InfoRow>
            <InfoRow label={t.businessTier}>
              <div className="flex flex-col items-end gap-1">
                <TierBadge tier={session?.user.sellerTier} />
                {session?.user.sellerTierExpiresAt && (
                  <span className="text-[11px]" style={{ color: "var(--tx-f)" }}>
                    Đến ngày {new Date(session.user.sellerTierExpiresAt).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" })}
                  </span>
                )}
              </div>
            </InfoRow>
          </div>
        </Card>

        {/* Shop card — editable */}
        <Card>
          <CardHeader
            icon={Store}
            title={t.cardShop}
            iconCls="text-amber-400"
            iconBg="bg-amber-500/10"
            right={
              !editingShop ? (
                <button
                  type="button"
                  onClick={() => { setEditingShop(true); setShopSuccess(null); }}
                  className="flex items-center gap-1.5 rounded-[10px] border px-3 py-1.5 text-xs font-semibold transition hover:opacity-80"
                  style={{ borderColor: "var(--bd)", color: "var(--tx-m)", background: "var(--inp)" }}
                >
                  <Pencil className="h-3 w-3" />
                  {t.editShop}
                </button>
              ) : null
            }
          />

          {!editingShop ? (
            <>
              <div className="mt-4">
                <InfoRow label={t.shopName}>
                  {shopData?.name || "—"}
                </InfoRow>
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
              </div>

              {shopSuccess && <div className="mt-4"><Alert type="success">{shopSuccess}</Alert></div>}

              {warrantyLink && (
                <div
                  className="mt-5 rounded-[14px] p-3.5"
                  style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.18)" }}
                >
                  <p className="mb-2 text-[10px] font-black uppercase tracking-[0.15em] text-emerald-500">
                    {t.warrantyLink}
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate text-xs font-mono" style={{ color: "var(--tx-m)" }}>
                      {warrantyLink}
                    </code>
                    <button
                      type="button"
                      onClick={handleCopyLink}
                      title={t.copyLink}
                      className="flex shrink-0 items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[11px] font-bold transition"
                      style={copied
                        ? { background: "rgba(16,185,129,0.15)", color: "rgb(16,185,129)" }
                        : { background: "var(--inp)", color: "var(--tx-m)" }}
                    >
                      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      {copied ? t.copied : t.copyLink}
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <form onSubmit={handleShopSave} className="mt-4 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <FieldLabel>{t.shopName}</FieldLabel>
                  <input
                    className={inputCls}
                    style={inputStyle}
                    value={shopForm.name}
                    onChange={(e) => setShopForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder={t.shopName}
                  />
                </div>
                <div>
                  <FieldLabel>{t.tagline}</FieldLabel>
                  <input
                    className={inputCls}
                    style={inputStyle}
                    value={shopForm.tagline}
                    onChange={(e) => setShopForm((f) => ({ ...f, tagline: e.target.value }))}
                    placeholder={t.noTagline}
                  />
                </div>
                <div>
                  <FieldLabel>{t.supportTelegram}</FieldLabel>
                  <input
                    className={inputCls}
                    style={inputStyle}
                    value={shopForm.supportTelegram}
                    onChange={(e) => setShopForm((f) => ({ ...f, supportTelegram: e.target.value }))}
                    placeholder="@username hoặc số điện thoại"
                  />
                </div>
                <div>
                  <FieldLabel>{t.supportZalo}</FieldLabel>
                  <input
                    className={inputCls}
                    style={inputStyle}
                    value={shopForm.supportZalo}
                    onChange={(e) => setShopForm((f) => ({ ...f, supportZalo: e.target.value }))}
                    placeholder="Số điện thoại Zalo"
                  />
                </div>
              </div>

              {shopError && <Alert type="error">{shopError}</Alert>}

              <div className="flex items-center gap-2.5">
                <button
                  type="submit"
                  disabled={shopMutation.isPending}
                  className="flex items-center gap-2 rounded-[10px] px-4 py-2 text-sm font-bold transition hover:opacity-90 disabled:opacity-50"
                  style={{ background: "rgb(249,115,22)", color: "white" }}
                >
                  {shopMutation.isPending ? t.savingShop : t.saveShop}
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="flex items-center gap-1.5 rounded-[10px] border px-4 py-2 text-sm font-semibold transition hover:opacity-80"
                  style={{ borderColor: "var(--bd)", color: "var(--tx-m)", background: "var(--inp)" }}
                >
                  <X className="h-3.5 w-3.5" />
                  {t.cancel}
                </button>
              </div>
            </form>
          )}
        </Card>
      </div>

      {/* Recovery email */}
      <Card>
        <CardHeader
          icon={ShieldCheck}
          title={t.cardRecovery}
          iconCls="text-sky-400"
          iconBg="bg-sky-500/10"
          right={
            <span className="rounded-[10px] border px-3 py-1.5 text-xs" style={{ borderColor: "var(--bd)", color: "var(--tx-f)" }}>
              {t.optional}
            </span>
          }
        />
        <p className="mt-1 text-sm" style={{ color: "var(--tx-f)" }}>{t.recoveryDesc}</p>
        <form className="mt-4 space-y-4" onSubmit={handleUpdateRecoveryEmail}>
          <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold" htmlFor="recoveryEmail" style={{ color: "var(--tx-m)" }}>
                {t.recoveryEmail}
              </label>
              <Input id="recoveryEmail" placeholder="name@example.com" type="email" value={recoveryEmail} onChange={(e) => setRecoveryEmail(e.target.value)} />
            </div>
            <Button disabled={emailSubmitting} size="lg" type="submit">
              {emailSubmitting ? t.saving : t.saveEmail}
            </Button>
          </div>
          {emailError   && <Alert type="error">{emailError}</Alert>}
          {emailSuccess && <Alert type="success">{emailSuccess}</Alert>}
        </form>
      </Card>

      {/* Password */}
      <Card>
        <CardHeader
          icon={KeyRound}
          title={t.cardSecurity}
          iconCls="text-emerald-400"
          iconBg="bg-emerald-500/10"
          right={
            <span className="rounded-[10px] border px-3 py-1.5 text-xs" style={{ borderColor: "var(--bd)", color: "var(--tx-f)" }}>
              {t.minChars}
            </span>
          }
        />
        <p className="mt-1 text-sm" style={{ color: "var(--tx-f)" }}>{t.securityDesc}</p>
        <form className="mt-4 space-y-4" onSubmit={handleChangePassword}>
          <div className="grid gap-3 lg:grid-cols-3">
            {[
              { id: "currentPassword", label: t.currentPassword, val: currentPassword, set: setCurrentPassword },
              { id: "newPassword",     label: t.newPassword,     val: newPassword,     set: setNewPassword },
              { id: "confirmPassword", label: t.confirmPassword, val: confirmPassword, set: setConfirmPassword },
            ].map(({ id, label, val, set }) => (
              <div key={id} className="space-y-1.5">
                <label className="block text-xs font-semibold" htmlFor={id} style={{ color: "var(--tx-m)" }}>{label}</label>
                <Input id={id} type="password" value={val} onChange={(e) => set(e.target.value)} />
              </div>
            ))}
          </div>
          <Button disabled={submitting} size="lg" type="submit">
            {submitting ? t.changing : t.changePassword}
          </Button>
          {error   && <Alert type="error">{error}</Alert>}
          {success && <Alert type="success">{success}</Alert>}
        </form>
      </Card>
    </div>
  );
}
