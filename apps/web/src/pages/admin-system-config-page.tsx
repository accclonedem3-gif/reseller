import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AxiosError } from "axios";

import { SectionHeading } from "@/components/dashboard/section-heading";
import { Field } from "@/components/dashboard/field";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";

const CONFIG_SCHEMA: Array<{
  key: string;
  label: string;
  description?: string;
  type?: "text" | "textarea" | "number";
}> = [
  {
    key: "platform_name",
    label: "Tên nền tảng",
    description: "Tên hiển thị trong dashboard và bot.",
  },
  {
    key: "support_telegram",
    label: "Telegram hỗ trợ",
    description: "Username hoặc link Telegram của bộ phận hỗ trợ. VD: @support",
  },
  {
    key: "support_zalo",
    label: "Zalo hỗ trợ",
    description: "Số điện thoại hoặc link Zalo hỗ trợ.",
  },
  {
    key: "registration_open",
    label: "Cho phép đăng ký",
    description: "true = mở đăng ký seller, false = khóa.",
  },
  {
    key: "maintenance_message",
    label: "Thông báo bảo trì",
    description: "Để trống nếu không có bảo trì.",
    type: "textarea",
  },
  {
    key: "pro_upgrade_contact",
    label: "Liên hệ nâng cấp PRO",
    description: "Thông tin liên hệ để nâng cấp lên PRO.",
  },
  {
    key: "default_warranty_note",
    label: "Ghi chú bảo hành mặc định",
    description: "Hiển thị khi tạo yêu cầu bảo hành mới.",
    type: "textarea",
  },
];

function getApiErrorMessage(error: unknown) {
  const e = error as AxiosError<{ message?: string | string[] }>;
  const msg = e.response?.data?.message;
  if (Array.isArray(msg)) return msg.join(", ");
  if (typeof msg === "string" && msg.trim()) return msg;
  return "Có lỗi xảy ra. Hãy thử lại.";
}

export function AdminSystemConfigPage() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [form, setForm] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  const { data: configs, isLoading } = useQuery<Record<string, string>>({
    queryKey: ["admin", "system-config"],
    queryFn: () => api.get("/admin/system-config").then((r) => r.data),
  });

  useEffect(() => {
    if (configs) {
      setForm(configs);
      setDirty(false);
    }
  }, [configs]);

  const saveMutation = useMutation({
    mutationFn: () => api.put("/admin/system-config", { configs: form }),
    onSuccess: async () => {
      showToast({ tone: "success", message: "Đã lưu cấu hình hệ thống." });
      setDirty(false);
      await queryClient.invalidateQueries({ queryKey: ["admin", "system-config"] });
    },
    onError: (e) => showToast({ tone: "error", message: getApiErrorMessage(e) }),
  });

  function handleChange(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Quản trị hệ thống"
        title="Cài đặt hệ thống"
        description="Cấu hình các thông số vận hành nền tảng. Thay đổi có hiệu lực ngay sau khi lưu."
      />

      <Card className="p-5">
        {isLoading ? (
          <p className="text-sm text-slate-400">Đang tải cấu hình...</p>
        ) : (
          <div className="space-y-5">
            {CONFIG_SCHEMA.map(({ key, label, description, type = "text" }) => (
              <Field key={key} label={label} description={description}>
                {type === "textarea" ? (
                  <textarea
                    rows={3}
                    className="w-full rounded-[14px] border border-white/10 bg-[#121a2e] px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:border-emerald-300/40 resize-none"
                    value={form[key] ?? ""}
                    onChange={(e) => handleChange(key, e.target.value)}
                    placeholder={`Nhập ${label.toLowerCase()}...`}
                  />
                ) : (
                  <Input
                    value={form[key] ?? ""}
                    onChange={(e) => handleChange(key, e.target.value)}
                    placeholder={`Nhập ${label.toLowerCase()}...`}
                  />
                )}
              </Field>
            ))}

            <div className="flex items-center justify-between gap-4 rounded-[14px] border border-white/8 bg-[#18233c] px-4 py-3">
              <p className="text-xs text-slate-400">
                {dirty ? "Có thay đổi chưa được lưu." : "Tất cả thay đổi đã được lưu."}
              </p>
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || !dirty}
              >
                {saveMutation.isPending ? "Đang lưu..." : "Lưu cấu hình"}
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Bảo hành — kiểm tra tự động
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Khi customer mở claim cho sản phẩm Veo 3 / Grok / ChatGPT, hệ thống tự đăng nhập tài khoản đã giao và kiểm tra gói + hạn dùng. Auto-check luôn bật.
        </p>
        <div className="mt-4 space-y-3">
          <Field
            label="Cooldown giữa 2 lần bảo hành (ngày)"
            description="Sau khi 1 đơn được bảo hành cấp acc thay thế, customer phải chờ N ngày mới được mở claim tiếp cho đơn đó. Đặt 0 để tắt cooldown."
          >
            <Input
              type="number"
              min={0}
              max={365}
              value={form["warranty.cooldownDays"] ?? "7"}
              onChange={(e) => handleChange("warranty.cooldownDays", e.target.value)}
            />
          </Field>
          <Field
            label="Số luồng check song song"
            description="Mỗi luồng dùng 1 Chrome instance (~300MB RAM). Hàng chờ quá ngưỡng × 4 sẽ báo 'hệ thống quá tải' với customer."
          >
            <Input
              type="number"
              min={1}
              max={20}
              value={form["warranty.check.concurrency"] ?? "3"}
              onChange={(e) => handleChange("warranty.check.concurrency", e.target.value)}
            />
          </Field>
          <Field
            label="Proxy cho tool check (mỗi proxy 1 dòng)"
            description={
              "Worker rotate round-robin theo từng account. Format: scheme://[user:pass@]host:port hoặc host:port[:user:pass]. " +
              "Để trống = check chạy raw IP server (Google/X dễ ban). Khuyến nghị ≥ 20 proxy residential nếu deploy production."
            }
          >
            <textarea
              rows={8}
              spellCheck={false}
              placeholder={"# Ví dụ:\nhttp://user:pass@1.2.3.4:8080\nsocks5://5.6.7.8:1080\n9.10.11.12:8080:user:pass"}
              value={form["warranty.check.proxies"] ?? ""}
              onChange={(e) => handleChange("warranty.check.proxies", e.target.value)}
              className="flex w-full rounded-[10px] border border-white/8 bg-[#18233c] px-3.5 py-2.5 font-mono text-xs text-slate-200 outline-none focus:border-white/20"
            />
          </Field>
        </div>
      </Card>

      <Card className="p-5">
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Cấu hình tùy chỉnh
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Các key/value tùy chỉnh không có trong danh sách trên sẽ hiển thị ở đây.
        </p>
        <div className="mt-4 space-y-2">
          {Object.entries(form)
            .filter(([k]) => !CONFIG_SCHEMA.find((s) => s.key === k) && !k.startsWith("warranty."))
            .map(([key, value]) => (
              <div key={key} className="flex items-center gap-3 rounded-[12px] border border-white/6 bg-[#18233c] px-4 py-2.5">
                <p className="min-w-0 flex-1 font-mono text-xs text-slate-400">{key}</p>
                <p className="text-xs text-slate-300 truncate max-w-[200px]">{value}</p>
              </div>
            ))}
          {Object.keys(form).filter((k) => !CONFIG_SCHEMA.find((s) => s.key === k) && !k.startsWith("warranty.")).length === 0 && (
            <p className="text-xs text-slate-500">Không có cấu hình tùy chỉnh.</p>
          )}
        </div>
      </Card>
    </div>
  );
}

