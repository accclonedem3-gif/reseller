import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useLang } from "@/lib/lang";

const T = {
  vi: {
    title: "Thông báo bot",
    phImage: "Image URL (tùy chọn)",
    sending: "Đang queue...",
    send: "Gửi broadcast",
    stats: (n: number, s: number, f: number) => `Targets: ${n} • Sent: ${s} • Failed: ${f}`,
    defaultTitle: "Thông báo mới",
    defaultMsg: "Shop vừa cập nhật giá tốt cho một số sản phẩm hot.",
  },
  en: {
    title: "Bot broadcasts",
    phImage: "Image URL (optional)",
    sending: "Queuing...",
    send: "Send broadcast",
    stats: (n: number, s: number, f: number) => `Targets: ${n} • Sent: ${s} • Failed: ${f}`,
    defaultTitle: "New announcement",
    defaultMsg: "The shop just updated prices on some popular products.",
  },
  th: {
    title: "ประกาศบอท",
    phImage: "URL รูปภาพ (ไม่บังคับ)",
    sending: "กำลังเพิ่มคิว...",
    send: "ส่งประกาศ",
    stats: (n: number, s: number, f: number) => `เป้าหมาย: ${n} • ส่งแล้ว: ${s} • ล้มเหลว: ${f}`,
    defaultTitle: "ประกาศใหม่",
    defaultMsg: "ร้านค้าเพิ่งอัปเดตราคาสินค้ายอดนิยม",
  },
};

export function BroadcastsPage() {
  const { lang } = useLang();
  const t = T[lang];
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(t.defaultTitle);
  const [message, setMessage] = useState(t.defaultMsg);
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

  return (
    <div className="space-y-6">
      <h1 className="font-display text-4xl font-bold text-white">{t.title}</h1>
      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className="space-y-4">
          <Input value={title} onChange={(event) => setTitle(event.target.value)} />
          <Textarea value={message} onChange={(event) => setMessage(event.target.value)} />
          <Input value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder={t.phImage} />
          <Button className="w-full" onClick={() => createMutation.mutate()}>
            {createMutation.isPending ? t.sending : t.send}
          </Button>
        </Card>
        <Card>
          <div className="space-y-3">
            {(broadcastsQuery.data || []).map((item: any) => (
              <div key={item.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-white">{item.title || "Broadcast"}</p>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{item.status}</p>
                </div>
                <p className="mt-3 text-sm text-slate-300">{item.message}</p>
                <p className="mt-3 text-xs text-slate-500">
                  {t.stats(item.totalTargets, item.sentCount, item.failedCount)} • {formatDate(item.createdAt)}
                </p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
