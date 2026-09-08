import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AxiosError } from "axios";
import { BellRing, CheckCircle2, Headphones, Image as ImageIcon, Loader2, Save, Settings2, ShieldCheck, SlidersHorizontal, Upload } from "lucide-react";

import { SectionHeading } from "@/components/dashboard/section-heading";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";

type ConfigField = {
  key: string;
  label: string;
  description?: string;
  type?: "text" | "textarea" | "select";
  options?: Array<{ value: string; label: string }>;
  rows?: number;
};

const GROUPS: Array<{
  id: string;
  title: string;
  description: string;
  icon: typeof Settings2;
  color: string;
  wide?: boolean;
  fields: ConfigField[];
}> = [
  {
    id: "general",
    title: "Thiết lập chung",
    description: "Thông tin nền tảng và quyền truy cập cơ bản.",
    icon: Settings2,
    color: "rgb(56,189,248)",
    fields: [
      { key: "platform_name", label: "Tên nền tảng", description: "Tên hiển thị trong dashboard và bot." },
      {
        key: "registration_open", label: "Cho phép đăng ký", type: "select",
        options: [{ value: "true", label: "Đang mở" }, { value: "false", label: "Đang khóa" }],
      },
      { key: "maintenance_message", label: "Thông báo bảo trì", description: "Để trống nếu hệ thống hoạt động bình thường.", type: "textarea", rows: 3 },
    ],
  },
  {
    id: "support",
    title: "Liên hệ & hỗ trợ",
    description: "Thông tin liên hệ hiển thị cho seller.",
    icon: Headphones,
    color: "rgb(167,139,250)",
    fields: [
      { key: "support_telegram", label: "Telegram hỗ trợ", description: "Username hoặc link Telegram. Ví dụ: @support" },
      { key: "support_zalo", label: "Zalo hỗ trợ", description: "Số điện thoại hoặc link Zalo." },
      { key: "pro_upgrade_contact", label: "Liên hệ nâng cấp PRO", description: "Thông tin liên hệ khi seller muốn nâng cấp." },
    ],
  },
  {
    id: "announcement",
    title: "Thông báo hệ thống",
    description: "Popup xuất hiện khi seller truy cập website.",
    icon: BellRing,
    color: "rgb(249,115,22)",
    wide: true,
    fields: [
      {
        key: "system_announcement_enabled", label: "Trạng thái", type: "select",
        options: [{ value: "false", label: "Đang tắt" }, { value: "true", label: "Đang bật" }],
      },
      { key: "system_announcement_effect", label: "Hiệu ứng", type: "select", options: [
        { value: "zoom", label: "Thu phóng" }, { value: "glow", label: "Phát sáng" },
        { value: "bounce", label: "Nảy nhẹ" }, { value: "confetti", label: "Confetti" },
        { value: "none", label: "Không hiệu ứng" },
      ] },
      { key: "system_announcement_title", label: "Tiêu đề" },
      { key: "system_announcement_image_url", label: "URL ảnh", description: "Ảnh HTTPS hiển thị phía trên popup." },
      { key: "system_announcement_message", label: "Nội dung", type: "textarea", rows: 5 },
    ],
  },
  {
    id: "warranty",
    title: "Bảo hành & kỹ thuật",
    description: "Thiết lập mặc định và hạ tầng auto-check.",
    icon: ShieldCheck,
    color: "rgb(52,211,153)",
    wide: true,
    fields: [
      { key: "default_warranty_note", label: "Ghi chú bảo hành mặc định", description: "Hiển thị khi tạo yêu cầu bảo hành mới.", type: "textarea", rows: 3 },
      {
        key: "warranty.check.proxies", label: "Proxy auto-check bảo hành",
        description: "Mỗi dòng một proxy. Để trống để chạy bằng IP máy chủ.", type: "textarea", rows: 5,
      },
    ],
  },
];

const KNOWN_KEYS = new Set(GROUPS.flatMap((group) => group.fields.map((field) => field.key)));
const controlClass = "w-full rounded-xl px-3.5 py-2.5 text-[13px] outline-none transition focus:border-orange-500/50";
const controlStyle = { background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx)" };

