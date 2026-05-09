import { KeyRound } from "lucide-react";
import { useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";

import { StudioButton, StudioInput } from "@/components/studio/studio-ui";
import { api } from "@/lib/api";

export function ResetPasswordPageStudio() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (newPassword.length < 6) {
      setError("Mật khẩu mới phải có ít nhất 6 ký tự.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Mật khẩu xác nhận không khớp.");
      return;
    }

    try {
      setLoading(true);
      const response = await api.post("/auth/reset-password", {
        token,
        newPassword,
      });

      setSuccess(
        response.data?.message ||
          "Đặt lại mật khẩu thành công. Bạn có thể đăng nhập bằng mật khẩu mới.",
      );
      setNewPassword("");
      setConfirmPassword("");
    } catch (submissionError: any) {
      setError(
        submissionError?.response?.data?.message ||
          submissionError?.message ||
          "Không thể đặt lại mật khẩu.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-stage flex min-h-screen items-center justify-center px-6 py-10">
      <div className="auth-shell w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[12px] border border-emerald-300/24 bg-[linear-gradient(135deg,#34D399,#10B981)] text-[#07131e] shadow-[0_20px_44px_rgba(16,185,129,0.2)]">
            <KeyRound className="h-7 w-7" />
          </div>
          <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.34em] text-slate-500">
            Bảo mật tài khoản
          </p>
          <h1 className="mt-4 text-4xl font-black tracking-tight text-white">
            Tạo mật khẩu mới
          </h1>
          <p className="mx-auto mt-4 max-w-sm text-sm leading-7 text-slate-400">
            Nhập mật khẩu mới cho tài khoản của bạn. Link reset chỉ dùng được một lần.
          </p>
        </div>

        <div className="auth-panel rounded-[20px] border border-white/10 p-6 sm:p-7">
          <form className="space-y-5" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-200" htmlFor="newPassword">
                Mật khẩu mới
              </label>
              <StudioInput
                autoComplete="new-password"
                id="newPassword"
                placeholder="Tối thiểu 6 ký tự"
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label
                className="block text-sm font-medium text-slate-200"
                htmlFor="confirmPassword"
              >
                Nhập lại mật khẩu
              </label>
              <StudioInput
                autoComplete="new-password"
                id="confirmPassword"
                placeholder="Nhập lại mật khẩu mới"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </div>

            {error ? (
              <div className="rounded-[20px] border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                {error}
              </div>
            ) : null}

            {success ? (
              <div className="rounded-[20px] border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm leading-6 text-emerald-100">
                {success}
              </div>
            ) : null}

            <StudioButton
              className="w-full"
              disabled={loading || Boolean(success)}
              size="lg"
              type="submit"
            >
              {loading ? "Đang cập nhật..." : "Đặt lại mật khẩu"}
            </StudioButton>
            <Link
              className="inline-flex w-full items-center justify-center rounded-[12px] border border-white/10 bg-[#18233c] px-5 py-3.5 text-[0.95rem] font-semibold text-slate-100 transition hover:-translate-y-px hover:border-emerald-300/18 hover:bg-[#1E2A47]"
              to="/login"
            >
              Về trang đăng nhập
            </Link>
          </form>
        </div>
      </div>
    </div>
  );
}
