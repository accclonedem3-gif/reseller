import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, ImagePlus, Radio, Send } from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { Field } from "@/components/dashboard/field";
import { SectionHeading } from "@/components/dashboard/section-heading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CardHeader } from "@/components/ui/card-header";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { formatDate, formatStatusLabel } from "@/lib/format";
import { useLang } from "@/lib/lang";

const T = {
  vi: {
    eyebrow: "Trung tâm broadcast",
    title: "Thông báo bot",
    desc: "Gửi thông báo đồng loạt đến tập khách đã từng chat với bot.",
    statCampaign: "Chiến dịch",
    statDone: "Hoàn tất",
    statQueue: "Đang queue",
    composeTitle: "Soạn broadcast",
    fieldTitle: "Tiêu đề",
    phTitle: "Ví dụ: Flash sale hôm nay",
    fieldContent: "Nội dung",
    contentHint: "Required",
    contentDesc: "Viết ngắn gọn, rõ CTA và dễ đọc trên giao diện Telegram.",
    phContent: "Nội dung gửi đến khách hàng",
    fieldImage: "Ảnh đính kèm",
    imageHint: "Optional",
    imageDesc: "MVP hiện lưu URL ảnh thay vì upload trực tiếp.",
    phImage: "https://...",
    sendType: "Kiểu gửi",
    sendTypeVal: "Queue nền",
    imageLabel: "Ảnh",
    hasImage: "Có đính kèm",
    noImage: "Chưa có",
    sending: "Đang xếp hàng…",
    sendBtn: "Đưa broadcast vào queue",
    historyTitle: "Lịch sử chiến dịch",
    campaignCount: (n: number) => `${n} chiến dịch`,
    emptyTitle: "Chưa có broadcast nào",
    emptyDesc: "Khi seller gửi chiến dịch đầu tiên, trạng thái queue và kết quả gửi sẽ xuất hiện ở đây.",
    defaultNotifTitle: "Thông báo",
    statRecipients: "Người nhận",
    statSent: "Đã gửi",
    statFailed: "Lỗi",
  },
  en: {
    eyebrow: "Broadcast center",
    title: "Bot notifications",
    desc: "Send bulk notifications to all customers who have chatted with the bot.",
    statCampaign: "Campaigns",
    statDone: "Completed",
    statQueue: "In queue",
    composeTitle: "Compose broadcast",
    fieldTitle: "Title",
    phTitle: "e.g. Flash sale today",
    fieldContent: "Content",
    contentHint: "Required",
    contentDesc: "Keep it concise, with a clear CTA and easy to read in Telegram.",
    phContent: "Message to send to customers",
    fieldImage: "Attached image",
    imageHint: "Optional",
    imageDesc: "MVP currently stores image URLs instead of direct uploads.",
    phImage: "https://...",
    sendType: "Send type",
    sendTypeVal: "Background queue",
    imageLabel: "Image",
    hasImage: "Attached",
    noImage: "None",
    sending: "Queuing…",
    sendBtn: "Add broadcast to queue",
    historyTitle: "Campaign history",
    campaignCount: (n: number) => `${n} campaigns`,
    emptyTitle: "No broadcasts yet",
    emptyDesc: "When the seller sends their first campaign, queue status and send results will appear here.",
    defaultNotifTitle: "Notification",
    statRecipients: "Recipients",
    statSent: "Sent",
    statFailed: "Failed",
  },
  th: {
    eyebrow: "ศูนย์กระจายข่าว",
    title: "การแจ้งเตือนบอท",
    desc: "ส่งการแจ้งเตือนจำนวนมากถึงลูกค้าทุกคนที่เคยแชทกับบอท",
    statCampaign: "แคมเปญ",
    statDone: "เสร็จสิ้น",
    statQueue: "ในคิว",
    composeTitle: "เขียนบรอดแคสต์",
    fieldTitle: "ชื่อ",
    phTitle: "เช่น แฟลชเซลวันนี้",
    fieldContent: "เนื้อหา",
    contentHint: "Required",
    contentDesc: "เขียนให้กระชับ มี CTA ชัดเจน และอ่านง่ายในอินเทอร์เฟซ Telegram",
    phContent: "ข้อความที่จะส่งถึงลูกค้า",
    fieldImage: "รูปแนบ",
    imageHint: "Optional",
    imageDesc: "MVP จัดเก็บ URL รูปภาพแทนการอัปโหลดโดยตรงในขณะนี้",
    phImage: "https://...",
    sendType: "ประเภทการส่ง",
    sendTypeVal: "คิวพื้นหลัง",
    imageLabel: "รูปภาพ",
    hasImage: "แนบแล้ว",
    noImage: "ไม่มี",
    sending: "กำลังเข้าคิว…",
    sendBtn: "เพิ่มบรอดแคสต์ในคิว",
    historyTitle: "ประวัติแคมเปญ",
    campaignCount: (n: number) => `${n} แคมเปญ`,
    emptyTitle: "ยังไม่มีบรอดแคสต์",
    emptyDesc: "เมื่อผู้ขายส่งแคมเปญแรก สถานะคิวและผลการส่งจะปรากฏที่นี่",
    defaultNotifTitle: "การแจ้งเตือน",
    statRecipients: "ผู้รับ",
    statSent: "ส่งแล้ว",
    statFailed: "ล้มเหลว",
  },
};

