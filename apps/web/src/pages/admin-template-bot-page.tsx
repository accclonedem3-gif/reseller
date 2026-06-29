import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, Save, Trash2, Upload, X } from "lucide-react";

import { useToast } from "@/components/ui/toast";
import { InvoiceTemplateEditor, type InvoiceTemplate } from "@/components/dashboard/invoice-template-editor";
import { RestockTemplateEditor, type RestockTemplate } from "@/components/dashboard/restock-template-editor";
import { UsageInstructionsTemplateEditor, type UsageInstructionsTemplate, DEFAULT_USAGE_INSTRUCTIONS } from "@/components/dashboard/usage-instructions-template-editor";
import { ButtonsEditor, type ButtonsConfig } from "@/components/dashboard/buttons-editor";
import { ProductFamilyManager } from "@/components/dashboard/product-family-manager";
import { api } from "@/lib/api";
import { useProductFamilyOptions } from "@/hooks/use-product-families";

type TemplateResp = {
  shopId: string;
  shopName: string;
  botConfig: {
    id: string;
    telegramBotUsername: string | null;
    isGlobalDefault: boolean;
    customization: Record<string, any>;
  } | null;
};

type ProductDefault = {
  icon?: string | null;
  customEmojiId?: string | null;
  description?: string | null;
  media?: { type?: string; url?: string; caption?: string } | null;
};

const FAMILY_OPTIONS = [
  { value: "CHATGPT", label: "ChatGPT" },
  { value: "CLAUDE", label: "Claude" },
  { value: "GEMINI", label: "Gemini" },
  { value: "GROK", label: "Grok" },
  { value: "PERPLEXITY", label: "Perplexity" },
  { value: "VEO3", label: "Veo 3" },
  { value: "KLING", label: "Kling AI" },
  { value: "HIGGSFIELD", label: "Higgsfield" },
  { value: "CANVA", label: "Canva" },
  { value: "CAPCUT", label: "CapCut" },
  { value: "ADOBE", label: "Adobe" },
  { value: "SUNO", label: "Suno" },
  { value: "ELEVENLABS", label: "ElevenLabs" },
  { value: "HEYGEN", label: "HeyGen" },
  { value: "GMAIL", label: "Gmail" },
  { value: "YOUTUBE", label: "YouTube" },
  { value: "TIKTOK", label: "TikTok" },
  { value: "ZOOM", label: "Zoom" },
  { value: "DUOLINGO", label: "Duolingo" },
  { value: "HMA", label: "HMA" },
  { value: "VPN", label: "VPN" },
  { value: "OTHER", label: "Khác" },
];