function getApiErrorMessage(error: unknown) {
  const response = error as AxiosError<{ message?: string | string[] }>;
  const message = response.response?.data?.message;
  if (Array.isArray(message)) return message.join(", ");
  if (typeof message === "string" && message.trim()) return message;
  return "Có lỗi xảy ra. Hãy thử lại.";
}

function ConfigControl({ field, value, onChange, onImageUpload, uploadingImage }: { field: ConfigField; value: string; onChange: (value: string) => void; onImageUpload?: (file: File) => void; uploadingImage?: boolean }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[12px] font-black" style={{ color: "var(--tx)" }}>{field.label}</span>
      {field.description && <span className="block text-[10px] leading-4" style={{ color: "var(--tx-f)" }}>{field.description}</span>}
      {field.type === "select" ? (
        <select className={controlClass} style={controlStyle} value={value || field.options?.[0]?.value || ""} onChange={(event) => onChange(event.target.value)}>
          {field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      ) : field.type === "textarea" ? (
        <textarea rows={field.rows || 3} className={`${controlClass} resize-y`} style={controlStyle} value={value} onChange={(event) => onChange(event.target.value)} placeholder={`Nhập ${field.label.toLowerCase()}...`} />
      ) : field.key === "system_announcement_image_url" ? (
        <div className="flex gap-2">
          <input className={controlClass} style={controlStyle} value={value} onChange={(event) => onChange(event.target.value)} placeholder="https://... hoặc tải ảnh lên" />
          <label className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-xl px-3.5 text-[11px] font-black text-white transition hover:bg-orange-600" style={{ background: "rgb(249,115,22)" }}>
            {uploadingImage ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {uploadingImage ? "Đang tải" : "Tải ảnh"}
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" disabled={uploadingImage}
              onChange={(event) => { const file = event.target.files?.[0]; if (file) onImageUpload?.(file); event.target.value = ""; }} />
          </label>
        </div>
      ) : (
        <input className={controlClass} style={controlStyle} value={value} onChange={(event) => onChange(event.target.value)} placeholder={`Nhập ${field.label.toLowerCase()}...`} />
      )}
    </label>
  );
}

export function AdminSystemConfigPage() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [form, setForm] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  const { data: configs, isLoading } = useQuery<Record<string, string>>({
    queryKey: ["admin", "system-config"],
    queryFn: () => api.get("/admin/system-config").then((response) => response.data),
  });

  useEffect(() => {
    if (configs) {
      setForm(configs);
      setDirty(false);
    }
  }, [configs]);

  const imageUploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append("file", file);
      return (await api.post<{ url: string }>("/system/announcement/image", body, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: ({ url }) => {
      change("system_announcement_image_url", url);
      showToast({ tone: "success", message: "Đã tải ảnh thông báo." });
    },
    onError: (error) => showToast({ tone: "error", message: getApiErrorMessage(error) }),
  });

  const saveMutation = useMutation({
    mutationFn: () => api.put("/admin/system-config", { configs: form }),
    onSuccess: async () => {
      showToast({ tone: "success", message: "Đã lưu cấu hình hệ thống." });
      setDirty(false);
      await queryClient.invalidateQueries({ queryKey: ["admin", "system-config"] });
    },
    onError: (error) => showToast({ tone: "error", message: getApiErrorMessage(error) }),
  });

  function change(key: string, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    setDirty(true);
  }

  const customConfigs = Object.entries(form).filter(([key]) => !KNOWN_KEYS.has(key));
  const announcementEnabled = form.system_announcement_enabled === "true";

  return (
    <div className="space-y-6 pb-20">
      <SectionHeading eyebrow="Quản trị hệ thống" title="Cài đặt hệ thống" description="Các thay đổi có hiệu lực ngay sau khi lưu." />

      {isLoading ? (
        <div className="rounded-2xl p-8 text-center text-sm" style={{ background: "var(--surface)", border: "1px solid var(--bd)", color: "var(--tx-m)" }}>Đang tải cấu hình...</div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {GROUPS.map((group) => {
            const Icon = group.icon;
            const isAnnouncement = group.id === "announcement";
            return (
              <section key={group.id} className={`overflow-hidden rounded-2xl ${group.wide ? "xl:col-span-2" : ""}`} style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
                <div className="flex items-start justify-between gap-4 px-5 py-4" style={{ borderBottom: "1px solid var(--bd)" }}>
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ color: group.color, background: `color-mix(in srgb, ${group.color} 12%, transparent)` }}><Icon className="h-4.5 w-4.5" /></div>
                    <div><h2 className="text-[14px] font-black" style={{ color: "var(--tx)" }}>{group.title}</h2><p className="mt-0.5 text-[10px]" style={{ color: "var(--tx-f)" }}>{group.description}</p></div>
                  </div>
                  {isAnnouncement && <span className="rounded-full px-2.5 py-1 text-[10px] font-black" style={{ color: announcementEnabled ? "rgb(52,211,153)" : "var(--tx-f)", background: announcementEnabled ? "rgba(52,211,153,.1)" : "var(--inp)" }}>{announcementEnabled ? "ĐANG BẬT" : "ĐANG TẮT"}</span>}
                </div>

                {isAnnouncement ? (
                  <div className="grid gap-6 p-5 lg:grid-cols-[1.1fr_.9fr]">
                    <div className="grid content-start gap-4 sm:grid-cols-2">
                      {group.fields.map((field) => <div key={field.key} className={field.key === "system_announcement_message" ? "sm:col-span-2" : ""}><ConfigControl field={field} value={form[field.key] || ""} onChange={(value) => change(field.key, value)} onImageUpload={(file) => imageUploadMutation.mutate(file)} uploadingImage={imageUploadMutation.isPending} /></div>)}
                    </div>
                    <div>
                      <p className="mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}><ImageIcon className="h-3 w-3" /> Xem trước popup</p>
                      <div className="overflow-hidden rounded-2xl" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
                        {form.system_announcement_image_url ? <img src={form.system_announcement_image_url} alt="" className="h-36 w-full object-cover" /> : <div className="flex h-28 items-center justify-center"><ImageIcon className="h-7 w-7" style={{ color: "var(--tx-f)" }} /></div>}
                        <div className="p-4"><BellRing className="mb-3 h-5 w-5 text-orange-500" /><h3 className="text-[15px] font-black" style={{ color: "var(--tx)" }}>{form.system_announcement_title || "Thông báo hệ thống"}</h3><p className="mt-2 whitespace-pre-wrap text-[11px] leading-5" style={{ color: "var(--tx-m)" }}>{form.system_announcement_message || "Nội dung thông báo sẽ hiển thị tại đây."}</p></div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className={`grid gap-4 p-5 ${group.wide ? "lg:grid-cols-2" : ""}`}>
                    {group.fields.map((field) => <ConfigControl key={field.key} field={field} value={form[field.key] || ""} onChange={(value) => change(field.key, value)} />)}
                  </div>
                )}
              </section>
            );
          })}

          {customConfigs.length > 0 && (
            <section className="rounded-2xl p-5 xl:col-span-2" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
              <div className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4" style={{ color: "var(--tx-f)" }} /><h2 className="text-[13px] font-black" style={{ color: "var(--tx)" }}>Cấu hình tùy chỉnh</h2></div>
              <div className="mt-4 grid gap-2 md:grid-cols-2">{customConfigs.map(([key, value]) => <div key={key} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}><code className="truncate text-[10px]" style={{ color: "var(--tx-f)" }}>{key}</code><span className="max-w-[45%] truncate text-[10px]" style={{ color: "var(--tx-m)" }}>{value}</span></div>)}</div>
            </section>
          )}
        </div>
      )}

      <div className="fixed bottom-4 right-4 z-20 flex items-center gap-4 rounded-2xl px-4 py-3 shadow-2xl xl:right-8" style={{ background: "color-mix(in srgb, var(--surface) 94%, transparent)", border: "1px solid var(--bd)", backdropFilter: "blur(16px)" }}>
        <div className="flex items-center gap-2 text-[11px] font-bold" style={{ color: dirty ? "rgb(249,115,22)" : "rgb(52,211,153)" }}>{dirty ? <SlidersHorizontal className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}{dirty ? "Có thay đổi chưa lưu" : "Đã lưu đầy đủ"}</div>
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !dirty}><Save className="mr-1.5 h-3.5 w-3.5" />{saveMutation.isPending ? "Đang lưu..." : "Lưu thay đổi"}</Button>
      </div>
    </div>
  );
}