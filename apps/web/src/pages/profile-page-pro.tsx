import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowDownLeft, ArrowUpRight, Banknote, Calendar, Check, CheckCircle2, Copy, Crown, DollarSign, Gift, KeyRound, Link2, Loader2, Lock, Mail, Pencil, Plus, Send, ShieldCheck, ShoppingBag, Store, User, Users, Wallet, X } from "lucide-react";

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

function DepositPaymentView({ response, method, onClose }: {
  response: any; method: "PAYOS" | "USDT_SOL" | "BINANCE"; onClose: () => void;
}) {
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const manualCrypto = response.manualCrypto;
  const bankInfo = response.bankInfo;
  const address = manualCrypto?.address;
  const uid = manualCrypto?.uid;
  const usdtAmount = manualCrypto?.usdtAmount;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const expiresAtMs = response.expiresAt ? new Date(response.expiresAt).getTime() : null;
  const remainingMs = expiresAtMs ? Math.max(0, expiresAtMs - now) : null;
  const remainingMin = remainingMs !== null ? Math.floor(remainingMs / 60000) : null;
  const remainingSec = remainingMs !== null ? Math.floor((remainingMs % 60000) / 1000) : null;
  const expired = remainingMs !== null && remainingMs <= 0;

  let qrImageUrl: string | null = null;
  let qrCaption = "";

  if (method === "PAYOS" && response.qrCode) {
    // PayOS trả về raw VietQR text — phải encode qua QR generator để hiển thị image
    qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(response.qrCode)}`;
    qrCaption = "Quét QR bằng app ngân hàng";
  } else if (method === "USDT_SOL" && address) {
    qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(address)}`;
    qrCaption = "Quét QR hoặc copy địa chỉ ví Solana";
  }

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text);
    setCopiedLabel(label);
    setTimeout(() => setCopiedLabel(null), 2000);
  }

  return (
    <div className="space-y-4 px-6 py-5">
      {qrImageUrl && (
        <div className="flex flex-col items-center">
          <div className="rounded-2xl bg-white p-3 shadow-lg">
            <img src={qrImageUrl} alt="QR Code" className="h-52 w-52" />
          </div>
          <p className="mt-2.5 text-center text-[11px]" style={{ color: "var(--tx-m)" }}>{qrCaption}</p>
        </div>
      )}

      <div className="rounded-2xl p-3.5" style={{ background: "var(--inp)" }}>
        <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>Số tiền cần chuyển</p>
        <p className="mt-1 text-2xl font-black tabular-nums" style={{ color: "rgb(16,185,129)" }}>
          {method === "PAYOS" ? `${Number(response.amount).toLocaleString("vi-VN")}đ` : `${usdtAmount || "—"} USDT`}
        </p>
      </div>

      {method === "PAYOS" && bankInfo && (
        <div className="rounded-2xl p-3.5 space-y-2.5" style={{ background: "var(--inp)" }}>
          {bankInfo.accountName && (
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>Chủ TK</p>
              <p className="mt-0.5 text-[13px] font-semibold" style={{ color: "var(--tx)" }}>{bankInfo.accountName}</p>
            </div>
          )}
          {bankInfo.accountNumber && (
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>STK</p>
              <button type="button" onClick={() => copy(bankInfo.accountNumber, "stk")}
                className="mt-0.5 flex items-center gap-2 text-[14px] font-mono font-bold transition" style={{ color: "var(--tx)" }}>
                {bankInfo.accountNumber} {copiedLabel === "stk" ? <Check className="h-3 w-3" style={{ color: "rgb(16,185,129)" }} /> : <Copy className="h-3 w-3" />}
              </button>
            </div>
          )}
          {bankInfo.description && (
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>Nội dung CK</p>
              <button type="button" onClick={() => copy(bankInfo.description, "desc")}
                className="mt-0.5 flex items-center gap-2 text-[12px] font-mono transition" style={{ color: "var(--tx)" }}>
                {bankInfo.description} {copiedLabel === "desc" ? <Check className="h-3 w-3" style={{ color: "rgb(16,185,129)" }} /> : <Copy className="h-3 w-3" />}
              </button>
            </div>
          )}
        </div>
      )}

      {method === "USDT_SOL" && address && (
        <div className="rounded-2xl p-3.5 space-y-2.5" style={{ background: "var(--inp)" }}>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>Mạng</p>
            <p className="mt-0.5 text-[13px] font-semibold" style={{ color: "var(--tx)" }}>Solana</p>
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>Địa chỉ ví</p>
            <button type="button" onClick={() => copy(address, "address")}
              className="mt-0.5 flex w-full items-center gap-2 break-all rounded-lg px-2 py-1.5 text-left text-[11px] font-mono transition hover:bg-white/5"
              style={{ color: "var(--tx)" }}>
              <span className="flex-1">{address}</span>
              {copiedLabel === "address" ? <Check className="h-3 w-3 shrink-0" style={{ color: "rgb(16,185,129)" }} /> : <Copy className="h-3 w-3 shrink-0" />}
            </button>
          </div>
        </div>
      )}

      {method === "BINANCE" && uid && (
        <div className="rounded-2xl p-3.5" style={{ background: "var(--inp)" }}>
          <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>Binance UID</p>
          <button type="button" onClick={() => copy(String(uid), "uid")}
            className="mt-0.5 flex items-center gap-2 text-[14px] font-mono font-bold transition" style={{ color: "var(--tx)" }}>
            {uid} {copiedLabel === "uid" ? <Check className="h-3 w-3" style={{ color: "rgb(16,185,129)" }} /> : <Copy className="h-3 w-3" />}
          </button>
          <p className="mt-2 text-[11px]" style={{ color: "var(--tx-f)" }}>
            Mở app Binance → Pay → Send → nhập UID này + số tiền USDT chính xác.
          </p>
        </div>
      )}

      <div className="rounded-2xl p-3 text-center" style={{ background: "var(--inp)" }}>
        <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>Mã đơn</p>
        <button type="button" onClick={() => copy(response.externalOrderCode, "order")}
          className="mt-0.5 inline-flex items-center gap-2 text-[12px] font-mono" style={{ color: "var(--tx)" }}>
          {response.externalOrderCode} {copiedLabel === "order" ? <Check className="h-3 w-3" style={{ color: "rgb(16,185,129)" }} /> : <Copy className="h-3 w-3" />}
        </button>
      </div>

      <div className="flex items-center justify-center gap-2 rounded-2xl py-3"
        style={expired
          ? { background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)" }
          : { background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)" }}>
        {expired ? (
          <span className="text-[13px] font-medium" style={{ color: "rgb(239,68,68)" }}>
            Hết hạn — vui lòng tạo yêu cầu mới
          </span>
        ) : (
          <>
            <Loader2 className="h-4 w-4 animate-spin" style={{ color: "rgb(16,185,129)" }} />
            <span className="text-[13px] font-medium" style={{ color: "rgb(16,185,129)" }}>
              Đang chờ thanh toán
              {remainingMin !== null && (
                <span className="ml-1.5 tabular-nums">
                  · còn {remainingMin}:{String(remainingSec).padStart(2, "0")}
                </span>
              )}
            </span>
          </>
        )}
      </div>

      <button type="button" onClick={onClose}
        className="w-full rounded-xl py-2.5 text-[12px] font-bold transition hover:opacity-80"
        style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-m)" }}>
        Đóng (giao dịch vẫn được xử lý)
      </button>
    </div>
  );
}

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
  const navigate = useNavigate();
  const { lang } = useLang();
  const t = T[lang];
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"linked" | "info" | "security" | "wallet">("info");
  const [historyOpen, setHistoryOpen] = useState(false);

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

  const sellerWalletQuery = useQuery({
    queryKey: ["wallet", "seller"],
    queryFn: async () => (await api.get("/wallet")).data,
  });

  const ledgerQuery = useQuery({
    queryKey: ["wallet", "ledgers"],
    queryFn: async () => (await api.get("/wallet/ledgers")).data,
  });

  const depositReqsQuery = useQuery({
    queryKey: ["wallet", "deposit-requests"],
    queryFn: async () => (await api.get("/wallet/deposit-requests")).data,
    enabled: historyOpen,
  });

  const withdrawReqsQuery = useQuery({
    queryKey: ["wallet", "withdraw-requests"],
    queryFn: async () => (await api.get("/wallet/withdraw-requests")).data,
    enabled: historyOpen,
  });

  const shopData = shopQuery.data;
  const revSummary = revenueQuery.data?.summary;
  const usersCount = walletsQuery.data?.items?.length ?? 0;
  const sellerWallet = sellerWalletQuery.data;
  const ledgers: Array<{ id: string; type: string; amount: number; balanceAfter: number; note: string | null; createdAt: string }> = ledgerQuery.data ?? [];

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

  // ── set referral code (one-time) ──────────────
  const [referralInput, setReferralInput] = useState("");
  const [referralError, setReferralError] = useState<string | null>(null);
  const [referralSuccess, setReferralSuccess] = useState(false);

  const referralMutation = useMutation({
    mutationFn: (code: string) => api.post("/auth/me/referral-code", { referralCode: code }),
    onSuccess: () => {
      setReferralSuccess(true);
      setReferralError(null);
      setReferralInput("");
      // trigger session refresh so hasReferrer updates
      window.location.reload();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setReferralError(msg || "Không thể thiết lập mã giới thiệu.");
    },
  });

  function handleReferralSubmit(e: React.FormEvent) {
    e.preventDefault();
    setReferralError(null);
    const code = referralInput.trim().toUpperCase();
    if (code.length < 4) {
      setReferralError("Mã giới thiệu phải có ít nhất 4 ký tự.");
      return;
    }
    referralMutation.mutate(code);
  }

  // ── seller wallet withdraw ─────────────────────
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawForm, setWithdrawForm] = useState({ amount: "", bankName: "", bankAccountNumber: "", bankAccountName: "", note: "" });
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  const withdrawMutation = useMutation({
    mutationFn: (payload: { amount: number; bankName: string; bankAccountNumber: string; bankAccountName: string; note?: string }) =>
      api.post("/wallet/withdraw-requests", payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["wallet", "seller"] });
      void queryClient.invalidateQueries({ queryKey: ["wallet", "ledgers"] });
      setWithdrawOpen(false);
      setWithdrawForm({ amount: "", bankName: "", bankAccountNumber: "", bankAccountName: "", note: "" });
      setWithdrawError(null);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setWithdrawError(msg || "Không thể tạo yêu cầu rút tiền.");
    },
  });

  // ── cancel pending deposit/withdraw ──────────────
  const cancelDepositMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/wallet/deposit-requests/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["wallet", "deposit-requests"] });
      void queryClient.invalidateQueries({ queryKey: ["wallet", "seller"] });
    },
  });

  const cancelWithdrawMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/wallet/withdraw-requests/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["wallet", "withdraw-requests"] });
      void queryClient.invalidateQueries({ queryKey: ["wallet", "seller"] });
    },
  });

  // ── seller wallet deposit (top up) ──────────────
  type DepositMethod = "PAYOS" | "USDT_SOL" | "BINANCE";
  const [depositOpen, setDepositOpen] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [depositMethod, setDepositMethod] = useState<DepositMethod>("PAYOS");
  const [depositError, setDepositError] = useState<string | null>(null);
  const [depositResponse, setDepositResponse] = useState<any>(null);

  const depositMutation = useMutation({
    mutationFn: async (payload: { amount: number; paymentMethod: DepositMethod }) => {
      const { data } = await api.post("/wallet/deposit-requests", payload);
      return data;
    },
    onSuccess: (data) => {
      setDepositResponse(data);
      setDepositError(null);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setDepositError(msg || "Không thể tạo yêu cầu nạp.");
    },
  });

  // Poll wallet to detect successful deposit
  useEffect(() => {
    if (!depositResponse?.externalOrderCode) return;
    const initialBalance = sellerWallet?.balance ?? 0;
    const interval = setInterval(async () => {
      try {
        const { data } = await api.get("/wallet");
        if (data.balance > initialBalance) {
          void queryClient.invalidateQueries({ queryKey: ["wallet", "seller"] });
          void queryClient.invalidateQueries({ queryKey: ["wallet", "ledgers"] });
          closeDepositModal();
        }
      } catch {}
    }, 4000);
    return () => clearInterval(interval);
  }, [depositResponse?.externalOrderCode]);

  function closeDepositModal() {
    setDepositOpen(false);
    setDepositAmount("");
    setDepositMethod("PAYOS");
    setDepositError(null);
    setDepositResponse(null);
  }

  function handleDepositSubmit(e: React.FormEvent) {
    e.preventDefault();
    setDepositError(null);
    const amount = Number(depositAmount);
    if (!amount || amount < 1000) {
      setDepositError("Số tiền tối thiểu 1.000đ.");
      return;
    }
    depositMutation.mutate({ amount, paymentMethod: depositMethod });
  }

  function copyText(text: string, label: string) {
    navigator.clipboard.writeText(text);
    // reusing copied state from warranty link
  }

  function handleWithdrawSubmit(e: React.FormEvent) {
    e.preventDefault();
    setWithdrawError(null);
    const amount = Number(withdrawForm.amount);
    if (!amount || amount < 1000) {
      setWithdrawError("Số tiền tối thiểu 1.000đ.");
      return;
    }
    if (sellerWallet && amount > sellerWallet.withdrawableBalance) {
      setWithdrawError(`Vượt số dư rút được (${formatCurrency(sellerWallet.withdrawableBalance)}).`);
      return;
    }
    if (!withdrawForm.bankName.trim() || !withdrawForm.bankAccountNumber.trim() || !withdrawForm.bankAccountName.trim()) {
      setWithdrawError("Vui lòng điền đủ thông tin ngân hàng.");
      return;
    }
    withdrawMutation.mutate({
      amount,
      bankName: withdrawForm.bankName.trim(),
      bankAccountNumber: withdrawForm.bankAccountNumber.trim(),
      bankAccountName: withdrawForm.bankAccountName.trim().toUpperCase(),
      note: withdrawForm.note.trim() || undefined,
    });
  }

  return (
    <div className="space-y-5">
      {session?.user.sellerReadOnly ? <ReadOnlyNotice /> : null}

      {/* ── Hero + Stats banner ── */}
      <div className="overflow-hidden rounded-3xl" style={{ border: "1px solid var(--bd)" }}>
        {/* Hero */}
        <div className="relative px-6 py-7 sm:px-8 sm:py-8" style={{
          background: "radial-gradient(ellipse 50% 80% at 15% 0%, rgba(99,102,241,0.20), transparent 70%), radial-gradient(ellipse 60% 100% at 85% 100%, rgba(249,115,22,0.22), transparent 70%), var(--surface)",
        }}>
          <button type="button" onClick={() => navigate("/pricing")}
            className="absolute right-5 top-5 flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[12px] font-black transition hover:opacity-90"
            style={{ background: "rgba(249,115,22,0.16)", border: "1px solid rgba(249,115,22,0.35)", color: "rgb(249,115,22)" }}>
            <Crown className="h-3.5 w-3.5" /> Nâng cấp / Gia hạn
          </button>

          <div className="flex items-center gap-5">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl text-2xl font-black text-white shadow-[0_8px_28px_-8px_rgba(249,115,22,0.6)]"
              style={{ background: "rgb(249,115,22)" }}>
              {avatarInitials}
            </div>
            <div className="min-w-0">
              <h1 className="text-3xl font-black tracking-tight" style={{ color: "var(--tx)" }}>
                {session?.user.displayName || "Seller"}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-2.5">
                {tier && (
                  <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-black"
                    style={isUltra
                      ? { background: "rgba(249,115,22,0.14)", color: "rgb(249,115,22)", border: "1px solid rgba(249,115,22,0.32)" }
                      : { background: "rgba(249,115,22,0.10)", color: "rgb(249,115,22)", border: "1px solid rgba(249,115,22,0.25)" }}>
                    {isUltra ? "★ Ultra · Tổng sỉ" : `★ ${tier.charAt(0).toUpperCase() + tier.slice(1)}`}
                  </span>
                )}
                <span className="text-[12px] font-mono" style={{ color: "var(--tx-f)" }}>
                  ID: <span style={{ color: "var(--tx-m)" }}>{session?.user.email}</span>
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-2 sm:grid-cols-5" style={{ background: "var(--surface)", borderTop: "1px solid var(--bd)" }}>
          {/* SỐ DƯ HIỆN TẠI — featured */}
          <div className="col-span-2 px-6 py-5 sm:col-span-2" style={{ borderRight: "1px solid var(--bd)" }}>
            <span className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[10px] font-black uppercase tracking-widest"
              style={{ background: "rgba(249,115,22,0.10)", border: "1px solid rgba(249,115,22,0.25)", color: "rgb(249,115,22)" }}>
              <Wallet className="h-3 w-3" /> Số dư hiện tại
            </span>
            <p className="mt-2 text-3xl font-black tabular-nums" style={{ color: "var(--tx)" }}>
              {sellerWallet ? formatCurrency(sellerWallet.balance) : "—"}
            </p>
          </div>

          {/* 3 mini stats */}
          {[
            { icon: DollarSign, label: t.statProfit === "Lợi nhuận" ? "Doanh thu" : t.statProfit, value: revSummary?.estimatedProfit ? formatCurrency(revSummary.estimatedProfit) : "—", color: "rgb(52,211,153)" },
            { icon: ShoppingBag, label: t.statOrders, value: revSummary?.deliveredOrders ?? "—", color: "rgb(249,115,22)" },
            { icon: Users, label: t.statUsers, value: usersCount || "—", color: "rgb(56,189,248)" },
          ].map(({ icon: Icon, label, value, color }, idx) => (
            <div key={label} className="px-4 py-5" style={{ borderRight: idx < 2 ? "1px solid var(--bd)" : "none" }}>
              <div className="flex items-center gap-1.5">
                <Icon className="h-3 w-3" style={{ color }} />
                <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{label}</p>
              </div>
              <p className="mt-1.5 text-xl font-black tabular-nums" style={{ color }}>{value}</p>
            </div>
          ))}

          {/* Ngày còn lại — last stat */}
          <div className="px-4 py-5 col-span-2 sm:col-span-1" style={{ borderTop: "1px solid var(--bd)", borderLeft: "1px solid var(--bd)" }}>
            <div className="flex items-center gap-1.5">
              <Calendar className="h-3 w-3" style={{ color: "rgb(167,139,250)" }} />
              <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{t.statDaysLeft}</p>
            </div>
            <p className="mt-1.5 text-xl font-black tabular-nums" style={{ color: "rgb(167,139,250)" }}>
              {daysLeft !== null ? daysLeft : "∞"}
            </p>
          </div>
        </div>
      </div>

      {/* ── 2-col grid ── */}
      <div className="grid gap-5 xl:grid-cols-2">
        {/* Left column — Tabbed account card */}
        <div className="space-y-5">
          <div className="rounded-2xl overflow-hidden" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
            <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--bd)" }}>
              <div className="flex items-center gap-2.5">
                <User className="h-4 w-4" style={{ color: "rgb(56,189,248)" }} />
                <div>
                  <h2 className="text-[15px] font-black" style={{ color: "var(--tx)" }}>Quản lý tài khoản</h2>
                  <p className="text-[11px]" style={{ color: "var(--tx-f)" }}>Liên kết tài khoản, bảo mật và xác minh danh tính</p>
                </div>
              </div>
              {/* Tab nav */}
              <div className="mt-4 flex items-center gap-1 rounded-xl p-1" style={{ background: "var(--inp)" }}>
                {([
                  { key: "linked" as const, icon: Link2, label: "Liên kết" },
                  { key: "info" as const, icon: User, label: "Thông tin" },
                  { key: "security" as const, icon: Lock, label: "Bảo mật" },
                  { key: "wallet" as const, icon: Wallet, label: "Quản lý ví" },
                ]).map(({ key, icon: Icon, label }) => {
                  const active = activeTab === key;
                  return (
                    <button key={key} type="button" onClick={() => setActiveTab(key)}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[12px] font-black transition"
                      style={{
                        background: active ? "var(--surface)" : "transparent",
                        color: active ? "var(--tx)" : "var(--tx-f)",
                        boxShadow: active ? "0 1px 3px rgba(0,0,0,0.18)" : undefined,
                      }}>
                      <Icon className="h-3.5 w-3.5" /> {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="px-5 py-5">
              {/* TAB: Liên kết */}
              {activeTab === "linked" && (
                <div className="space-y-3">
                  {[
                    { icon: Mail, key: "email", label: "Email", linked: !!session?.user.recoveryEmail, value: session?.user.recoveryEmail },
                    { icon: Send, key: "telegram", label: "Telegram", linked: false, value: null },
                  ].map(({ icon: Icon, key, label, linked, value }) => (
                    <div key={key} className="flex items-center justify-between gap-3 rounded-xl p-3.5" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: "var(--surface)", color: "rgb(56,189,248)" }}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="text-[13px] font-black" style={{ color: "var(--tx)" }}>{label}</p>
                          <p className="mt-0.5 text-[11px]" style={{ color: linked ? "var(--tx-m)" : "var(--tx-f)" }}>
                            {linked ? value : "Chưa liên kết"}
                          </p>
                        </div>
                      </div>
                      <button type="button" onClick={() => setActiveTab("info")}
                        className="rounded-lg px-3 py-1.5 text-[11px] font-black transition hover:opacity-80"
                        style={{ background: "rgb(249,115,22)", color: "#fff" }}>
                        {linked ? "Sửa" : "Liên kết"}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* TAB: Thông tin */}
              {activeTab === "info" && (
                <div className="space-y-5">
                  <div>
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
                        style={{ background: "rgba(56,189,248,0.12)", color: "rgb(56,189,248)" }}>
                        {session?.user.role === "super_admin" ? "Admin" : "Seller"}
                      </span>
                    </InfoRow>
                    <InfoRow label={t.businessTier}>
                      <TierBadge tier={tier} />
                    </InfoRow>
                    <InfoRow label={t.expiresAt}>
                      {session?.user.sellerTierExpiresAt ? (
                        <span className="flex items-center gap-2">
                          <span>{new Date(session.user.sellerTierExpiresAt).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" })}</span>
                          {daysLeft !== null && (
                            <span className="rounded-full px-2 py-0.5 text-[11px] font-black"
                              style={{ background: daysLeft <= 7 ? "rgba(239,68,68,0.12)" : "rgba(249,115,22,0.12)", color: daysLeft <= 7 ? "rgb(248,113,113)" : "rgb(249,115,22)" }}>
                              {t.daysLeft(daysLeft)}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="rounded-full px-2.5 py-0.5 text-[11px] font-black"
                          style={{ background: "rgba(52,211,153,0.12)", color: "rgb(52,211,153)" }}>
                          ∞ Không hết hạn
                        </span>
                      )}
                    </InfoRow>
                  </div>

                  {/* Recovery email form */}
                  <form onSubmit={handleUpdateRecoveryEmail} className="space-y-3">
                    <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{t.cardRecovery}</p>
                    <input type="email" value={recoveryEmail} onChange={(e) => setRecoveryEmail(e.target.value)}
                      placeholder="name@example.com" className={inputCls} style={inputStyle} />
                    {emailError && <Alert type="error">{emailError}</Alert>}
                    {emailSuccess && <Alert type="success">{emailSuccess}</Alert>}
                    <div className="flex justify-end">
                      <button type="submit" disabled={emailSubmitting}
                        className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-[13px] font-black transition hover:opacity-80 disabled:opacity-40"
                        style={{ background: "rgb(249,115,22)", color: "#fff" }}>
                        <Check className="h-3.5 w-3.5" /> {emailSubmitting ? t.saving : t.saveEmail}
                      </button>
                    </div>
                  </form>

                  {/* Referral block */}
                  <div className="space-y-3" style={{ borderTop: "1px solid var(--bd)", paddingTop: 16 }}>
                    <div className="flex items-center gap-2">
                      <Gift className="h-3.5 w-3.5" style={{ color: "rgb(249,115,22)" }} />
                      <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>Mã giới thiệu</p>
                    </div>
                    {session?.user.referralCode && (
                      <div className="rounded-xl p-3.5" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
                        <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>Mã của bạn</p>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <span className="text-[16px] font-mono font-black tracking-wider" style={{ color: "rgb(249,115,22)" }}>{session.user.referralCode}</span>
                          <div className="flex items-center gap-1.5">
                            <button type="button"
                              onClick={() => { navigator.clipboard.writeText(session.user.referralCode!); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                              className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold transition hover:opacity-80"
                              style={{ background: "var(--surface)", border: "1px solid var(--bd)", color: "var(--tx-m)" }}>
                              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} Code
                            </button>
                            <button type="button"
                              onClick={() => { const link = `${window.location.origin}/register?ref=${session.user.referralCode}`; navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                              className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold transition hover:opacity-80"
                              style={{ background: "rgba(249,115,22,0.12)", border: "1px solid rgba(249,115,22,0.25)", color: "rgb(249,115,22)" }}>
                              <Copy className="h-3 w-3" /> Link
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                    {session?.user.hasReferrer ? (
                      <>
                        {session.user.referrer?.referralCode && (
                          <div className="rounded-xl p-3.5" style={{ background: "var(--inp)", border: "1px solid var(--bd)", opacity: 0.95 }}>
                            <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>Mã của người giới thiệu bạn</p>
                            <div className="mt-1 flex items-center justify-between gap-2">
                              <span className="text-[16px] font-mono font-black tracking-wider" style={{ color: "var(--tx-m)" }}>{session.user.referrer.referralCode}</span>
                              {session.user.referrer.displayName && (
                                <span className="text-[11px]" style={{ color: "var(--tx-f)" }}>{session.user.referrer.displayName}</span>
                              )}
                            </div>
                            <p className="mt-1.5 text-[10px]" style={{ color: "var(--tx-f)" }}>
                              <Check className="mr-1 inline h-3 w-3" style={{ color: "rgb(16,185,129)" }} />
                              Đã liên kết · không thể đổi
                            </p>
                          </div>
                        )}
                        {!session.user.referrer?.referralCode && (
                          <div className="rounded-xl px-4 py-2.5 text-[12px]" style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)", color: "rgb(16,185,129)" }}>
                            <Check className="mr-1 inline h-3.5 w-3.5" /> Đã có người giới thiệu. Chỉ điền 1 lần.
                          </div>
                        )}
                      </>
                    ) : (
                      <form onSubmit={handleReferralSubmit} className="space-y-2.5">
                        <p className="text-[10px]" style={{ color: "var(--tx-f)" }}>Nhập mã của người giới thiệu (chỉ điền 1 lần)</p>
                        <div className="flex items-center gap-2">
                          <input type="text" value={referralInput}
                            onChange={(e) => setReferralInput(e.target.value.toUpperCase())}
                            placeholder="ABC23XYZ"
                            className={`${inputCls} font-mono uppercase tracking-wider`} style={inputStyle} maxLength={16} />
                          <button type="submit" disabled={referralMutation.isPending || !referralInput.trim()}
                            className="shrink-0 rounded-xl px-4 py-2.5 text-[12px] font-black transition hover:opacity-80 disabled:opacity-40"
                            style={{ background: "rgb(249,115,22)", color: "#fff" }}>
                            {referralMutation.isPending ? "..." : "Lưu"}
                          </button>
                        </div>
                        {referralError && <Alert type="error">{referralError}</Alert>}
                        {referralSuccess && <Alert type="success">Đã lưu mã giới thiệu.</Alert>}
                      </form>
                    )}
                  </div>
                </div>
              )}

              {/* TAB: Bảo mật */}
              {activeTab === "security" && (
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
                  {error && <Alert type="error">{error}</Alert>}
                  {success && <Alert type="success">{success}</Alert>}
                  <div className="flex justify-end pt-1">
                    <button type="submit" disabled={submitting}
                      className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-black transition hover:opacity-80 disabled:opacity-40"
                      style={{ background: "rgb(249,115,22)", color: "#fff" }}>
                      <KeyRound className="h-3.5 w-3.5" /> {submitting ? t.changing : t.changePassword}
                    </button>
                  </div>
                </form>
              )}

              {/* TAB: Quản lý ví */}
              {activeTab === "wallet" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>Số dư hiện tại</p>
                      <p className="mt-1 text-3xl font-black tabular-nums" style={{ color: "rgb(52,211,153)" }}>
                        {sellerWallet ? formatCurrency(sellerWallet.balance) : "—"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => setWithdrawOpen(true)}
                        disabled={!sellerWallet || sellerWallet.withdrawableBalance <= 0}
                        className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[12px] font-black transition hover:opacity-80 disabled:opacity-40"
                        style={{ background: "rgba(249,115,22,0.12)", border: "1px solid rgba(249,115,22,0.25)", color: "rgb(249,115,22)" }}>
                        <ArrowUpRight className="h-3.5 w-3.5" /> Rút tiền
                      </button>
                      <button type="button" onClick={() => setDepositOpen(true)}
                        className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[12px] font-black transition hover:opacity-90"
                        style={{ background: "rgb(249,115,22)", color: "#fff" }}>
                        <Plus className="h-3.5 w-3.5" /> Nạp tiền
                      </button>
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>Giao dịch gần đây</p>
                      <button type="button" onClick={() => setHistoryOpen(true)}
                        className="text-[11px] font-bold rounded-lg px-2 py-1 transition hover:opacity-80"
                        style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-f)" }}>
                        Xem tất cả {ledgers.length > 0 ? `(${ledgers.length})` : ""}
                      </button>
                    </div>
                    {ledgers.length === 0 ? (
                      <p className="rounded-xl py-6 text-center text-[12px]" style={{ color: "var(--tx-f)", background: "var(--inp)", border: "1px solid var(--bd)" }}>
                        Chưa có giao dịch nào.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {ledgers.slice(0, 6).map((l) => {
                          const isCredit = l.amount > 0;
                          return (
                            <div key={l.id} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
                              <div className="flex min-w-0 items-center gap-2.5">
                                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                                  style={{ background: isCredit ? "rgba(52,211,153,0.12)" : "rgba(239,68,68,0.12)", color: isCredit ? "rgb(52,211,153)" : "rgb(239,68,68)" }}>
                                  {isCredit ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
                                </div>
                                <div className="min-w-0">
                                  <p className="truncate text-[12px] font-bold" style={{ color: "var(--tx)" }}>
                                    {l.note?.startsWith("WALLET_TOPUP:") ? "Nạp ví từ dashboard" : (l.note || l.type.replace(/_/g, " "))}
                                  </p>
                                  <p className="text-[10px]" style={{ color: "var(--tx-f)" }}>
                                    {new Date(l.createdAt).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" })}
                                  </p>
                                </div>
                              </div>
                              <span className="shrink-0 text-[13px] font-black tabular-nums" style={{ color: isCredit ? "rgb(52,211,153)" : "rgb(239,68,68)" }}>
                                {isCredit ? "+" : ""}{formatCurrency(l.amount)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
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

        </div>
      </div>

      {/* History modal */}
      {historyOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
          style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(12px)" }}
          onClick={() => setHistoryOpen(false)}>
          <div onClick={(e) => e.stopPropagation()}
            className="relative flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-[24px] shadow-[0_24px_64px_-12px_rgba(0,0,0,0.6)]"
            style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid var(--bd)" }}>
              <div className="flex items-center gap-2.5">
                <Wallet className="h-4 w-4" style={{ color: "rgb(56,189,248)" }} />
                <h2 className="text-[15px] font-black" style={{ color: "var(--tx)" }}>Lịch sử giao dịch ví</h2>
              </div>
              <button type="button" onClick={() => setHistoryOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full transition hover:bg-rose-500/15"
                style={{ background: "var(--inp)", color: "var(--tx-f)" }}>
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              {/* Pending deposits */}
              {(depositReqsQuery.data?.filter?.((r: any) => r.status === "PENDING")?.length ?? 0) > 0 && (
                <div>
                  <p className="mb-2 text-[10px] font-black uppercase tracking-widest" style={{ color: "rgb(249,115,22)" }}>Yêu cầu nạp đang chờ</p>
                  <div className="space-y-1.5">
                    {depositReqsQuery.data?.filter((r: any) => r.status === "PENDING").map((r: any) => (
                      <div key={r.id} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5" style={{ background: "var(--inp)", border: "1px solid rgba(249,115,22,0.25)" }}>
                        <div className="flex min-w-0 items-center gap-2.5">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: "rgba(249,115,22,0.12)", color: "rgb(249,115,22)" }}>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-[12px] font-bold" style={{ color: "var(--tx)" }}>Nạp qua {r.provider}</p>
                            <p className="text-[10px]" style={{ color: "var(--tx-f)" }}>{new Date(r.createdAt).toLocaleString("vi-VN")}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[13px] font-black tabular-nums" style={{ color: "rgb(249,115,22)" }}>+{formatCurrency(Number(r.amount))}</span>
                          <button type="button"
                            onClick={() => { if (window.confirm("Hủy yêu cầu nạp này?")) cancelDepositMutation.mutate(r.id); }}
                            disabled={cancelDepositMutation.isPending}
                            className="rounded-lg px-2 py-1 text-[10px] font-black transition hover:opacity-80 disabled:opacity-40"
                            style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.25)", color: "rgb(239,68,68)" }}>
                            Hủy
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Pending withdraws */}
              {(withdrawReqsQuery.data?.filter?.((r: any) => r.status === "PENDING")?.length ?? 0) > 0 && (
                <div>
                  <p className="mb-2 text-[10px] font-black uppercase tracking-widest" style={{ color: "rgb(249,115,22)" }}>Yêu cầu rút đang chờ duyệt</p>
                  <div className="space-y-1.5">
                    {withdrawReqsQuery.data?.filter((r: any) => r.status === "PENDING").map((r: any) => (
                      <div key={r.id} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5" style={{ background: "var(--inp)", border: "1px solid rgba(249,115,22,0.25)" }}>
                        <div className="flex min-w-0 items-center gap-2.5">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: "rgba(249,115,22,0.12)", color: "rgb(249,115,22)" }}>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-[12px] font-bold" style={{ color: "var(--tx)" }}>Rút {r.bankName} · {r.bankAccountNumber}</p>
                            <p className="text-[10px]" style={{ color: "var(--tx-f)" }}>{new Date(r.createdAt).toLocaleString("vi-VN")}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[13px] font-black tabular-nums" style={{ color: "rgb(239,68,68)" }}>-{formatCurrency(Number(r.amount))}</span>
                          <button type="button"
                            onClick={() => { if (window.confirm("Hủy yêu cầu rút này? Tiền sẽ được mở khóa lại trong ví.")) cancelWithdrawMutation.mutate(r.id); }}
                            disabled={cancelWithdrawMutation.isPending}
                            className="rounded-lg px-2 py-1 text-[10px] font-black transition hover:opacity-80 disabled:opacity-40"
                            style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.25)", color: "rgb(239,68,68)" }}>
                            Hủy
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* All confirmed ledger entries */}
              <div>
                <p className="mb-2 text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>Đã xử lý ({ledgers.length})</p>
                {ledgers.length === 0 ? (
                  <p className="rounded-xl py-8 text-center text-[12px]" style={{ color: "var(--tx-f)", background: "var(--inp)", border: "1px solid var(--bd)" }}>
                    Chưa có giao dịch nào.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {ledgers.map((l) => {
                      const isCredit = l.amount > 0;
                      const typeLabel = (() => {
                        switch (l.type) {
                          case "topup": return "Nạp ví";
                          case "withdraw": return "Rút ví";
                          case "affiliate_level_1": return "Hoa hồng L1";
                          case "affiliate_level_2": return "Hoa hồng L2";
                          case "affiliate_clawback": return "Hoàn hoa hồng";
                          case "subscription_payment": return "Mua gói";
                          case "admin_adjustment": return "Admin điều chỉnh";
                          default: return l.type.replace(/_/g, " ");
                        }
                      })();
                      return (
                        <div key={l.id} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
                          <div className="flex min-w-0 items-center gap-2.5">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                              style={{ background: isCredit ? "rgba(52,211,153,0.12)" : "rgba(239,68,68,0.12)", color: isCredit ? "rgb(52,211,153)" : "rgb(239,68,68)" }}>
                              {isCredit ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-[12px] font-bold" style={{ color: "var(--tx)" }}>{typeLabel}</p>
                              <p className="truncate text-[10px]" style={{ color: "var(--tx-f)" }}>
                                {new Date(l.createdAt).toLocaleString("vi-VN")} {l.note ? `· ${l.note.startsWith("WALLET_TOPUP:") ? "nạp từ dashboard" : l.note}` : ""}
                              </p>
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-[13px] font-black tabular-nums" style={{ color: isCredit ? "rgb(52,211,153)" : "rgb(239,68,68)" }}>
                              {isCredit ? "+" : ""}{formatCurrency(l.amount)}
                            </p>
                            <p className="text-[10px] tabular-nums" style={{ color: "var(--tx-f)" }}>
                              Số dư: {formatCurrency(l.balanceAfter)}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Deposit modal */}
      {depositOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
          style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(12px)" }}
          onClick={() => !depositMutation.isPending && closeDepositModal()}>
          <div onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md overflow-hidden rounded-[24px] shadow-[0_24px_64px_-12px_rgba(0,0,0,0.6)]"
            style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
            <div className="relative px-6 pt-6 pb-4" style={{ background: "linear-gradient(180deg, rgba(16,185,129,0.12) 0%, transparent 100%)", borderBottom: "1px solid var(--bd)" }}>
              <button type="button" onClick={closeDepositModal}
                className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full transition hover:bg-rose-500/15"
                style={{ background: "var(--inp)", color: "var(--tx-f)" }}>
                <X className="h-4 w-4" />
              </button>
              <h2 className="text-[18px] font-black" style={{ color: "var(--tx)" }}>Nạp tiền vào ví seller</h2>
              <p className="mt-1 text-[12px]" style={{ color: "var(--tx-f)" }}>
                {sellerWallet ? <>Số dư hiện tại: <span className="font-bold tabular-nums" style={{ color: "var(--tx)" }}>{formatCurrency(sellerWallet.balance)}</span></> : "Đang tải..."}
              </p>
            </div>

            {!depositResponse ? (
              <form onSubmit={handleDepositSubmit} className="space-y-4 px-6 py-5">
                <div>
                  <p className="mb-1.5 text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>Số tiền (đ)</p>
                  <input type="number" inputMode="numeric" min={1000} value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    placeholder="100000" className={inputCls} style={inputStyle} />
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {[100000, 500000, 1000000, 5000000].map((v) => (
                      <button key={v} type="button" onClick={() => setDepositAmount(String(v))}
                        className="rounded-lg px-2.5 py-1 text-[11px] font-bold transition hover:opacity-80"
                        style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-m)" }}>
                        {v >= 1000000 ? `${v / 1000000}M` : `${v / 1000}k`}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>Phương thức</p>
                  <div className="space-y-2">
                    {([
                      { key: "PAYOS" as const, icon: "🏦", label: "Chuyển khoản VND", desc: "PayOS · QR ngân hàng · tự cộng" },
                      { key: "USDT_SOL" as const, icon: "💎", label: "USDT Solana", desc: "Chuyển USDT mạng Solana" },
                      { key: "BINANCE" as const, icon: "🟡", label: "Binance UID", desc: "Chuyển Binance Pay (UID)" },
                    ]).map(({ key, icon, label, desc }) => {
                      const selected = depositMethod === key;
                      return (
                        <button key={key} type="button" onClick={() => setDepositMethod(key)}
                          className="group flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left transition hover:scale-[1.01]"
                          style={{
                            background: selected ? "rgba(16,185,129,0.08)" : "var(--inp)",
                            border: `1.5px solid ${selected ? "rgba(16,185,129,0.6)" : "transparent"}`,
                          }}>
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg" style={{ background: "var(--surface)" }}>{icon}</span>
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-semibold" style={{ color: "var(--tx)" }}>{label}</p>
                            <p className="mt-0.5 text-[11px]" style={{ color: "var(--tx-f)" }}>{desc}</p>
                          </div>
                          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                            style={{ background: selected ? "rgb(16,185,129)" : "transparent", border: `1.5px solid ${selected ? "rgb(16,185,129)" : "var(--bd)"}` }}>
                            {selected && <CheckCircle2 className="h-3 w-3 text-white" strokeWidth={3} />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {depositError && <Alert type="error">{depositError}</Alert>}

                <button type="submit" disabled={depositMutation.isPending}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-[14px] font-black transition hover:opacity-90 disabled:opacity-50"
                  style={{ background: "rgb(16,185,129)", color: "white" }}>
                  {depositMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Đang tạo...</> : "Tạo yêu cầu nạp"}
                </button>
              </form>
            ) : (
              <DepositPaymentView response={depositResponse} method={depositMethod} onClose={closeDepositModal} />
            )}
          </div>
        </div>
      )}

      {/* Withdraw modal */}
      {withdrawOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
          style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(12px)" }}
          onClick={() => !withdrawMutation.isPending && setWithdrawOpen(false)}>
          <div onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md overflow-hidden rounded-[24px] shadow-[0_24px_64px_-12px_rgba(0,0,0,0.6)]"
            style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
            <div className="relative px-6 pt-6 pb-4" style={{ background: "linear-gradient(180deg, rgba(249,115,22,0.12) 0%, transparent 100%)", borderBottom: "1px solid var(--bd)" }}>
              <button type="button" onClick={() => setWithdrawOpen(false)}
                className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full transition hover:bg-rose-500/15"
                style={{ background: "var(--inp)", color: "var(--tx-f)" }}>
                <X className="h-4 w-4" />
              </button>
              <h2 className="text-[18px] font-black" style={{ color: "var(--tx)" }}>Rút tiền về ngân hàng</h2>
              <p className="mt-1 text-[12px]" style={{ color: "var(--tx-f)" }}>
                Số dư rút được: <span className="font-bold tabular-nums" style={{ color: "var(--tx)" }}>{sellerWallet ? formatCurrency(sellerWallet.withdrawableBalance) : "—"}</span>
              </p>
            </div>

            <form onSubmit={handleWithdrawSubmit} className="space-y-3 px-6 py-5">
              <div>
                <p className="mb-1.5 text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>Số tiền (đ)</p>
                <input type="number" inputMode="numeric" min={1000} value={withdrawForm.amount}
                  onChange={(e) => setWithdrawForm((f) => ({ ...f, amount: e.target.value }))}
                  placeholder="100000" className={inputCls} style={inputStyle} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="mb-1.5 text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>Ngân hàng</p>
                  <input type="text" value={withdrawForm.bankName}
                    onChange={(e) => setWithdrawForm((f) => ({ ...f, bankName: e.target.value }))}
                    placeholder="Vietcombank" className={inputCls} style={inputStyle} />
                </div>
                <div>
                  <p className="mb-1.5 text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>Số tài khoản</p>
                  <input type="text" inputMode="numeric" value={withdrawForm.bankAccountNumber}
                    onChange={(e) => setWithdrawForm((f) => ({ ...f, bankAccountNumber: e.target.value.replace(/\s+/g, "") }))}
                    placeholder="0123456789" className={inputCls} style={inputStyle} />
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>Chủ tài khoản</p>
                <input type="text" value={withdrawForm.bankAccountName}
                  onChange={(e) => setWithdrawForm((f) => ({ ...f, bankAccountName: e.target.value }))}
                  placeholder="NGUYEN VAN A" className={`${inputCls} uppercase`} style={inputStyle} />
              </div>
              <div>
                <p className="mb-1.5 text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>Ghi chú <span className="font-normal lowercase tracking-normal">(tuỳ chọn)</span></p>
                <input type="text" value={withdrawForm.note}
                  onChange={(e) => setWithdrawForm((f) => ({ ...f, note: e.target.value }))}
                  placeholder="Rút hoa hồng tháng 5" className={inputCls} style={inputStyle} />
              </div>

              {withdrawError && <Alert type="error">{withdrawError}</Alert>}

              <div className="rounded-xl px-4 py-3 text-[11px]" style={{ background: "rgba(249,115,22,0.08)", border: "1px solid rgba(249,115,22,0.2)", color: "var(--tx-f)" }}>
                Yêu cầu sẽ được duyệt thủ công bởi quản trị viên trong vòng 24 giờ.
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button type="submit" disabled={withdrawMutation.isPending}
                  className="flex-1 rounded-xl py-3 text-[13px] font-black transition hover:opacity-90 disabled:opacity-40"
                  style={{ background: "rgb(249,115,22)", color: "#fff" }}>
                  {withdrawMutation.isPending ? "Đang gửi..." : "Gửi yêu cầu rút"}
                </button>
                <button type="button" onClick={() => setWithdrawOpen(false)} disabled={withdrawMutation.isPending}
                  className="rounded-xl px-4 py-3 text-[13px] font-black transition hover:opacity-80 disabled:opacity-40"
                  style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-f)" }}>
                  Hủy
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
