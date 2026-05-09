import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { formatDate, formatStatusLabel } from "@/lib/format";
import { useLang } from "@/lib/lang";

const T = {
  vi: {
    eyebrow: "Thiết lập và vận hành",
    title: "Cấu hình bot",
    phShopName: "Tên shop",
    phTagline: "Câu giới thiệu ngắn",
    phBotToken: (mask: string) => `BOT_TOKEN (${mask})`,
    phApiUrl: "Địa chỉ API nguồn",
    phBuyerKey: (mask: string) => `Khóa buyer của nguồn (${mask})`,
    phSupportTg: "Telegram hỗ trợ",
    phSupportZalo: "Zalo hỗ trợ",
    phLogoUrl: "Đường dẫn logo",
    saving: "Đang lưu...",
    save: "Lưu cấu hình",
    statusTitle: "Tình trạng kết nối",
    tgRow: (status: string, username: string) => `Telegram: ${status} | @${username}`,
    sourceRow: (status: string) => `Nguồn cấp: ${status}`,
    lastSync: (date: string) => `Lần đồng bộ gần nhất: ${date}`,
    verifyTg: "Kiểm tra Telegram",
    verifySource: "Kiểm tra nguồn",
    syncProducts: "Đồng bộ sản phẩm",
    testTitle: "Khu test bot",
    testDesc: "Dùng để test local khi shop đang chạy bot mô phỏng.",
    viewProducts: "Xem sản phẩm",
    support: "Hỗ trợ",
    noBot: "chưa có",
  },
  en: {
    eyebrow: "Setup & operations",
    title: "Bot configuration",
    phShopName: "Shop name",
    phTagline: "Short tagline",
    phBotToken: (mask: string) => `BOT_TOKEN (${mask})`,
    phApiUrl: "Source API URL",
    phBuyerKey: (mask: string) => `Source buyer key (${mask})`,
    phSupportTg: "Support Telegram",
    phSupportZalo: "Support Zalo",
    phLogoUrl: "Logo URL",
    saving: "Saving...",
    save: "Save configuration",
    statusTitle: "Connection status",
    tgRow: (status: string, username: string) => `Telegram: ${status} | @${username}`,
    sourceRow: (status: string) => `Source: ${status}`,
    lastSync: (date: string) => `Last sync: ${date}`,
    verifyTg: "Verify Telegram",
    verifySource: "Verify source",
    syncProducts: "Sync products",
    testTitle: "Bot test area",
    testDesc: "Use for local testing when the shop is running a simulated bot.",
    viewProducts: "View products",
    support: "Support",
    noBot: "not set",
  },
  th: {
    eyebrow: "ตั้งค่าและดำเนินการ",
    title: "ตั้งค่าบอท",
    phShopName: "ชื่อร้านค้า",
    phTagline: "สโลแกนสั้น",
    phBotToken: (mask: string) => `BOT_TOKEN (${mask})`,
    phApiUrl: "URL API แหล่งสินค้า",
    phBuyerKey: (mask: string) => `คีย์ผู้ซื้อแหล่งสินค้า (${mask})`,
    phSupportTg: "Telegram สนับสนุน",
    phSupportZalo: "Zalo สนับสนุน",
    phLogoUrl: "URL โลโก้",
    saving: "กำลังบันทึก...",
    save: "บันทึกการตั้งค่า",
    statusTitle: "สถานะการเชื่อมต่อ",
    tgRow: (status: string, username: string) => `Telegram: ${status} | @${username}`,
    sourceRow: (status: string) => `แหล่งสินค้า: ${status}`,
    lastSync: (date: string) => `ซิงค์ล่าสุด: ${date}`,
    verifyTg: "ตรวจสอบ Telegram",
    verifySource: "ตรวจสอบแหล่งสินค้า",
    syncProducts: "ซิงค์สินค้า",
    testTitle: "พื้นที่ทดสอบบอท",
    testDesc: "ใช้สำหรับทดสอบในเครื่องเมื่อร้านค้าใช้บอทจำลอง",
    viewProducts: "ดูสินค้า",
    support: "สนับสนุน",
    noBot: "ยังไม่มี",
  },
};