export function BroadcastsPage() {
  const { lang } = useLang();
  const t = T[lang];

  const queryClient = useQueryClient();
  const [title, setTitle] = useState(lang === "en" ? "New notification" : lang === "th" ? "การแจ้งเตือนใหม่" : "Thông báo mới");
  const [message, setMessage] = useState(
    lang === "en"
      ? "The shop has just updated great prices for some featured products today."
      : lang === "th"
        ? "ร้านค้าเพิ่งอัปเดตราคาที่ดีสำหรับสินค้าเด่นบางรายการในวันนี้"
        : "Shop vừa cập nhật giá tốt cho một số sản phẩm nổi bật trong hôm nay.",
  );
  const [imageUrl, setImageUrl] = useState("");

  const broadcastsQuery = useQuery({
    queryKey: ["broadcasts"],
    queryFn: async () => (await api.get("/broadcasts")).data,
  });

  const createMutation = useMutation({
    mutationFn: async () =>
      api.post("/broadcasts", { title, message, imageUrl }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["broadcasts"] });
    },
  });

  const broadcasts = broadcastsQuery.data || [];
  const completedCount = broadcasts.filter((b: any) => b.status === "completed").length;

  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow={t.eyebrow}
        title={t.title}
        description={t.desc}
        gradient="sky"
        stats={[
          { icon: Radio, label: t.statCampaign, value: broadcasts.length, iconCls: "text-sky-400", bgCls: "bg-sky-500/15" },
          { icon: Bell, label: t.statDone, value: completedCount, iconCls: "text-emerald-400", bgCls: "bg-emerald-500/15" },
          { icon: Send, label: t.statQueue, value: broadcasts.filter((b: any) => b.status === "queued" || b.status === "processing").length, iconCls: "text-amber-400", bgCls: "bg-amber-500/15" },
        ]}
      />

      <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        {/* Compose card */}
        <Card>
          <CardHeader
            icon={Send}
            title={t.composeTitle}
            iconCls="text-emerald-400"
            iconBg="bg-emerald-500/10"
          />

          <div className="space-y-4">
            <Field label={t.fieldTitle} hint="Title">
              <input
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand/40"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t.phTitle}
              />
            </Field>

            <Field
              label={t.fieldContent}
              hint={t.contentHint}
              description={t.contentDesc}
            >
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t.phContent}
              />
            </Field>

            <Field
              label={t.fieldImage}
              hint={t.imageHint}
              description={t.imageDesc}
            >
              <Input
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder={t.phImage}
              />
            </Field>

            {/* Queue info chips */}
            <div className="grid grid-cols-2 gap-2.5">
              <div
                className="rounded-[14px] px-3.5 py-3"
                style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}
              >
                <div className="flex items-center gap-2">
                  <Bell className="h-3.5 w-3.5 text-sky-400" />
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    {t.sendType}
                  </p>
                </div>
                <p className="mt-1.5 text-sm font-semibold" style={{ color: "var(--tx)" }}>
                  {t.sendTypeVal}
                </p>
              </div>
              <div
                className="rounded-[14px] px-3.5 py-3"
                style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}
              >
                <div className="flex items-center gap-2">
                  <ImagePlus className="h-3.5 w-3.5 text-violet-400" />
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    {t.imageLabel}
                  </p>
                </div>
                <p className="mt-1.5 text-sm font-semibold" style={{ color: "var(--tx)" }}>
                  {imageUrl ? t.hasImage : t.noImage}
                </p>
              </div>
            </div>

            <Button
              className="w-full"
              disabled={createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? t.sending : t.sendBtn}
            </Button>
          </div>
        </Card>

        {/* History card */}
        <Card>
          <CardHeader
            icon={Radio}
            title={t.historyTitle}
            iconCls="text-sky-400"
            iconBg="bg-sky-500/10"
            right={
              <span
                className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-m)" }}
              >
                {t.campaignCount(broadcasts.length)}
              </span>
            }
          />

          {broadcasts.length === 0 ? (
            <EmptyState
              title={t.emptyTitle}
              description={t.emptyDesc}
            />
          ) : (
            <div className="space-y-2.5">
              {broadcasts.map((item: any) => (
                <div
                  key={item.id}
                  className="rounded-[16px] px-4 py-4"
                  style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold" style={{ color: "var(--tx)" }}>
                        {item.title || t.defaultNotifTitle}
                      </p>
                      <p className="mt-1 text-[13px] leading-5 text-slate-500 line-clamp-2">
                        {item.message}
                      </p>
                    </div>
                    <Badge tone={item.status === "completed" ? "success" : "neutral"}>
                      {formatStatusLabel(item.status)}
                    </Badge>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {[
                      { label: t.statRecipients, value: item.totalTargets, cls: "" },
                      { label: t.statSent, value: item.sentCount, cls: "text-emerald-400" },
                      { label: t.statFailed, value: item.failedCount, cls: "text-rose-400" },
                    ].map((stat) => (
                      <div
                        key={stat.label}
                        className="rounded-[10px] px-3 py-2.5"
                        style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}
                      >
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                          {stat.label}
                        </p>
                        <p
                          className={`mt-1 text-base font-bold tabular-nums ${stat.cls}`}
                          style={!stat.cls ? { color: "var(--tx)" } : undefined}
                        >
                          {stat.value}
                        </p>
                      </div>
                    ))}
                  </div>

                  <p className="mt-2.5 text-xs text-slate-500">{formatDate(item.createdAt)}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}
