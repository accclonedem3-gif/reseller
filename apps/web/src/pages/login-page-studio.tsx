import { MessageCircle, Send, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Navigate } from "react-router-dom";

import { useAuth } from "@/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

export function LoginPageStudio() {
  const { login, register, session } = useAuth();
  const [mode, setMode] = useState<"login" | "forgot" | "register">("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [devResetLink, setDevResetLink] = useState<string | null>(null);
  const [supportOpen, setSupportOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  if (session) {
    return <Navigate to="/" replace />;
  }

  async function handleLoginSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await login(username, password);
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || "Không thể đăng nhập.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRegisterSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);

    if (displayName.trim().length < 2) {
      setError("Tên hiển thị phải có ít nhất 2 ký tự.");
      setLoading(false);
      return;
    }
    if (username.trim().length < 2) {
      setError("Tên đăng nhập phải có ít nhất 2 ký tự.");
      setLoading(false);
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Email không hợp lệ.");
      setLoading(false);
      return;
    }
    if (password.length < 6) {
      setError("Mật khẩu phải có ít nhất 6 ký tự.");
      setLoading(false);
      return;
    }
    if (password !== confirmPassword) {
      setError("Mật khẩu xác nhận không khớp.");
      setLoading(false);
      return;
    }

    try {
      await register(username.trim(), email.trim(), password, displayName.trim());
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || "Không thể tạo tài khoản lúc này.");
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);
    setDevResetLink(null);

    try {
      const response = await api.post("/auth/forgot-password", { email: recoveryEmail });
      setNotice(response.data?.message || "Nếu email tồn tại, hệ thống đã gửi link reset.");
      setDevResetLink(response.data?.devResetLink || null);
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || "Không thể gửi link đặt lại mật khẩu.");
    } finally {
      setLoading(false);
    }
  }

  function switchMode(next: "login" | "register" | "forgot") {
    setMode(next);
    setError(null);
    setNotice(null);
    setDevResetLink(null);
    if (next === "register") {
      setNotice("Tài khoản mới sẽ bắt đầu ở gói FREE và chỉ có quyền xem.");
    }
  }

  const modeTitle: Record<typeof mode, string> = {
    login: "Đăng nhập",
    register: "Đăng ký",
    forgot: "Đặt lại mật khẩu",
  };

  const modeDesc: Record<typeof mode, string> = {
    login: "Truy cập trang quản lý reseller của bạn.",
    register: "Tạo tài khoản FREE, nâng cấp PRO khi cần vận hành thật.",
    forgot: "Nhập email khôi phục đã gắn với tài khoản.",
  };

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-3" style={{ background: "var(--bg)" }}>

      {/* ── Left sidebar — brand ─────────────────────────── */}
      <aside
        className="relative hidden lg:flex flex-col justify-between overflow-hidden p-12"
        style={{ borderRight: "1px solid var(--bd)", background: "var(--surface)" }}
      >
        <div
          className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full"
          style={{ background: "rgba(249,115,22,0.08)", filter: "blur(72px)" }}
        />
        <div
          className="pointer-events-none absolute -bottom-28 -right-28 h-96 w-96 rounded-full"
          style={{ background: "rgba(249,115,22,0.06)", filter: "blur(90px)" }}
        />

        {/* Logo */}
        <div className="relative flex items-center gap-3">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-500 text-white"
            style={{ boxShadow: "0 12px 36px rgba(249,115,22,0.35)" }}
          >
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div>
            <div className="text-xl font-black uppercase tracking-tighter" style={{ color: "var(--tx)" }}>
              Altivox <span className="text-orange-500">AI</span>
            </div>
            <div
              className="text-[10px] font-bold uppercase tracking-[0.2em]"
              style={{ color: "var(--tx-f)" }}
            >
              Reseller Platform
            </div>
          </div>
        </div>

        {/* Tagline */}
        <div className="relative max-w-xs">
          <div
            className="mb-5 text-[2.6rem] font-black leading-[1.1] tracking-tighter"
            style={{ color: "var(--tx)" }}
          >
            BÁN HÀNG<br />
            <span className="text-orange-500">TỰ ĐỘNG</span><br />
            THÔNG MINH.
          </div>
          <p className="text-sm font-medium leading-relaxed" style={{ color: "var(--tx-m)" }}>
            Nền tảng Telegram reseller với bot tự động, quản lý sản phẩm và thanh toán tích hợp sẵn.
          </p>
        </div>

        <div
          className="relative text-[10px] font-black uppercase tracking-[0.28em]"
          style={{ color: "var(--tx-f)" }}
        >
          © {new Date().getFullYear()} Altivox Ecosystem
        </div>
      </aside>

      {/* ── Right — form ─────────────────────────────────── */}
      <main
        className="relative flex items-center justify-center overflow-hidden p-6 sm:p-10 lg:col-span-2"
        style={{ background: "var(--bg)" }}
      >
        <div
          className="pointer-events-none absolute right-[-10%] top-[-10%] h-[40%] w-[40%] rounded-full"
          style={{ background: "rgba(249,115,22,0.05)", filter: "blur(120px)" }}
        />
        <div
          className="pointer-events-none absolute bottom-[-10%] left-[-10%] h-[30%] w-[30%] rounded-full"
          style={{ background: "rgba(249,115,22,0.04)", filter: "blur(100px)" }}
        />

        <div className="relative z-10 w-full max-w-md">
          {/* Mobile brand */}
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500 text-white">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <span className="text-2xl font-black uppercase tracking-tighter" style={{ color: "var(--tx)" }}>
              Altivox <span className="text-orange-500">AI</span>
            </span>
          </div>

          {/* Card */}
          <div
            className="rounded-[28px] border p-8"
            style={{
              background: "var(--surface)",
              borderColor: "var(--bd)",
              boxShadow: "0 24px 60px rgba(0,0,0,0.07)",
            }}
          >
            {/* Mode header */}
            <div className="mb-6">
              <h1
                className="text-3xl font-black uppercase tracking-tighter"
                style={{ color: "var(--tx)" }}
              >
                {modeTitle[mode]}
              </h1>
              <p className="mt-1 text-sm font-medium" style={{ color: "var(--tx-m)" }}>
                {modeDesc[mode]}
              </p>
            </div>

            {/* ── Login ── */}
            {mode === "login" && (
              <form className="space-y-5" onSubmit={handleLoginSubmit}>
                <AuthField label="Tên đăng nhập" htmlFor="username">
                  <Input
                    autoComplete="username"
                    id="username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </AuthField>

                <AuthField
                  label="Mật khẩu"
                  htmlFor="password"
                  right={
                    <button
                      type="button"
                      className="text-[11px] font-black uppercase tracking-widest text-orange-500 transition hover:opacity-75"
                      onClick={() => switchMode("forgot")}
                    >
                      Quên mật khẩu?
                    </button>
                  }
                >
                  <Input
                    autoComplete="current-password"
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </AuthField>

                <AuthMessages error={error} notice={notice} devResetLink={devResetLink} />

                <Button className="w-full font-black uppercase tracking-widest" disabled={loading} size="lg" type="submit">
                  {loading ? "Đang xác thực..." : "Đăng nhập ngay"}
                </Button>
              </form>
            )}

            {/* ── Register ── */}
            {mode === "register" && (
              <form className="space-y-4" onSubmit={handleRegisterSubmit}>
                <AuthField label="Tên hiển thị" htmlFor="displayName">
                  <Input
                    id="displayName"
                    type="text"
                    placeholder="Nguyễn Văn A"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                </AuthField>

                <AuthField label="Tên đăng nhập" htmlFor="regUsername">
                  <Input
                    autoComplete="username"
                    id="regUsername"
                    type="text"
                    placeholder="vd: myshop123"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </AuthField>

                <AuthField label="Email xác minh" htmlFor="registerEmail">
                  <Input
                    autoComplete="email"
                    id="registerEmail"
                    type="email"
                    placeholder="name@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </AuthField>

                <div className="grid gap-4 sm:grid-cols-2">
                  <AuthField label="Mật khẩu" htmlFor="registerPassword">
                    <Input
                      autoComplete="new-password"
                      id="registerPassword"
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </AuthField>
                  <AuthField label="Xác nhận" htmlFor="confirmPassword">
                    <Input
                      autoComplete="new-password"
                      id="confirmPassword"
                      type="password"
                      placeholder="••••••••"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                    />
                  </AuthField>
                </div>

                <AuthMessages error={error} notice={notice} devResetLink={devResetLink} />

                <Button className="w-full font-black uppercase tracking-widest" disabled={loading} size="lg" type="submit">
                  {loading ? "Đang khởi tạo..." : "Tạo tài khoản ngay"}
                </Button>
              </form>
            )}

            {/* ── Forgot ── */}
            {mode === "forgot" && (
              <form className="space-y-5" onSubmit={handleForgotSubmit}>
                <AuthField label="Email khôi phục" htmlFor="recoveryEmail">
                  <Input
                    autoComplete="email"
                    id="recoveryEmail"
                    type="email"
                    placeholder="name@example.com"
                    value={recoveryEmail}
                    onChange={(e) => setRecoveryEmail(e.target.value)}
                  />
                </AuthField>

                <AuthMessages error={error} notice={notice} devResetLink={devResetLink} />

                <Button className="w-full font-black uppercase tracking-widest" disabled={loading} size="lg" type="submit">
                  {loading ? "Đang gửi..." : "Gửi link đặt lại"}
                </Button>
              </form>
            )}

            {/* Mode switcher footer */}
            <div className="mt-6 border-t pt-5" style={{ borderColor: "var(--bd)" }}>
              {mode === "login" ? (
                <p className="text-center text-sm" style={{ color: "var(--tx-m)" }}>
                  Chưa có tài khoản?{" "}
                  <button
                    type="button"
                    className="text-[11px] font-black uppercase tracking-tighter text-orange-500 hover:opacity-75 transition ml-1"
                    onClick={() => switchMode("register")}
                  >
                    Đăng ký mới
                  </button>
                </p>
              ) : (
                <p className="text-center text-sm" style={{ color: "var(--tx-m)" }}>
                  Đã có tài khoản?{" "}
                  <button
                    type="button"
                    className="text-[11px] font-black uppercase tracking-tighter text-orange-500 hover:opacity-75 transition ml-1"
                    onClick={() => switchMode("login")}
                  >
                    Đăng nhập
                  </button>
                </p>
              )}

              {/* Support */}
              <div className="mt-4 flex items-center justify-center gap-2">
                <button
                  aria-expanded={supportOpen}
                  type="button"
                  className="text-[11px] font-black uppercase tracking-[0.16em] transition hover:opacity-75"
                  style={{ color: "var(--tx-f)" }}
                  onClick={() => setSupportOpen((v) => !v)}
                >
                  Hỗ trợ
                </button>
                {supportOpen && (
                  <>
                    <span style={{ color: "var(--bd)" }}>·</span>
                    <a
                      aria-label="Telegram @thaidem57"
                      className="flex h-9 w-9 items-center justify-center rounded-xl transition hover:opacity-80"
                      style={{ background: "var(--inp)", color: "var(--tx-m)" }}
                      href="https://t.me/thaidem57"
                      rel="noreferrer"
                      target="_blank"
                    >
                      <Send className="h-4 w-4" />
                    </a>
                    <a
                      aria-label="Zalo 0366566303"
                      className="flex h-9 w-9 items-center justify-center rounded-xl transition hover:opacity-80"
                      style={{ background: "var(--inp)", color: "var(--tx-m)" }}
                      href="https://zalo.me/0366566303"
                      rel="noreferrer"
                      target="_blank"
                    >
                      <MessageCircle className="h-4 w-4" />
                    </a>
                  </>
                )}
              </div>
            </div>
          </div>

          <p
            className="mt-6 text-center text-[10px] font-bold uppercase tracking-[0.2em]"
            style={{ color: "var(--tx-f)" }}
          >
            Reliable Reseller Platform
          </p>
        </div>
      </main>
    </div>
  );
}

function AuthField({
  label,
  htmlFor,
  right,
  children,
}: {
  label: string;
  htmlFor: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor={htmlFor}
          className="text-[11px] font-bold uppercase tracking-widest"
          style={{ color: "var(--tx-f)" }}
        >
          {label}
        </label>
        {right}
      </div>
      {children}
    </div>
  );
}

function AuthMessages({
  error,
  notice,
  devResetLink,
}: {
  error: string | null;
  notice: string | null;
  devResetLink: string | null;
}) {
  return (
    <>
      {error && (
        <div className="rounded-[16px] border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-500">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-[16px] border border-orange-400/20 bg-orange-500/10 px-4 py-3 text-sm leading-6 text-orange-500">
          <p>{notice}</p>
          {devResetLink && (
            <a className="mt-2 inline-flex font-semibold underline underline-offset-4" href={devResetLink}>
              Mở link reset test
            </a>
          )}
        </div>
      )}
    </>
  );
}