function familyLabel(value: string): string {
  return FAMILY_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

function getErrMsg(err: unknown, fallback: string) {
  if (err && typeof err === "object" && "response" in err) {
    const msg = (err as any).response?.data?.message;
    if (typeof msg === "string") return msg;
    if (Array.isArray(msg)) return msg.join(", ");
  }
  if (err instanceof Error) return err.message;
  return fallback;
}

export function AdminTemplateBotPage() {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const familyOptions = useProductFamilyOptions();

  const tplQuery = useQuery<TemplateResp>({
    queryKey: ["admin-template"],
    queryFn: async () => (await api.get("/admin-template")).data,
    retry: false,
  });

  const bootstrapMutation = useMutation({
    mutationFn: async () => (await api.post("/admin-template/bootstrap")).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-template"] });
      showToast({ tone: "success", message: "Đã khởi tạo shop admin template." });
    },
    onError: (err) => showToast({ tone: "error", message: getErrMsg(err, "Không khởi tạo được.") }),
  });

  // Bot token state
  const [botToken, setBotToken] = useState("");

  const setBotTokenMutation = useMutation({
    mutationFn: async () => (await api.put("/admin-template/bot-token", { token: botToken.trim() })).data,
    onSuccess: (data: any) => {
      void queryClient.invalidateQueries({ queryKey: ["admin-template"] });
      setBotToken("");
      showToast({ tone: "success", message: data?.botUsername ? `Đã set bot @${data.botUsername}` : "Đã cập nhật token." });
    },
    onError: (err) => showToast({ tone: "error", message: getErrMsg(err, "Không set được token.") }),
  });

  // Customization JSON editor state
  const [customJson, setCustomJson] = useState<string>("{}");
  const [jsonError, setJsonError] = useState<string | null>(null);

  useEffect(() => {
    if (tplQuery.data?.botConfig) {
      setCustomJson(JSON.stringify(tplQuery.data.botConfig.customization ?? {}, null, 2));
    }
  }, [tplQuery.data?.botConfig?.customization]);

  const updateMutation = useMutation({
    mutationFn: async (parsed: any) => api.put("/admin-template/customization", { customization: parsed }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-template"] });
      showToast({ tone: "success", message: "Đã lưu customization." });
    },
    onError: (err) => showToast({ tone: "error", message: getErrMsg(err, "Không lưu được.") }),
  });

  function handleSaveJson() {
    try {
      const parsed = JSON.parse(customJson);
      setJsonError(null);
      updateMutation.mutate(parsed);
    } catch (e: any) {
      setJsonError(e.message || "JSON không hợp lệ");
    }
  }

  // Product defaults state — by family enum
  const productDefaults: Record<string, ProductDefault> =
    (tplQuery.data?.botConfig?.customization?.productDefaultsByFamily as Record<string, ProductDefault>) ?? {};
  const productFamilies = Object.keys(productDefaults).sort();

  const [editingFamily, setEditingFamily] = useState<string | null>(null);
  const [pdFamily, setPdFamily] = useState<string>("CHATGPT");
  const [pdIcon, setPdIcon] = useState("");
  const [pdEmojiId, setPdEmojiId] = useState("");
  const [pdDesc, setPdDesc] = useState("");
  const [pdMediaType, setPdMediaType] = useState<"photo" | "video" | "animation" | "none">("none");
  const [pdMediaUrl, setPdMediaUrl] = useState("");
  const [pdMediaCaption, setPdMediaCaption] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function handleFileUpload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/admin-template/upload-media", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setPdMediaUrl(data.url);
      setPdMediaType(data.type);
      showToast({ tone: "success", message: "Đã upload media." });
    } catch (err) {
      showToast({ tone: "error", message: getErrMsg(err, "Upload thất bại.") });
    } finally {
      setUploading(false);
    }
  }

  function resetPdForm() {
    setEditingFamily(null);
    setPdFamily("CHATGPT");
    setPdIcon("");
    setPdEmojiId("");
    setPdDesc("");
    setPdMediaType("none");
    setPdMediaUrl("");
    setPdMediaCaption("");
    setShowForm(false);
  }

  function openEdit(family: string) {
    const data = productDefaults[family] || {};
    setEditingFamily(family);
    setPdFamily(family);
    setPdIcon(data.icon || "");
    setPdEmojiId(data.customEmojiId || "");
    setPdDesc(data.description || "");
    setPdMediaType((data.media?.type as any) || "none");
    setPdMediaUrl(data.media?.url || "");
    setPdMediaCaption(data.media?.caption || "");
    setShowForm(true);
  }

  const setProductDefault = useMutation({
    mutationFn: async () =>
      api.post("/admin-template/product-defaults", {
        family: pdFamily,
        icon: pdIcon.trim() || undefined,
        customEmojiId: pdEmojiId.trim() || undefined,
        description: pdDesc.trim() || undefined,
        media:
          pdMediaType === "none"
            ? undefined
            : { type: pdMediaType, url: pdMediaUrl.trim() || undefined, caption: pdMediaCaption.trim() || undefined },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-template"] });
      resetPdForm();
      showToast({ tone: "success", message: editingFamily ? "Đã cập nhật." : "Đã thêm mặc định." });
    },
    onError: (err) => showToast({ tone: "error", message: getErrMsg(err, "Không lưu được.") }),
  });

  const removeProductDefault = useMutation({
    mutationFn: async (family: string) =>
      api.delete("/admin-template/product-defaults", { data: { family } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-template"] });
      showToast({ tone: "success", message: "Đã xóa." });
    },
    onError: (err) => showToast({ tone: "error", message: getErrMsg(err, "Không xóa được.") }),
  });

  const backfillMutation = useMutation({
    mutationFn: async (force?: boolean) =>
      (await api.post("/admin-template/backfill-icons", { force: force === true })).data,
    onSuccess: (data: any) => {
      const fdetect = data.familyDetected ?? 0;
      const detectMsg = fdetect > 0 ? ` · Auto-detect family: ${fdetect}` : "";
      const modeMsg = data.mode === "force" ? " (force overwrite)" : "";
      showToast({ tone: "success", message: `Quét ${data.scanned}, cập nhật ${data.updated}${detectMsg}${modeMsg}.` });
    },
    onError: (err) => showToast({ tone: "error", message: getErrMsg(err, "Backfill thất bại.") }),
  });

  const invoiceQuery = useQuery<{ defaults: InvoiceTemplate; template: InvoiceTemplate; raw: InvoiceTemplate | null }>({
    queryKey: ["admin-template", "invoice"],
    queryFn: async () => (await api.get("/admin-template/invoice-template")).data,
    retry: false,
    enabled: !!tplQuery.data?.botConfig,
  });

  const [invoiceDraft, setInvoiceDraft] = useState<InvoiceTemplate | null>(null);
  useEffect(() => {
    if (invoiceQuery.data?.template) {
      setInvoiceDraft(invoiceQuery.data.template);
    }
  }, [invoiceQuery.data?.template]);

  const saveInvoiceMutation = useMutation({
    mutationFn: async (tpl: InvoiceTemplate) =>
      (await api.put("/admin-template/invoice-template", { template: tpl })).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-template", "invoice"] });
      showToast({ tone: "success", message: "Đã lưu mẫu hóa đơn." });
    },
    onError: (err) => showToast({ tone: "error", message: getErrMsg(err, "Không lưu được mẫu hóa đơn.") }),
  });

  const resetInvoiceMutation = useMutation({
    mutationFn: async () =>
      (await api.put("/admin-template/invoice-template", { template: null })).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-template", "invoice"] });
      showToast({ tone: "success", message: "Đã đặt lại mẫu hóa đơn về mặc định." });
    },
    onError: (err) => showToast({ tone: "error", message: getErrMsg(err, "Không đặt lại được.") }),
  });

  const testInvoiceMutation = useMutation({
    mutationFn: async (mode: "small" | "large") => {
      const LS_KEY = "admin_invoice_test_chat_id";
      let chatId = localStorage.getItem(LS_KEY) || "";
      if (!chatId) {
        const input = window.prompt(
          "Nhập Telegram User ID / Chat ID để nhận tin test\n(lấy từ @userinfobot — vd: 5513106881)\nLưu lại cho lần sau:",
          "",
        );
        if (!input || !input.trim()) {
          throw new Error("Đã huỷ — chưa nhập chat ID.");
        }
        chatId = input.trim();
        localStorage.setItem(LS_KEY, chatId);
      }
      return (await api.post("/admin-template/invoice-template/test", { mode, telegramChatId: chatId })).data;
    },
    onSuccess: (data: any) => {
      showToast({ tone: "success", message: `Đã gửi sample đến chat ${data?.sentTo || "admin"}. Mở Telegram xem nha.` });
    },
    onError: (err) => showToast({ tone: "error", message: getErrMsg(err, "Gửi test thất bại.") }),
  });

  const restockQuery = useQuery<{ defaults: RestockTemplate; template: RestockTemplate; raw: RestockTemplate | null }>({
    queryKey: ["admin-template", "restock"],
    queryFn: async () => (await api.get("/admin-template/restock-template")).data,
    retry: false,
    enabled: !!tplQuery.data?.botConfig,
  });

  const [restockDraft, setRestockDraft] = useState<RestockTemplate | null>(null);
  useEffect(() => {
    if (restockQuery.data?.template) {
      setRestockDraft(restockQuery.data.template);
    }
  }, [restockQuery.data?.template]);

  const saveRestockMutation = useMutation({
    mutationFn: async (tpl: RestockTemplate) =>
      (await api.put("/admin-template/restock-template", { template: tpl })).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-template", "restock"] });
      showToast({ tone: "success", message: "Đã lưu mẫu thông báo nhập kho." });
    },
    onError: (err) => showToast({ tone: "error", message: getErrMsg(err, "Không lưu được mẫu nhập kho.") }),
  });

  const resetRestockMutation = useMutation({
    mutationFn: async () =>
      (await api.put("/admin-template/restock-template", { template: null })).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-template", "restock"] });
      showToast({ tone: "success", message: "Đã đặt lại mẫu nhập kho về mặc định." });
    },
    onError: (err) => showToast({ tone: "error", message: getErrMsg(err, "Không đặt lại được.") }),
  });

  const testRestockMutation = useMutation({
    mutationFn: async () => {
      const LS_KEY = "admin_invoice_test_chat_id";
      let chatId = localStorage.getItem(LS_KEY) || "";
      if (!chatId) {
        const input = window.prompt(
          "Nhập Telegram User ID / Chat ID để nhận tin test\n(lấy từ @userinfobot — vd: 5513106881)\nLưu lại cho lần sau:",
          "",
        );
        if (!input || !input.trim()) {
          throw new Error("Đã huỷ — chưa nhập chat ID.");
        }
        chatId = input.trim();
        localStorage.setItem(LS_KEY, chatId);
      }
      return (await api.post("/admin-template/restock-template/test", { telegramChatId: chatId })).data;
    },
    onSuccess: (data: any) => {
      showToast({ tone: "success", message: `Đã gửi thử thông báo nhập kho đến chat ${data?.sentTo || "admin"}.` });
    },
    onError: (err) => showToast({ tone: "error", message: getErrMsg(err, "Gửi thử thất bại.") }),
  });

  const usageInstrQuery = useQuery<{ defaults: UsageInstructionsTemplate; template: UsageInstructionsTemplate; raw: UsageInstructionsTemplate | null }>({
    queryKey: ["admin-template", "usage-instructions"],
    queryFn: async () => (await api.get("/admin-template/usage-instructions-template")).data,
    retry: false,
    enabled: !!tplQuery.data?.botConfig,
  });

  const [usageInstrDraft, setUsageInstrDraft] = useState<UsageInstructionsTemplate | null>(null);
  useEffect(() => {
    if (usageInstrQuery.data?.template) {
      setUsageInstrDraft(usageInstrQuery.data.template);
    }
  }, [usageInstrQuery.data?.template]);

  const saveUsageInstrMutation = useMutation({
    mutationFn: async (tpl: UsageInstructionsTemplate) =>
      (await api.put("/admin-template/usage-instructions-template", { template: tpl })).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-template", "usage-instructions"] });
      showToast({ tone: "success", message: "Đã lưu mẫu hướng dẫn sử dụng." });
    },
    onError: (err) => showToast({ tone: "error", message: getErrMsg(err, "Không lưu được mẫu hướng dẫn.") }),
  });

  const resetUsageInstrMutation = useMutation({
    mutationFn: async () =>
      (await api.put("/admin-template/usage-instructions-template", { template: null })).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-template", "usage-instructions"] });
      setUsageInstrDraft({ ...DEFAULT_USAGE_INSTRUCTIONS });
      showToast({ tone: "success", message: "Đã đặt lại mẫu hướng dẫn về mặc định." });
    },
    onError: (err) => showToast({ tone: "error", message: getErrMsg(err, "Không đặt lại được.") }),
  });

  const testUsageInstrMutation = useMutation({
    mutationFn: async () => {
      const LS_KEY = "admin_invoice_test_chat_id";
      let chatId = localStorage.getItem(LS_KEY) || "";
      if (!chatId) {
        const input = window.prompt(
          "Nhập Telegram User ID / Chat ID để nhận tin test\n(lấy từ @userinfobot — vd: 5513106881)\nLưu lại cho lần sau:",
          "",
        );
        if (!input || !input.trim()) throw new Error("Đã huỷ — chưa nhập chat ID.");
        chatId = input.trim();
        localStorage.setItem(LS_KEY, chatId);
      }
      return (await api.post("/admin-template/usage-instructions-template/test", { telegramChatId: chatId })).data;
    },
    onSuccess: (data: any) => {
      showToast({ tone: "success", message: `Đã gửi thử tin hướng dẫn đến chat ${data?.sentTo || "admin"}.` });
    },
    onError: (err) => showToast({ tone: "error", message: getErrMsg(err, "Gửi thử thất bại.") }),
  });

  const buttonsQuery = useQuery<ButtonsConfig>({
    queryKey: ["admin-template", "buttons"],
    queryFn: async () => (await api.get("/admin-template/buttons")).data,
    retry: false,
    enabled: !!tplQuery.data?.botConfig,
  });

  const [tab, setTab] = useState<"config" | "products" | "invoice" | "restock" | "usage" | "buttons">("config");
  const [buttonsDraft, setButtonsDraft] = useState<ButtonsConfig | null>(null);
  useEffect(() => {
    if (buttonsQuery.data) {
      setButtonsDraft({
        labels: buttonsQuery.data.labels ?? {},
        emojis: buttonsQuery.data.emojis ?? {},
        emojiIds: buttonsQuery.data.emojiIds ?? {},
      });
    }
  }, [buttonsQuery.data]);

  const saveButtonsMutation = useMutation({
    mutationFn: async (cfg: ButtonsConfig) =>
      (await api.put("/admin-template/buttons", cfg)).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-template", "buttons"] });
      showToast({ tone: "success", message: "Đã lưu nút chức năng." });
    },
    onError: (err) => showToast({ tone: "error", message: getErrMsg(err, "Không lưu được nút chức năng.") }),
  });

  const resetButtonsMutation = useMutation({
    mutationFn: async () =>
      (await api.put("/admin-template/buttons", { labels: {}, emojis: {}, emojiIds: {} })).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-template", "buttons"] });
      showToast({ tone: "success", message: "Đã đặt lại nút chức năng về mặc định." });
    },
    onError: (err) => showToast({ tone: "error", message: getErrMsg(err, "Không đặt lại được.") }),
  });

  const resetTestChatId = () => {
    localStorage.removeItem("admin_invoice_test_chat_id");
    showToast({ tone: "info", message: "Đã xoá chat ID test. Lần test tiếp theo sẽ hỏi lại." });
  };

  if (tplQuery.isPending) {
    return <div className="p-10 text-center text-sm" style={{ color: "var(--tx-f)" }}>Đang tải...</div>;
  }

  // Need bootstrap
  if (tplQuery.error || !tplQuery.data) {
    return (
      <div className="mx-auto max-w-2xl space-y-5 p-6">
        <h1 className="text-2xl font-black" style={{ color: "var(--tx)" }}>Admin Bot Template</h1>
        <div className="rounded-2xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
          <p className="text-[14px]" style={{ color: "var(--tx-m)" }}>
            Chưa khởi tạo shop admin template. Bấm nút bên dưới để tạo lần đầu.
          </p>
          <button type="button" onClick={() => bootstrapMutation.mutate()} disabled={bootstrapMutation.isPending}
            className="mt-4 flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-black transition hover:opacity-90 disabled:opacity-40"
            style={{ background: "rgb(249,115,22)", color: "#fff" }}>
            <Plus className="h-4 w-4" />
            {bootstrapMutation.isPending ? "Đang tạo..." : "Khởi tạo shop admin template"}
          </button>
        </div>
      </div>
    );
  }

  const tpl = tplQuery.data;

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-6">
      <div>
        <h1 className="text-2xl font-black" style={{ color: "var(--tx)" }}>Admin Bot Template</h1>
        <p className="mt-1 text-[13px]" style={{ color: "var(--tx-m)" }}>
          Shop ID: <span className="font-mono">{tpl.shopId}</span> · isGlobalDefault: <span className="font-bold" style={{ color: tpl.botConfig?.isGlobalDefault ? "rgb(16,185,129)" : "rgb(239,68,68)" }}>{tpl.botConfig?.isGlobalDefault ? "YES" : "NO"}</span>
        </p>
      </div>

      <div className="sticky top-0 z-10 -mx-1 flex flex-wrap gap-2 rounded-2xl p-2" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
        {([
          ["config", "⚙️ Cấu hình"],
          ["products", "📦 Sản phẩm mặc định"],
          ["invoice", "📄 Hóa đơn"],
          ["restock", "📢 Nhập kho"],
          ["usage", "📖 Hướng dẫn SD"],
          ["buttons", "🔘 Nút chức năng"],
        ] as const).map(([k, lbl]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className="rounded-xl px-3 py-2 text-[13px] font-black transition"
            style={tab === k ? { background: "rgb(16,185,129)", color: "#fff" } : { background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-m)" }}
          >
            {lbl}
          </button>
        ))}
      </div>

      {tab === "config" && (<>
      {/* Bot Token */}
      <div className="rounded-2xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[16px] font-black" style={{ color: "var(--tx)" }}>Telegram Bot Token</h2>
            <p className="text-[12px]" style={{ color: "var(--tx-f)" }}>
              Bot riêng cho admin template (tạo qua @BotFather). Không bán hàng, chỉ để preview/demo.
            </p>
          </div>
          {tpl.botConfig?.telegramBotUsername && (
            <span className="rounded-full px-3 py-1.5 text-[11px] font-black"
              style={{ background: "rgba(52,211,153,0.12)", color: "rgb(52,211,153)" }}>
              ✓ @{tpl.botConfig.telegramBotUsername}
            </span>
          )}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <input type="password" value={botToken} onChange={(e) => setBotToken(e.target.value)}
            placeholder="123456789:AAEhBP0av28cVxxxxxxxxxxxxxxxxxxx"
            className={`${inputCls} font-mono`} style={inputStyle} />
          <button type="button" onClick={() => setBotTokenMutation.mutate()} disabled={setBotTokenMutation.isPending || !botToken.trim()}
            className="shrink-0 rounded-xl px-4 py-2 text-[12px] font-black transition hover:opacity-90 disabled:opacity-40"
            style={{ background: "rgb(16,185,129)", color: "#fff" }}>
            {setBotTokenMutation.isPending ? "..." : "Lưu token"}
          </button>
        </div>
        <p className="mt-2 text-[10px]" style={{ color: "var(--tx-f)" }}>
          Hệ thống sẽ tự gọi getMe để verify + lưu bot username. Token được mã hoá trong DB.
        </p>
      </div>

      {/* Customization JSON */}
      <div className="rounded-2xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[16px] font-black" style={{ color: "var(--tx)" }}>Bot customization (JSON)</h2>
            <p className="text-[12px]" style={{ color: "var(--tx-f)" }}>
              Welcome message, button labels, emoji động. Mọi seller mới sẽ inherit từ đây.
            </p>
          </div>
          <button type="button" onClick={handleSaveJson} disabled={updateMutation.isPending}
            className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-black transition hover:opacity-90 disabled:opacity-40"
            style={{ background: "rgb(16,185,129)", color: "#fff" }}>
            <Save className="h-3.5 w-3.5" /> {updateMutation.isPending ? "Đang lưu..." : "Lưu"}
          </button>
        </div>
        <textarea value={customJson} onChange={(e) => setCustomJson(e.target.value)}
          className="mt-3 w-full rounded-xl px-3 py-2.5 font-mono text-[12px] outline-none"
          style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx)", minHeight: 280 }}
          spellCheck={false} />
        {jsonError && (
          <div className="mt-2 rounded-lg px-3 py-2 text-[12px]"
            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "rgb(239,68,68)" }}>
            {jsonError}
          </div>
        )}
        <p className="mt-2 text-[10px]" style={{ color: "var(--tx-f)" }}>
          Cấu trúc gợi ý: <code>{`{ "welcomeMessage": "...", "buttonLabels": { "buy": "Mua hàng" }, "buttonEmojiIds": { "buy": "5391..." }, "productDefaultsByFamily": {} }`}</code>
        </p>
      </div>

      </>)}

      {tab === "products" && (<>
      {/* Product family catalog (admin-managed) */}
      <ProductFamilyManager />

      {/* Product defaults */}
      <div className="rounded-2xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[16px] font-black" style={{ color: "var(--tx)" }}>Product defaults theo dòng sản phẩm</h2>
            <p className="text-[12px]" style={{ color: "var(--tx-f)" }}>
              Khi seller import/tạo sản phẩm cùng family → auto fill icon + emoji động + media.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button"
              onClick={() => { if (window.confirm("Quét toàn bộ products của tất cả shop và fill icon/emoji/ảnh từ admin template theo family. Chỉ fill các field đang NULL, không ghi đè. Tiếp tục?")) backfillMutation.mutate(false); }}
              disabled={backfillMutation.isPending}
              className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-black transition hover:opacity-90 disabled:opacity-40"
              style={{ background: "rgba(56,189,248,0.12)", border: "1px solid rgba(56,189,248,0.3)", color: "rgb(56,189,248)" }}>
              {backfillMutation.isPending ? "Đang quét..." : "↻ Backfill products cũ"}
            </button>
            <button type="button"
              onClick={() => { if (window.confirm("Đè 100% ẢNH/VIDEO của TẤT CẢ sản phẩm theo admin template (kể cả seller đã chỉnh ảnh riêng — sẽ bị mất). Icon emoji vẫn được giữ nếu seller đã chỉnh. Tiếp tục?")) backfillMutation.mutate(true); }}
              disabled={backfillMutation.isPending}
              className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-black transition hover:opacity-90 disabled:opacity-40"
              style={{ background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.3)", color: "rgb(248,113,113)" }}>
              {backfillMutation.isPending ? "Đang quét..." : "⚠ Đè ảnh, giữ icon"}
            </button>
            {!showForm && (
              <button type="button" onClick={() => { resetPdForm(); setShowForm(true); }}
                className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-black transition hover:opacity-90"
                style={{ background: "rgb(249,115,22)", color: "#fff" }}>
                <Plus className="h-3.5 w-3.5" /> Thêm
              </button>
            )}
          </div>
        </div>

        {showForm && (
          <div className="mt-4 rounded-xl p-4 space-y-3" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Dòng sản phẩm (productFamily)">
                <select value={pdFamily} onChange={(e) => setPdFamily(e.target.value)} disabled={!!editingFamily}
                  className={`${inputCls} ${editingFamily ? "opacity-60" : ""}`} style={inputStyle}>
                  {familyOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Custom Emoji ID (Telegram Premium)">
                <input value={pdEmojiId} onChange={(e) => setPdEmojiId(e.target.value)} placeholder="5391... (mặc định hệ thống auto-detect emoji theo family)" className={`${inputCls} font-mono`} style={inputStyle} />
              </Field>
              <Field label="Loại media">
                <select value={pdMediaType} onChange={(e) => setPdMediaType(e.target.value as any)} className={inputCls} style={inputStyle}>
                  <option value="none">Không có</option>
                  <option value="photo">Ảnh</option>
                  <option value="video">Video</option>
                  <option value="animation">Animation/GIF</option>
                </select>
              </Field>
              {pdMediaType !== "none" && (
                <>
                  <div className="sm:col-span-2">
                    <p className="mb-1.5 text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>Media URL (public)</p>
                    <div className="flex items-center gap-2">
                      <input value={pdMediaUrl} onChange={(e) => setPdMediaUrl(e.target.value)} placeholder="https://... hoặc bấm Upload" className={`${inputCls} font-mono`} style={inputStyle} />
                      <label className="shrink-0 cursor-pointer rounded-xl px-3 py-2 text-[12px] font-black transition hover:opacity-90"
                        style={{ background: "rgb(56,189,248)", color: "#fff" }}>
                        <input type="file" accept="image/*,video/*" className="hidden"
                          disabled={uploading}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleFileUpload(f);
                            e.target.value = "";
                          }} />
                        <Upload className="mr-1 inline h-3.5 w-3.5" />
                        {uploading ? "Đang up..." : "Upload"}
                      </label>
                    </div>
                    <p className="mt-1 text-[10px]" style={{ color: "var(--tx-f)" }}>Tối đa 20MB. Ảnh: jpg/png/webp. Video: mp4 ≤ 30s khuyến nghị.</p>
                  </div>
                  <Field label="Caption (optional)">
                    <input value={pdMediaCaption} onChange={(e) => setPdMediaCaption(e.target.value)} placeholder="..." className={inputCls} style={inputStyle} />
                  </Field>
                </>
              )}
              <div className="sm:col-span-2">
                <Field label="Mô tả">
                  <textarea value={pdDesc} onChange={(e) => setPdDesc(e.target.value)} placeholder="..." className={inputCls} style={{ ...inputStyle, minHeight: 60 }} />
                </Field>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" onClick={resetPdForm}
                className="rounded-xl px-4 py-2 text-[12px] font-black transition hover:opacity-80"
                style={{ background: "var(--surface)", border: "1px solid var(--bd)", color: "var(--tx-f)" }}>
                <X className="mr-1 inline h-3 w-3" /> Hủy
              </button>
              <button type="button" onClick={() => setProductDefault.mutate()} disabled={setProductDefault.isPending || !pdFamily}
                className="rounded-xl px-4 py-2 text-[12px] font-black transition hover:opacity-90 disabled:opacity-40"
                style={{ background: "rgb(16,185,129)", color: "#fff" }}>
                <Check className="mr-1 inline h-3 w-3" /> {setProductDefault.isPending ? "..." : "Lưu"}
              </button>
            </div>
          </div>
        )}

        <div className="mt-4 space-y-1.5">
          {productFamilies.length === 0 ? (
            <p className="rounded-xl py-6 text-center text-[12px]" style={{ color: "var(--tx-f)", background: "var(--inp)", border: "1px solid var(--bd)" }}>
              Chưa có mặc định nào. Bấm Thêm để bắt đầu.
            </p>
          ) : (
            productFamilies.map((family) => {
              const d = (productDefaults[family] || {}) as ProductDefault;
              return (
                <div key={family} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg" style={{ background: "var(--surface)" }}>
                      {d.icon || "📦"}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-black" style={{ color: "var(--tx)" }}>{familyLabel(family)}</p>
                      <p className="truncate text-[11px]" style={{ color: "var(--tx-f)" }}>
                        <span className="font-mono">{family}</span>
                        {d.customEmojiId ? ` · emoji:${d.customEmojiId.slice(0, 10)}...` : ""}
                        {d.media?.type ? ` · media:${d.media.type}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button type="button" onClick={() => openEdit(family)}
                      className="rounded-lg px-2.5 py-1 text-[11px] font-bold transition hover:opacity-80"
                      style={{ background: "var(--surface)", border: "1px solid var(--bd)", color: "var(--tx-m)" }}>
                      Sửa
                    </button>
                    <button type="button" onClick={() => { if (window.confirm(`Xóa default "${familyLabel(family)}"?`)) removeProductDefault.mutate(family); }}
                      className="rounded-lg px-2 py-1 text-[11px] font-bold transition hover:opacity-80"
                      style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.25)", color: "rgb(239,68,68)" }}>
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      </>)}

      {tab === "invoice" && (<>
      {/* Invoice template */}
      <div className="rounded-2xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[16px] font-black" style={{ color: "var(--tx)" }}>📄 Mẫu hóa đơn giao hàng</h2>
            <p className="text-[12px]" style={{ color: "var(--tx-f)" }}>
              Header/footer + icon + ngưỡng gửi file (.txt khi nhiều tài khoản). User mới sẽ inherit từ đây.
            </p>
          </div>
        </div>
        {invoiceQuery.isPending ? (
          <p className="text-[12px]" style={{ color: "var(--tx-f)" }}>Đang tải mẫu hóa đơn...</p>
        ) : invoiceDraft ? (
          <InvoiceTemplateEditor
            value={invoiceDraft}
            defaults={invoiceQuery.data?.defaults as InvoiceTemplate}
            onChange={setInvoiceDraft}
            onSave={() => saveInvoiceMutation.mutate(invoiceDraft)}
            onReset={() => {
              if (window.confirm("Đặt lại mẫu hóa đơn về mặc định hệ thống?")) {
                resetInvoiceMutation.mutate();
              }
            }}
            onSendTest={(mode) => testInvoiceMutation.mutate(mode)}
            isSaving={saveInvoiceMutation.isPending}
            isTesting={testInvoiceMutation.isPending}
            hint="Test sẽ gửi đến chat của bot admin template (cần set Telegram User ID chủ bot trước)."
          />
        ) : null}
      </div>

      </>)}

      {tab === "restock" && (<>
      {/* Restock notification template */}
      <div className="rounded-2xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[16px] font-black" style={{ color: "var(--tx)" }}>📢 Mẫu thông báo nhập kho</h2>
            <p className="text-[12px]" style={{ color: "var(--tx-f)" }}>
              Header/footer + icon + nhãn dòng cho tin "Thông báo nhập kho". Mọi bot inherit từ đây.
            </p>
          </div>
        </div>
        {restockQuery.isPending ? (
          <p className="text-[12px]" style={{ color: "var(--tx-f)" }}>Đang tải mẫu nhập kho...</p>
        ) : restockDraft ? (
          <RestockTemplateEditor
            value={restockDraft}
            defaults={restockQuery.data?.defaults as RestockTemplate}
            onChange={setRestockDraft}
            onSave={() => saveRestockMutation.mutate(restockDraft)}
            onReset={() => {
              if (window.confirm("Đặt lại mẫu thông báo nhập kho về mặc định hệ thống?")) {
                resetRestockMutation.mutate();
              }
            }}
            onSendTest={() => testRestockMutation.mutate()}
            isSaving={saveRestockMutation.isPending}
            isTesting={testRestockMutation.isPending}
            hint="Test sẽ gửi đến chat của bot admin template (cần set Telegram User ID chủ bot trước)."
          />
        ) : null}
      </div>

      </>)}

      {tab === "usage" && (<>
      {/* Usage instructions template */}
      <div className="rounded-2xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[16px] font-black" style={{ color: "var(--tx)" }}>📖 Mẫu hướng dẫn sử dụng</h2>
            <p className="text-[12px]" style={{ color: "var(--tx-f)" }}>
              Tin riêng gửi sau hóa đơn. Nội dung lấy từ trường "Hướng dẫn sử dụng" mỗi sản phẩm.
              Chỉ gửi khi sản phẩm có nhập hướng dẫn.
            </p>
          </div>
        </div>
        {usageInstrQuery.isPending ? (
          <p className="text-[12px]" style={{ color: "var(--tx-f)" }}>Đang tải mẫu hướng dẫn...</p>
        ) : usageInstrDraft ? (
          <>
            <UsageInstructionsTemplateEditor
              value={usageInstrDraft}
              defaults={usageInstrQuery.data?.defaults ?? DEFAULT_USAGE_INSTRUCTIONS}
              onChange={setUsageInstrDraft}
            />
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4" style={{ borderColor: "var(--bd)" }}>
              <button
                type="button"
                onClick={() => saveUsageInstrMutation.mutate(usageInstrDraft)}
                disabled={saveUsageInstrMutation.isPending}
                className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-[12px] font-black transition hover:opacity-90 disabled:opacity-40"
                style={{ background: "rgb(16,185,129)", color: "#fff" }}
              >
                <Save className="h-3.5 w-3.5" />
                {saveUsageInstrMutation.isPending ? "Đang lưu..." : "Lưu mẫu"}
              </button>
              <button
                type="button"
                onClick={() => testUsageInstrMutation.mutate()}
                disabled={testUsageInstrMutation.isPending}
                className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-[12px] font-black transition hover:opacity-90 disabled:opacity-40"
                style={{ background: "rgb(56,189,248)", color: "#fff" }}
              >
                {testUsageInstrMutation.isPending ? "Đang gửi..." : "Gửi thử"}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm("Đặt lại mẫu hướng dẫn về mặc định hệ thống?")) {
                    resetUsageInstrMutation.mutate();
                  }
                }}
                disabled={resetUsageInstrMutation.isPending}
                className="rounded-xl px-4 py-2 text-[12px] font-black transition hover:opacity-80 disabled:opacity-40"
                style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-f)" }}
              >
                Đặt lại mặc định
              </button>
              <p className="ml-auto text-[11px]" style={{ color: "var(--tx-f)" }}>
                Test gửi đến chat admin template. Nội dung thực do từng sản phẩm cung cấp.
              </p>
            </div>
          </>
        ) : null}
      </div>
      </>)}

      {tab === "buttons" && (<>
      {/* Function buttons */}
      <div className="rounded-2xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--bd)" }}>
        <div className="mb-3">
          <h2 className="text-[16px] font-black" style={{ color: "var(--tx)" }}>🔘 Nút chức năng</h2>
          <p className="text-[12px]" style={{ color: "var(--tx-f)" }}>
            Nhãn / emoji / custom emoji ID cho từng nút (menu, mua hàng, thanh toán). Mọi bot inherit từ đây.
          </p>
        </div>
        {buttonsQuery.isPending ? (
          <p className="text-[12px]" style={{ color: "var(--tx-f)" }}>Đang tải nút chức năng...</p>
        ) : buttonsDraft ? (
          <ButtonsEditor
            value={buttonsDraft}
            onChange={setButtonsDraft}
            onSave={() => saveButtonsMutation.mutate(buttonsDraft)}
            onReset={() => {
              if (window.confirm("Xoá hết tuỳ chỉnh nút và về nhãn/emoji mặc định?")) {
                resetButtonsMutation.mutate();
              }
            }}
            isSaving={saveButtonsMutation.isPending}
          />
        ) : null}
      </div>
      </>)}
    </div>
  );
}

const inputCls = "w-full rounded-xl px-3 py-2 text-[13px] outline-none";
const inputStyle = { background: "var(--surface)", border: "1px solid var(--bd)", color: "var(--tx)" };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>{label}</p>
      {children}
    </div>
  );
}