export function BotConfigPage() {
  const { lang } = useLang();
  const t = T[lang];
  const queryClient = useQueryClient();
  const configQuery = useQuery({
    queryKey: ["bot-config"],
    queryFn: async () => (await api.get("/bot-config")).data,
  });
  const [form, setForm] = useState({
    shopName: "",
    shopTagline: "",
    botToken: "",
    providerBaseUrl: "https://canboso.com",
    providerBuyerKey: "",
    supportTelegram: "",
    supportZalo: "",
    logoUrl: "",
  });
  const [simulationOutput, setSimulationOutput] = useState<string>("");

  useEffect(() => {
    if (!configQuery.data) {
      return;
    }

    setForm({
      shopName: configQuery.data.shopName || "",
      shopTagline: configQuery.data.shopTagline || "",
      botToken: "",
      providerBaseUrl: configQuery.data.providerBaseUrl || "https://canboso.com",
      providerBuyerKey: "",
      supportTelegram: configQuery.data.supportTelegram || "",
      supportZalo: configQuery.data.supportZalo || "",
      logoUrl: configQuery.data.logoUrl || "",
    });
  }, [configQuery.data?.shopId]);

  const saveMutation = useMutation({
    mutationFn: async () => api.put("/bot-config", form),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["bot-config"] });
      await queryClient.invalidateQueries({ queryKey: ["shop"] });
    },
  });

  const verifyTelegramMutation = useMutation({
    mutationFn: async () => api.post("/bot-config/verify-telegram"),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["bot-config"] });
    },
  });

  const verifyProviderMutation = useMutation({
    mutationFn: async () => api.post("/bot-config/verify-provider"),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["bot-config"] });
    },
  });

  const syncProductsMutation = useMutation({
    mutationFn: async () => api.post("/bot-config/sync-products"),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["bot-config"] }),
        queryClient.invalidateQueries({ queryKey: ["products"] }),
      ]);
    },
  });

  const simulateMutation = useMutation({
    mutationFn: async (payload: { text?: string; callbackData?: string }) =>
      api.post(`/dev/telegram/${configQuery.data.shopId}/simulate`, payload),
    onSuccess: (response) => {
      setSimulationOutput(JSON.stringify(response.data.actions, null, 2));
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-slate-500">{t.eyebrow}</p>
        <h1 className="mt-3 font-display text-4xl font-bold text-white">{t.title}</h1>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_0.9fr]">
        <Card className="space-y-4">
          <Input
            value={form.shopName}
            onChange={(event) => setForm((current) => ({ ...current, shopName: event.target.value }))}
            placeholder={t.phShopName}
          />
          <Input
            value={form.shopTagline}
            onChange={(event) =>
              setForm((current) => ({ ...current, shopTagline: event.target.value }))
            }
            placeholder={t.phTagline}
          />
          <Input
            value={form.botToken}
            onChange={(event) => setForm((current) => ({ ...current, botToken: event.target.value }))}
            placeholder={t.phBotToken(configQuery.data?.botTokenMasked || t.noBot)}
          />
          <Input
            value={form.providerBaseUrl}
            onChange={(event) =>
              setForm((current) => ({ ...current, providerBaseUrl: event.target.value }))
            }
            placeholder={t.phApiUrl}
          />
          <Input
            value={form.providerBuyerKey}
            onChange={(event) =>
              setForm((current) => ({ ...current, providerBuyerKey: event.target.value }))
            }
            placeholder={t.phBuyerKey(configQuery.data?.providerBuyerKeyMasked || t.noBot)}
          />
          <Input
            value={form.supportTelegram}
            onChange={(event) =>
              setForm((current) => ({ ...current, supportTelegram: event.target.value }))
            }
            placeholder={t.phSupportTg}
          />
          <Input
            value={form.supportZalo}
            onChange={(event) =>
              setForm((current) => ({ ...current, supportZalo: event.target.value }))
            }
            placeholder={t.phSupportZalo}
          />
          <Input
            value={form.logoUrl}
            onChange={(event) => setForm((current) => ({ ...current, logoUrl: event.target.value }))}
            placeholder={t.phLogoUrl}
          />
          <Button className="w-full" onClick={() => saveMutation.mutate()}>
            {saveMutation.isPending ? t.saving : t.save}
          </Button>
        </Card>

        <div className="space-y-6">
          <Card className="space-y-4">
            <h2 className="font-display text-2xl font-bold text-white">{t.statusTitle}</h2>
            <div className="grid gap-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
                {t.tgRow(formatStatusLabel(configQuery.data?.telegramWebhookStatus), configQuery.data?.telegramBotUsername || t.noBot)}
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
                {t.sourceRow(formatStatusLabel(configQuery.data?.providerConnectionStatus))}
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
                {t.lastSync(formatDate(configQuery.data?.lastCatalogSyncAt))}
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <Button onClick={() => verifyTelegramMutation.mutate()}>
                {t.verifyTg}
              </Button>
              <Button onClick={() => verifyProviderMutation.mutate()}>
                {t.verifySource}
              </Button>
              <Button onClick={() => syncProductsMutation.mutate()}>{t.syncProducts}</Button>
            </div>
          </Card>

          <Card className="space-y-4">
            <h2 className="font-display text-2xl font-bold text-white">{t.testTitle}</h2>
            <p className="text-sm text-slate-400">{t.testDesc}</p>
            <div className="grid gap-3 md:grid-cols-3">
              <Button onClick={() => simulateMutation.mutate({ text: "/start" })}>/start</Button>
              <Button onClick={() => simulateMutation.mutate({ callbackData: "home:products" })}>
                {t.viewProducts}
              </Button>
              <Button onClick={() => simulateMutation.mutate({ callbackData: "home:support" })}>
                {t.support}
              </Button>
            </div>
            <Textarea value={simulationOutput} readOnly />
          </Card>
        </div>
      </div>
    </div>
  );
}
