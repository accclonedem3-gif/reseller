import { Lock } from "lucide-react";

export function ReadOnlyNotice({
  title = "Tài khoản FREE — Chỉ xem",
  description = "Mọi thao tác cấu hình, tạo dữ liệu và vận hành shop bị khóa. Nâng cấp lên Pro để mở khoá toàn bộ tính năng.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div
      className="flex items-start gap-3 rounded-[16px] px-4 py-3.5"
      style={{
        background: "rgba(249,115,22,0.07)",
        border: "1px solid rgba(249,115,22,0.2)",
      }}
    >
      <span
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]"
        style={{ background: "rgba(249,115,22,0.15)", color: "rgb(249,115,22)" }}
      >
        <Lock className="h-3.5 w-3.5" />
      </span>
      <div>
        <p className="text-sm font-semibold" style={{ color: "rgb(249,115,22)" }}>{title}</p>
        <p className="mt-0.5 text-sm leading-5" style={{ color: "var(--tx-m)" }}>{description}</p>
      </div>
    </div>
  );
}
