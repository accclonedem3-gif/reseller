import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Send,
  Users,
  MessageSquare,
  Radio,
  Plus,
  Play,
  Pause,
  Trash2,
  RefreshCw,
  Eye,
  CheckCircle2,
  AlertTriangle,
  KeyRound,
  Lock,
  Clock,
  Sparkles,
  Shield,
  FileText,
  Bookmark,
  ChevronRight,
  X,
  BookOpenText,
  HelpCircle,
  ExternalLink,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { toUserbotScheduleIso } from "@/lib/userbot-schedule";

export function UserbotCampaignPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"campaigns" | "sessions" | "templates" | "groups" | "guide">("campaigns");

  // --- Modals State ---
  const [addSessionModal, setAddSessionModal] = useState(false);
  const [otpStep, setOtpStep] = useState<"phone" | "code">("phone");
  const [apiIdInput, setApiIdInput] = useState("");
  const [apiHashInput, setApiHashInput] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [phoneCodeHash, setPhoneCodeHash] = useState("");
  const [tempSessionString, setTempSessionString] = useState("");
  const [password2FA, setPassword2FA] = useState("");
  const [proxyUrlInput, setProxyUrlInput] = useState("");
  const [requires2FA, setRequires2FA] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSuccess, setAuthSuccess] = useState<string | null>(null);

  // Proxy Edit State
  const [editProxySessionId, setEditProxySessionId] = useState<string | null>(null);
  const [editProxyUrl, setEditProxyUrl] = useState("");

  // Template Modal State
  const [addTemplateModal, setAddTemplateModal] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateType, setTemplateType] = useState<"SPINTAX_TEXT" | "FORWARD_SAVED_MESSAGE">("SPINTAX_TEXT");
  const [templateContent, setTemplateContent] = useState("");
  const [selectedSessionForSaved, setSelectedSessionForSaved] = useState("");
  const [selectedSavedMsgId, setSelectedSavedMsgId] = useState("");
  const [selectedSavedMsgText, setSelectedSavedMsgText] = useState("");

  // Campaign Modal State
  const [addCampaignModal, setAddCampaignModal] = useState(false);
  const [campaignName, setCampaignName] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [delaySeconds, setDelaySeconds] = useState(60);
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduleTimeInput, setScheduleTimeInput] = useState("");
  const [isRecurring, setIsRecurring] = useState(false);
  const [repeatIntervalHours, setRepeatIntervalHours] = useState(24);

  // Log View Modal
  const [viewLogCampaignId, setViewLogCampaignId] = useState<string | null>(null);

  // License Modal State
  const [activateLicenseModal, setActivateLicenseModal] = useState(false);
  const [licenseCodeInput, setLicenseCodeInput] = useState("");
  const [licenseError, setLicenseError] = useState<string | null>(null);

  // --- QUERIES ---
  const { data: licenseStatus } = useQuery({
    queryKey: ["userbot-license-status"],
    queryFn: async () => (await api.get("/userbot-campaign/license/status")).data,
  });

  const activateLicenseMutation = useMutation({
    mutationFn: async () => {
      setLicenseError(null);
      return (await api.post("/userbot-campaign/license/activate", { code: licenseCodeInput })).data;
    },
    onSuccess: (data) => {
      setActivateLicenseModal(false);
      setLicenseCodeInput("");
      alert(data.message || "Kích hoạt License Key thành công!");
      queryClient.invalidateQueries({ queryKey: ["userbot-license-status"] });
    },
    onError: (err: any) => {
      setLicenseError(err.response?.data?.message || err.message || "Kích hoạt thất bại.");
    },
  });

  const { data: sessions = [], isLoading: loadingSessions, refetch: refetchSessions } = useQuery({
    queryKey: ["userbot-sessions"],
    queryFn: async () => (await api.get("/userbot-campaign/sessions")).data,
  });

  const { data: groups = [], isLoading: loadingGroups } = useQuery({
    queryKey: ["userbot-groups", selectedSessionId],
    queryFn: async () =>
      (await api.get("/userbot-campaign/groups", { params: { sessionId: selectedSessionId || undefined } })).data,
  });

  const { data: templates = [], isLoading: loadingTemplates } = useQuery({
    queryKey: ["userbot-templates"],
    queryFn: async () => (await api.get("/userbot-campaign/templates")).data,
  });

  const { data: campaigns = [], isLoading: loadingCampaigns } = useQuery({
    queryKey: ["userbot-campaigns"],
    queryFn: async () => (await api.get("/userbot-campaign/campaigns")).data,
    refetchInterval: 5000,
  });

  const { data: savedMessages = [], isFetching: fetchingSaved } = useQuery({
    queryKey: ["userbot-saved-messages", selectedSessionForSaved],
    queryFn: async () => {
      if (!selectedSessionForSaved) return [];
      return (await api.get(`/userbot-campaign/sessions/${selectedSessionForSaved}/saved-messages`)).data;
    },
    enabled: Boolean(selectedSessionForSaved) && templateType === "FORWARD_SAVED_MESSAGE",
  });

  const { data: campaignLogs = [] } = useQuery({
    queryKey: ["userbot-campaign-logs", viewLogCampaignId],
    queryFn: async () => {
      if (!viewLogCampaignId) return [];
      return (await api.get(`/userbot-campaign/campaigns/${viewLogCampaignId}/logs`)).data;
    },
    enabled: Boolean(viewLogCampaignId),
    refetchInterval: 3000,
  });

  // --- MUTATIONS ---
  const sendOtpMutation = useMutation({
    mutationFn: async () => {
      setAuthError(null);
      return (
        await api.post("/userbot-campaign/auth/send-otp", {
          phoneNumber: phone,
          apiId: apiIdInput ? Number(apiIdInput) : undefined,
          apiHash: apiHashInput || undefined,
          proxyUrl: proxyUrlInput || undefined,
        })
      ).data;
    },
    onSuccess: (data) => {
      setPhoneCodeHash(data.phoneCodeHash);
      setTempSessionString(data.tempSessionString || "");
      setOtpStep("code");
      setAuthSuccess(data.message || "Đã gửi mã OTP.");
    },
    onError: (err: any) => {
      setAuthError(err.response?.data?.message || err.message || "Gửi OTP thất bại.");
    },
  });

  const verifyOtpMutation = useMutation({
    mutationFn: async () => {
      setAuthError(null);
      return (
        await api.post("/userbot-campaign/auth/verify-otp", {
          phoneNumber: phone,
          tempSessionString: tempSessionString || undefined,
          apiId: apiIdInput ? Number(apiIdInput) : undefined,
          apiHash: apiHashInput || undefined,
          phoneCode,
          phoneCodeHash,
          password: password2FA || undefined,
          proxyUrl: proxyUrlInput || undefined,
        })
      ).data;
    },
    onSuccess: (data) => {
      if (data.requires2FA) {
        setRequires2FA(true);
        setAuthError(data.message);
      } else {
        setAddSessionModal(false);
        setOtpStep("phone");
        setPhone("");
        setPhoneCode("");
        setPassword2FA("");
        queryClient.invalidateQueries({ queryKey: ["userbot-sessions"] });
      }
    },
    onError: (err: any) => {
      setAuthError(err.response?.data?.message || err.message || "Xác minh mã OTP thất bại.");
    },
  });

  const syncGroupsMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      return (await api.post(`/userbot-campaign/sessions/${sessionId}/sync-groups`)).data;
    },
    onSuccess: (data) => {
      alert(`Đã đồng bộ thành công ${data.count} nhóm Telegram!`);
      queryClient.invalidateQueries({ queryKey: ["userbot-groups"] });
      queryClient.invalidateQueries({ queryKey: ["userbot-sessions"] });
    },
    onError: (err: any) => {
      alert(err.response?.data?.message || "Đồng bộ nhóm thất bại.");
    },
  });

  const deleteSessionMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      return (await api.delete(`/userbot-campaign/sessions/${sessionId}`)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["userbot-sessions"] });
    },
  });

  const saveProxyMutation = useMutation({
    mutationFn: async () => {
      if (!editProxySessionId) return;
      return (await api.put(`/userbot-campaign/sessions/${editProxySessionId}/proxy`, { proxyUrl: editProxyUrl })).data;
    },
    onSuccess: () => {
      setEditProxySessionId(null);
      queryClient.invalidateQueries({ queryKey: ["userbot-sessions"] });
    },
  });

  const createTemplateMutation = useMutation({
    mutationFn: async () => {
      return (
        await api.post("/userbot-campaign/templates", {
          name: templateName,
          type: templateType,
          content: templateContent || undefined,
          savedMessageId: selectedSavedMsgId || undefined,
          savedMessageText: selectedSavedMsgText || undefined,
        })
      ).data;
    },
    onSuccess: () => {
      setAddTemplateModal(false);
      setTemplateName("");
      setTemplateContent("");
      setSelectedSavedMsgId("");
      queryClient.invalidateQueries({ queryKey: ["userbot-templates"] });
    },
    onError: (err: any) => {
      alert(
        typeof err.response?.data?.message === "string"
          ? err.response.data.message
          : Array.isArray(err.response?.data?.message)
          ? err.response.data.message[0]
          : "Có lỗi xảy ra khi lưu mẫu tin nhắn.",
      );
    },
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: async (templateId: string) => {
      return (await api.delete(`/userbot-campaign/templates/${templateId}`)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["userbot-templates"] });
      queryClient.invalidateQueries({ queryKey: ["userbot-campaigns"] });
    },
  });

  const deleteAllTemplatesMutation = useMutation({
    mutationFn: async () => {
      return (await api.delete("/userbot-campaign/templates")).data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["userbot-templates"] });
      queryClient.invalidateQueries({ queryKey: ["userbot-campaigns"] });
      alert(`Đã xóa ${data?.deletedCount ?? 0} mẫu tin quảng cáo.`);
    },
  });

  const createCampaignMutation = useMutation({
    mutationFn: async () => {
      const scheduleTime = toUserbotScheduleIso(isScheduled, scheduleTimeInput);

      return (
        await api.post("/userbot-campaign/campaigns", {
          sessionId: selectedSessionId,
          templateId: selectedTemplateId,
          name: campaignName,
          targetGroupIds: selectedGroupIds,
          delaySeconds,
          scheduleTime,
          isRecurring,
          repeatIntervalHours: isRecurring ? Number(repeatIntervalHours) : undefined,
        })
      ).data;
    },
    onSuccess: () => {
      setAddCampaignModal(false);
      setCampaignName("");
      setSelectedGroupIds([]);
      setIsScheduled(false);
      setScheduleTimeInput("");
      setIsRecurring(false);
      setRepeatIntervalHours(24);
      queryClient.invalidateQueries({ queryKey: ["userbot-campaigns"] });
    },
    onError: (err: any) => {
      alert(
        typeof err.response?.data?.message === "string"
          ? err.response.data.message
          : Array.isArray(err.response?.data?.message)
          ? err.response.data.message[0]
          : err.message || "Có lỗi xảy ra khi tạo chiến dịch.",
      );
    },
  });

  const startCampaignMutation = useMutation({
    mutationFn: async (campaignId: string) => {
      return (await api.post(`/userbot-campaign/campaigns/${campaignId}/start`)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["userbot-campaigns"] });
    },
    onError: (err: any) => {
      alert(err.response?.data?.message || err.message || "Không thể bắt đầu chiến dịch.");
      queryClient.invalidateQueries({ queryKey: ["userbot-campaigns"] });
    },
  });

  const pauseCampaignMutation = useMutation({
    mutationFn: async (campaignId: string) => {
      return (await api.post(`/userbot-campaign/campaigns/${campaignId}/pause`)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["userbot-campaigns"] });
    },
  });

  const deleteCampaignMutation = useMutation({
    mutationFn: async (campaignId: string) => {
      return (await api.delete(`/userbot-campaign/campaigns/${campaignId}`)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["userbot-campaigns"] });
    },
  });

  return (
    <div className="space-y-6">
      {/* License Key Status Banner */}
      <div className="rounded-3xl border border-[var(--bd)] bg-[var(--surface)] p-5 shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-purple-500/10 text-purple-500 font-bold">
            <KeyRound className="size-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-black text-sm uppercase tracking-wider text-[var(--tx)]">
                License Tele Campaign:{" "}
                {licenseStatus?.isFreeMode ? (
                  <span className="text-emerald-400 font-extrabold">Miễn Phí (Free Access)</span>
                ) : licenseStatus?.isActive ? (
                  <span className="text-purple-400 font-extrabold">{licenseStatus.licenseType}</span>
                ) : (
                  <span className="text-rose-500 font-extrabold">Chưa kích hoạt</span>
                )}
              </h3>
              {licenseStatus?.isFreeMode ? (
                <span className="rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-0.5 text-[10px] font-black uppercase text-emerald-400">
                  Miễn phí sử dụng
                </span>
              ) : (
                licenseStatus?.isActive && (
                  <span className="rounded-full bg-purple-500/10 border border-purple-500/30 px-2.5 py-0.5 text-[10px] font-black uppercase text-purple-400">
                    Đang hoạt động
                  </span>
                )
              )}
            </div>
            <p className="text-xs text-[var(--tx-m)] mt-0.5">
              {licenseStatus?.isFreeMode ? (
                <>
                  Trạng thái: <strong className="text-emerald-400">Gói Miễn Phí</strong> (Giới hạn: 1 Acc Telegram / 1 Chiến dịch. Nâng cấp Key PRO/UNLIMITED để dùng nhiều hơn)
                </>
              ) : licenseStatus?.isActive ? (
                <>
                  Hạn sử dụng: <strong className="text-[var(--tx)]">{licenseStatus.expiresAt ? new Date(licenseStatus.expiresAt).toLocaleDateString("vi-VN") : "Vĩnh viễn"}</strong> (Giới hạn: {licenseStatus.maxSessions === 9999 ? "Vô hạn" : licenseStatus.maxSessions} Acc / {licenseStatus.maxCampaigns === 9999 ? "Vô hạn" : licenseStatus.maxCampaigns} Chiến dịch)
                </>
              ) : (
                "Bạn cần kích hoạt License Key để khởi tạo và vận hành chiến dịch Telegram Userbot."
              )}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setActivateLicenseModal(true)}
          className="flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 px-5 py-2.5 text-xs font-black uppercase tracking-wider text-white shadow-md transition hover:brightness-110 shrink-0"
        >
          <KeyRound className="size-4" />
          Kích hoạt Key License
        </button>
      </div>

      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-3xl border border-orange-500/20 bg-gradient-to-r from-orange-500/10 via-amber-500/5 to-transparent p-6 shadow-xl backdrop-blur-xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1 text-xs font-black text-orange-500">
              <Sparkles className="size-3.5 animate-pulse" />
              TELE CAMPAIGN MARKETING v2.0
            </div>
            <h1 className="text-2xl font-black uppercase tracking-tight text-[var(--tx)]">
              Quản trị Chiến dịch Telegram Userbot
            </h1>
            <p className="text-sm font-medium text-[var(--tx-m)]">
              Tự động hóa seeding, rải tin nhắn hàng loạt vào các nhóm Telegram cá nhân 24/7 an toàn & hiệu quả.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setAddSessionModal(true)}
              className="flex items-center gap-2 rounded-2xl bg-orange-500 px-4 py-2.5 text-xs font-black uppercase tracking-wider text-white shadow-lg shadow-orange-500/20 transition hover:brightness-110"
            >
              <Plus className="size-4" />
              Kết nối Telegram SĐT
            </button>
            <button
              type="button"
              onClick={() => setAddCampaignModal(true)}
              className="flex items-center gap-2 rounded-2xl border border-[var(--bd)] bg-[var(--surface)] px-4 py-2.5 text-xs font-black uppercase tracking-wider text-[var(--tx)] shadow-md transition hover:bg-slate-500/10"
            >
              <Radio className="size-4 text-orange-500" />
              Tạo chiến dịch
            </button>
          </div>
        </div>
      </div>

      {/* Metrics Overview Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative overflow-hidden rounded-2xl border border-[var(--bd)] bg-[var(--surface)] p-5 shadow-sm transition hover:border-orange-500/30">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--tx-m)]">Tài khoản Telegram</span>
            <div className="flex size-9 items-center justify-center rounded-xl bg-orange-500/10 text-orange-500 font-bold">
              <Send className="size-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-[var(--tx)]">{sessions.length}</span>
            <span className="text-xs font-bold text-emerald-500">Tài khoản</span>
          </div>
          <p className="mt-1 text-[11px] text-[var(--tx-f)]">GramJS MTProto Session</p>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-[var(--bd)] bg-[var(--surface)] p-5 shadow-sm transition hover:border-orange-500/30">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--tx-m)]">Chiến dịch Seeding</span>
            <div className="flex size-9 items-center justify-center rounded-xl bg-blue-500/10 text-blue-500 font-bold">
              <Radio className="size-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-[var(--tx)]">{campaigns.length}</span>
            <span className="text-xs font-bold text-blue-500">Chiến dịch</span>
          </div>
          <p className="mt-1 text-[11px] text-[var(--tx-f)]">Hàng chờ BullMQ Queue 24/7</p>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-[var(--bd)] bg-[var(--surface)] p-5 shadow-sm transition hover:border-orange-500/30">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--tx-m)]">Mẫu tin nhắn</span>
            <div className="flex size-9 items-center justify-center rounded-xl bg-purple-500/10 text-purple-500 font-bold">
              <FileText className="size-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-[var(--tx)]">{templates.length}</span>
            <span className="text-xs font-bold text-purple-500">Mẫu tin</span>
          </div>
          <p className="mt-1 text-[11px] text-[var(--tx-f)]">Spintax & Saved Messages</p>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-[var(--bd)] bg-[var(--surface)] p-5 shadow-sm transition hover:border-orange-500/30">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--tx-m)]">Nhóm đã quét</span>
            <div className="flex size-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500 font-bold">
              <Users className="size-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-[var(--tx)]">{groups.length}</span>
            <span className="text-xs font-bold text-emerald-500">Nhóm</span>
          </div>
          <p className="mt-1 text-[11px] text-[var(--tx-f)]">Sẵn sàng phát tin hàng loạt</p>
        </div>
      </div>

      {/* Tabs Control */}
      <div className="flex flex-wrap gap-2 rounded-2xl border border-[var(--bd)] bg-[var(--surface)] p-2">
        <button
          type="button"
          onClick={() => setActiveTab("campaigns")}
          className={cn(
            "flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black uppercase tracking-wider transition",
            activeTab === "campaigns"
              ? "bg-orange-500 text-white shadow-md shadow-orange-500/20"
              : "text-[var(--tx-m)] hover:text-[var(--tx)]",
          )}
        >
          <Radio className="size-4" />
          Chiến dịch phát tin ({campaigns.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("sessions")}
          className={cn(
            "flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black uppercase tracking-wider transition",
            activeTab === "sessions"
              ? "bg-orange-500 text-white shadow-md shadow-orange-500/20"
              : "text-[var(--tx-m)] hover:text-[var(--tx)]",
          )}
        >
          <Send className="size-4" />
          Tài khoản Telegram ({sessions.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("templates")}
          className={cn(
            "flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black uppercase tracking-wider transition",
            activeTab === "templates"
              ? "bg-orange-500 text-white shadow-md shadow-orange-500/20"
              : "text-[var(--tx-m)] hover:text-[var(--tx)]",
          )}
        >
          <FileText className="size-4" />
          Mẫu tin nhắn ({templates.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("groups")}
          className={cn(
            "flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black uppercase tracking-wider transition",
            activeTab === "groups"
              ? "bg-orange-500 text-white shadow-md shadow-orange-500/20"
              : "text-[var(--tx-m)] hover:text-[var(--tx)]",
          )}
        >
          <Users className="size-4" />
          Danh sách Nhóm ({groups.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("guide")}
          className={cn(
            "flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black uppercase tracking-wider transition ml-auto",
            activeTab === "guide"
              ? "bg-purple-600 text-white shadow-md shadow-purple-600/20"
              : "border border-purple-500/30 text-purple-400 hover:bg-purple-500/10",
          )}
        >
          <BookOpenText className="size-4" />
          Hướng dẫn & Lấy API
        </button>
      </div>

      {/* --- TAB 1: CAMPAIGNS --- */}
      {activeTab === "campaigns" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-black uppercase tracking-tight text-[var(--tx)]">Danh sách Chiến dịch</h2>
            <button
              type="button"
              onClick={() => setAddCampaignModal(true)}
              className="flex items-center gap-2 rounded-xl bg-orange-500 px-3.5 py-2 text-xs font-black uppercase tracking-wider text-white shadow-md hover:brightness-110"
            >
              <Plus className="size-4" />
              Tạo chiến dịch mới
            </button>
          </div>

          <div className="overflow-hidden rounded-2xl border border-[var(--bd)] bg-[var(--surface)] shadow-lg">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[var(--bd)] bg-slate-500/5 text-[10px] font-black uppercase tracking-wider text-[var(--tx-f)]">
                <tr>
                  <th className="px-4 py-3">Tên chiến dịch</th>
                  <th className="px-4 py-3">Trạng thái</th>
                  <th className="px-4 py-3">Tài khoản Telegram</th>
                  <th className="px-4 py-3">Mẫu tin</th>
                  <th className="px-4 py-3">Tiến độ (nhóm)</th>
                  <th className="px-4 py-3">OK / Lỗi</th>
                  <th className="px-4 py-3">Delay</th>
                  <th className="px-4 py-3">Lịch / Vòng lặp</th>
                  <th className="px-4 py-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--bd)]">
                {campaigns.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-xs text-[var(--tx-f)]">
                      Chưa có chiến dịch nào được khởi tạo.
                    </td>
                  </tr>
                ) : (
                  campaigns.map((item: any) => {
                    const progressPct =
                      item.totalTarget > 0 ? Math.min(100, Math.round((item.sentCount / item.totalTarget) * 100)) : 0;
                    return (
                      <tr key={item.id} className="transition hover:bg-slate-500/5">
                        <td className="px-4 py-3.5 font-bold text-[var(--tx)]">{item.name}</td>
                        <td className="px-4 py-3.5">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider",
                              item.status === "RUNNING" && "bg-emerald-500/10 text-emerald-500 border border-emerald-500/30 animate-pulse",
                              item.status === "PAUSED" && "bg-amber-500/10 text-amber-500 border border-amber-500/30",
                              item.status === "COMPLETED" && "bg-blue-500/10 text-blue-500 border border-blue-500/30",
                              item.status === "FAILED" && "bg-rose-500/10 text-rose-500 border border-rose-500/30",
                              item.status === "DRAFT" && "bg-slate-500/10 text-slate-400 border border-slate-500/30",
                            )}
                          >
                            {item.status === "RUNNING" && item.nextRunAt ? "ĐÃ XẾP LỊCH" : item.status}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-xs text-[var(--tx-m)]">{item.sessionPhoneNumber}</td>
                        <td className="px-4 py-3.5 text-xs text-[var(--tx-m)]">{item.templateName}</td>
                        <td className="px-4 py-3.5 min-w-[140px]">
                          <div className="space-y-1">
                            <div className="flex justify-between text-[10px] font-black text-[var(--tx-f)]">
                              <span>{progressPct}%</span>
                              <span>{item.sentCount}/{item.totalTarget}</span>
                            </div>
                            <div className="h-1.5 w-full rounded-full bg-slate-500/20 overflow-hidden">
                              <div
                                className="h-full bg-orange-500 transition-all duration-300"
                                style={{ width: `${progressPct}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-xs font-bold">
                          <span className="text-emerald-500">{item.sentCount}</span> /{" "}
                          <span className="text-rose-500">{item.failedCount}</span>
                        </td>
                        <td className="px-4 py-3.5 text-xs text-[var(--tx-m)]">{item.delaySeconds}s</td>
                        <td className="px-4 py-3.5 text-xs text-[var(--tx-m)]">
                          <div className="space-y-0.5">
                            {item.isRecurring ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-purple-500/10 px-2 py-0.5 text-[10px] font-bold text-purple-400 border border-purple-500/20">
                                <RefreshCw className="size-3" />
                                Lặp {item.repeatIntervalHours}h
                              </span>
                            ) : (
                              <span className="text-[11px] text-[var(--tx-f)]">Chạy 1 lần</span>
                            )}
                            {item.nextRunAt && (
                              <p className="text-[10px] text-[var(--tx-f)] font-mono">
                                Lần tới: {new Date(item.nextRunAt).toLocaleString("vi-VN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {item.status === "RUNNING" ? (
                              <button
                                type="button"
                                title="Tạm dừng"
                                onClick={() => pauseCampaignMutation.mutate(item.id)}
                                className="p-1.5 rounded-lg bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 transition"
                              >
                                <Pause className="size-4" />
                              </button>
                            ) : (
                              <button
                                type="button"
                                title="Bắt đầu chạy"
                                onClick={() => startCampaignMutation.mutate(item.id)}
                                className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 transition"
                              >
                                <Play className="size-4" />
                              </button>
                            )}

                            <button
                              type="button"
                              title="Xem Log chi tiết"
                              onClick={() => setViewLogCampaignId(item.id)}
                              className="p-1.5 rounded-lg bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 transition"
                            >
                              <Eye className="size-4" />
                            </button>

                            <button
                              type="button"
                              title="Xóa chiến dịch"
                              onClick={() => {
                                if (confirm("Bạn có chắc chắn muốn xóa chiến dịch này?")) {
                                  deleteCampaignMutation.mutate(item.id);
                                }
                              }}
                              className="p-1.5 rounded-lg bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 transition"
                            >
                              <Trash2 className="size-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* --- TAB 2: SESSIONS --- */}
      {activeTab === "sessions" && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sessions.map((s: any) => (
              <div
                key={s.id}
                className="relative overflow-hidden rounded-2xl border border-[var(--bd)] bg-[var(--surface)] p-5 shadow-md space-y-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-xl bg-orange-500/10 text-orange-500 font-black text-sm">
                      TG
                    </div>
                    <div>
                      <p className="font-bold text-sm text-[var(--tx)]">{s.phoneNumber}</p>
                      <p className="text-xs text-[var(--tx-m)]">
                        {s.telegramUsername ? `@${s.telegramUsername}` : "Chưa có username"}
                      </p>
                    </div>
                  </div>
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider",
                      s.status === "ACTIVE" ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/30" : "bg-amber-500/10 text-amber-500 border border-amber-500/30",
                    )}
                  >
                    {s.status}
                  </span>
                </div>

                <div className="text-xs space-y-1 text-[var(--tx-m)]">
                  <p>Số nhóm đã đồng bộ: <strong className="text-[var(--tx)]">{s.groupsCount}</strong></p>
                  <p>Proxy: <strong className="text-[var(--tx)]">{s.proxyUrl || "Không sử dụng"}</strong></p>
                </div>

                <div className="pt-2 border-t border-[var(--bd)] flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => syncGroupsMutation.mutate(s.id)}
                    className="flex items-center gap-1.5 rounded-xl bg-orange-500/10 px-3 py-1.5 text-xs font-bold text-orange-500 hover:bg-orange-500/20 transition"
                  >
                    <RefreshCw className="size-3.5" />
                    Đồng bộ Nhóm
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setEditProxySessionId(s.id);
                      setEditProxyUrl(s.proxyUrl || "");
                    }}
                    className="flex items-center gap-1.5 rounded-xl bg-blue-500/10 px-3 py-1.5 text-xs font-bold text-blue-500 hover:bg-blue-500/20 transition"
                  >
                    <Shield className="size-3.5" />
                    Proxy
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (confirm("Xóa tài khoản này?")) deleteSessionMutation.mutate(s.id);
                    }}
                    className="p-1.5 rounded-xl bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 transition"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* --- TAB 3: TEMPLATES --- */}
      {activeTab === "templates" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-black uppercase tracking-tight text-[var(--tx)]">Mẫu tin nhắn Quảng cáo</h2>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  if (confirm("Xóa toàn bộ mẫu tin quảng cáo? Các chiến dịch đang dùng các mẫu này cũng sẽ bị xóa. Tiếp tục?")) {
                    deleteAllTemplatesMutation.mutate();
                  }
                }}
                disabled={templates.length === 0 || deleteAllTemplatesMutation.isPending || loadingTemplates}
                className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2 text-xs font-black uppercase tracking-wider text-rose-500 shadow-sm transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 className="size-4" />
                {deleteAllTemplatesMutation.isPending ? "Đang xóa..." : "Xóa toàn bộ"}
              </button>
              <button
                type="button"
                onClick={() => setAddTemplateModal(true)}
                className="flex items-center gap-2 rounded-xl bg-orange-500 px-3.5 py-2 text-xs font-black uppercase tracking-wider text-white shadow-md hover:brightness-110"
              >
                <Plus className="size-4" />
                Thêm mẫu mới
              </button>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((t: any) => (
              <div key={t.id} className="rounded-2xl border border-[var(--bd)] bg-[var(--surface)] p-5 shadow-md space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-sm text-[var(--tx)]">{t.name}</h3>
                  <span className="rounded-full bg-slate-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-orange-500">
                    {t.type}
                  </span>
                </div>
                {t.type === "SPINTAX_TEXT" ? (
                  <p className="text-xs text-[var(--tx-m)] line-clamp-3 bg-slate-500/5 p-3 rounded-xl border border-[var(--bd)] font-mono">
                    {t.content}
                  </p>
                ) : (
                  <div className="text-xs text-[var(--tx-m)] bg-slate-500/5 p-3 rounded-xl border border-[var(--bd)]">
                    <p className="font-bold text-orange-500">Forward từ Saved Messages</p>
                    <p className="line-clamp-2 italic">{t.savedMessageText || `Msg ID: ${t.savedMessageId}`}</p>
                  </div>
                )}
                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm("Xóa mẫu này?")) deleteTemplateMutation.mutate(t.id);
                    }}
                    className="p-1.5 rounded-lg bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 transition"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* --- TAB 4: GROUPS --- */}
      {activeTab === "groups" && (
        <div className="space-y-4">
          <div className="overflow-hidden rounded-2xl border border-[var(--bd)] bg-[var(--surface)] shadow-lg">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[var(--bd)] bg-slate-500/5 text-[10px] font-black uppercase tracking-wider text-[var(--tx-f)]">
                <tr>
                  <th className="px-4 py-3">Tên nhóm</th>
                  <th className="px-4 py-3">Chat ID</th>
                  <th className="px-4 py-3">Thành viên</th>
                  <th className="px-4 py-3">Loại nhóm</th>
                  <th className="px-4 py-3">Ngày đồng bộ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--bd)]">
                {groups.map((g: any) => (
                  <tr key={g.id} className="transition hover:bg-slate-500/5">
                    <td className="px-4 py-3 font-bold text-[var(--tx)]">{g.title}</td>
                    <td className="px-4 py-3 text-xs text-[var(--tx-m)] font-mono">{g.telegramChatId}</td>
                    <td className="px-4 py-3 text-xs text-[var(--tx-m)]">{g.memberCount ? `${g.memberCount} thành viên` : "-"}</td>
                    <td className="px-4 py-3 text-xs">
                      <span className="rounded-full bg-slate-500/10 px-2 py-0.5 text-[9px] font-bold">
                        {g.isSupergroup ? "Supergroup" : "Group"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--tx-m)]">
                      {new Date(g.syncedAt).toLocaleString("vi-VN")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* --- TAB 5: GUIDE & API TUTORIAL --- */}
      {activeTab === "guide" && (
        <div className="space-y-6">
          {/* Header Card */}
          <div className="rounded-3xl border border-purple-500/20 bg-gradient-to-r from-purple-500/10 via-indigo-500/5 to-transparent p-6 shadow-xl backdrop-blur-xl">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/30 bg-purple-500/10 px-3 py-1 text-xs font-black text-purple-400">
                  <BookOpenText className="size-3.5" />
                  HƯỚNG DẪN VẬN HÀNH & LẤY API TELEGRAM
                </div>
                <h2 className="text-xl font-black uppercase tracking-tight text-[var(--tx)]">
                  Cẩm Nang Hướng Dẫn Kỹ Thuật Tele Campaign v2.0
                </h2>
                <p className="text-xs font-medium text-[var(--tx-m)]">
                  Chi tiết từng bước lấy mã API cá nhân Telegram miễn phí & các bước tạo chiến dịch phát tin tự động an toàn 100%.
                </p>
              </div>

              <a
                href="https://my.telegram.org"
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 px-5 py-3 text-xs font-black uppercase tracking-wider text-white shadow-lg hover:brightness-110 transition shrink-0"
              >
                <ExternalLink className="size-4" />
                Mở Trang my.telegram.org
              </a>
            </div>
          </div>

          {/* Section 1: How to get API ID & API HASH */}
          <div className="rounded-3xl border border-[var(--bd)] bg-[var(--surface)] p-6 shadow-lg space-y-5">
            <div className="flex items-center gap-3 border-b border-[var(--bd)] pb-4">
              <div className="flex size-10 items-center justify-center rounded-2xl bg-orange-500/10 text-orange-500 font-bold">
                <KeyRound className="size-5" />
              </div>
              <div>
                <h3 className="text-base font-black uppercase tracking-wide text-[var(--tx)]">
                  Phần 1: Cách Lấy App API ID & API Hash (Miễn Phí 100%)
                </h3>
                <p className="text-xs text-[var(--tx-m)]">
                  Lấy mã API cá nhân từ Telegram chính thức để tăng độ tin cậy và chống quét tài khoản.
                </p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-[var(--bd)] bg-[var(--bg)] p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="flex size-6 items-center justify-center rounded-full bg-orange-500 text-[11px] font-black text-white">1</span>
                  <h4 className="text-xs font-black uppercase text-[var(--tx)]">Truy cập Cổng Telegram API</h4>
                </div>
                <p className="text-xs text-[var(--tx-m)] leading-relaxed">
                  Mở trình duyệt web và truy cập trang chính thức của Telegram tại <a href="https://my.telegram.org" target="_blank" rel="noreferrer" className="text-orange-500 font-bold underline">https://my.telegram.org</a>.
                </p>
              </div>

              <div className="rounded-2xl border border-[var(--bd)] bg-[var(--bg)] p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="flex size-6 items-center justify-center rounded-full bg-orange-500 text-[11px] font-black text-white">2</span>
                  <h4 className="text-xs font-black uppercase text-[var(--tx)]">Đăng Nhập Số Điện Thoại</h4>
                </div>
                <p className="text-xs text-[var(--tx-m)] leading-relaxed">
                  Nhập số điện thoại Telegram của bạn (có định dạng mã quốc gia, VD: <code className="text-orange-400 font-mono">+84338423660</code>) và ấn <strong>Next</strong>.
                </p>
              </div>

              <div className="rounded-2xl border border-[var(--bd)] bg-[var(--bg)] p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="flex size-6 items-center justify-center rounded-full bg-orange-500 text-[11px] font-black text-white">3</span>
                  <h4 className="text-xs font-black uppercase text-[var(--tx)]">Nhập Mã Xác Nhận (Confirmation Code)</h4>
                </div>
                <p className="text-xs text-[var(--tx-m)] leading-relaxed">
                  Mở ứng dụng Telegram trên điện thoại/máy tính, lấy chuỗi mã xác nhận gửi từ Telegram và dán vào web để Đăng nhập.
                </p>
              </div>

              <div className="rounded-2xl border border-[var(--bd)] bg-[var(--bg)] p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="flex size-6 items-center justify-center rounded-full bg-orange-500 text-[11px] font-black text-white">4</span>
                  <h4 className="text-xs font-black uppercase text-[var(--tx)]">Chọn API Development Tools</h4>
                </div>
                <p className="text-xs text-[var(--tx-m)] leading-relaxed">
                  Sau khi đăng nhập thành công, nhấn chọn mục <strong>API development tools</strong>.
                </p>
              </div>

              <div className="rounded-2xl border border-[var(--bd)] bg-[var(--bg)] p-4 space-y-2 md:col-span-2">
                <div className="flex items-center gap-2">
                  <span className="flex size-6 items-center justify-center rounded-full bg-orange-500 text-[11px] font-black text-white">5</span>
                  <h4 className="text-xs font-black uppercase text-[var(--tx)]">Tạo Ứng Dụng (Create Application)</h4>
                </div>
                <p className="text-xs text-[var(--tx-m)] leading-relaxed">
                  Điền các thông tin bất kỳ vào biểu mẫu:
                  <br />• <strong>App title</strong>: Nhập tên ứng dụng bất kỳ (VD: <code className="text-orange-400 font-mono">MySellerApp</code>)
                  <br />• <strong>Short name</strong>: Nhập tên ngắn ngẫu nhiên (VD: <code className="text-orange-400 font-mono">sellerapp</code>)
                  <br />• <strong>Platform</strong>: Chọn <code className="text-orange-400 font-mono">Web</code> hoặc <code className="text-orange-400 font-mono">Desktop</code>
                  <br />Ấn <strong>Create Application</strong>. Bạn sẽ nhìn thấy 2 chuỗi mã quan trọng: <strong className="text-emerald-400">App api_id</strong> (chuỗi số) và <strong className="text-emerald-400">App api_hash</strong> (chuỗi 32 ký tự).
                </p>
              </div>
            </div>

            {/* Pro Tip Box */}
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 flex items-start gap-3">
              <Sparkles className="size-5 text-emerald-400 shrink-0 mt-0.5" />
              <div className="text-xs text-[var(--tx-m)] leading-relaxed">
                <strong className="text-emerald-400 uppercase font-black">Mẹo Nhanh:</strong> Nếu bạn chưa muốn tạo API riêng trên my.telegram.org, bạn hoàn toàn có thể <strong>để trống ô api_id và api_hash</strong> khi kết nối SĐT. Hệ thống sẽ tự động sử dụng bộ API Key mặc định đã được cấu hình an toàn sẵn có!
              </div>
            </div>
          </div>

          {/* Section 2: 4-Step Campaign Guide */}
          <div className="rounded-3xl border border-[var(--bd)] bg-[var(--surface)] p-6 shadow-lg space-y-5">
            <div className="flex items-center gap-3 border-b border-[var(--bd)] pb-4">
              <div className="flex size-10 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-500 font-bold">
                <Radio className="size-5" />
              </div>
              <div>
                <h3 className="text-base font-black uppercase tracking-wide text-[var(--tx)]">
                  Phần 2: Quy Trình 4 Bước Vận Hành Chiến Dịch Tele Campaign
                </h3>
                <p className="text-xs text-[var(--tx-m)]">
                  Hướng dẫn từng bước từ thêm tài khoản đến phát tin nhắn hàng loạt tự động.
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl border border-[var(--bd)] bg-[var(--bg)] p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="flex size-7 items-center justify-center rounded-xl bg-blue-500 text-xs font-black text-white">B1</span>
                  <h4 className="text-xs font-black uppercase text-[var(--tx)]">Kết nối Tài khoản</h4>
                </div>
                <p className="text-xs text-[var(--tx-m)] leading-relaxed">
                  Vào tab <strong>Tài khoản Telegram</strong>, nhập SĐT và mã OTP gửi về app Telegram để đăng nhập. Gắn Proxy nếu dùng nhiều acc.
                </p>
              </div>

              <div className="rounded-2xl border border-[var(--bd)] bg-[var(--bg)] p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="flex size-7 items-center justify-center rounded-xl bg-blue-500 text-xs font-black text-white">B2</span>
                  <h4 className="text-xs font-black uppercase text-[var(--tx)]">Đồng bộ Nhóm</h4>
                </div>
                <p className="text-xs text-[var(--tx-m)] leading-relaxed">
                  Ấn nút <strong>Đồng bộ Nhóm</strong> tại dòng tài khoản vừa thêm để quét toàn bộ các nhóm Telegram cá nhân bạn đã tham gia.
                </p>
              </div>

              <div className="rounded-2xl border border-[var(--bd)] bg-[var(--bg)] p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="flex size-7 items-center justify-center rounded-xl bg-blue-500 text-xs font-black text-white">B3</span>
                  <h4 className="text-xs font-black uppercase text-[var(--tx)]">Tạo Mẫu Tin Nhắn</h4>
                </div>
                <p className="text-xs text-[var(--tx-m)] leading-relaxed">
                  Vào tab <strong>Mẫu tin nhắn</strong>, tạo nội dung Text dạng Spintax <code className="text-orange-400 font-mono font-bold">{`{Chào|Hi}`}</code> hoặc chọn Forward bài đẹp từ <strong>Saved Messages</strong>.
                </p>
              </div>

              <div className="rounded-2xl border border-[var(--bd)] bg-[var(--bg)] p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="flex size-7 items-center justify-center rounded-xl bg-blue-500 text-xs font-black text-white">B4</span>
                  <h4 className="text-xs font-black uppercase text-[var(--tx)]">Chạy Chiến Dịch</h4>
                </div>
                <p className="text-xs text-[var(--tx-m)] leading-relaxed">
                  Vào tab <strong>Chiến dịch phát tin</strong>, chọn Mẫu tin + Nhóm nhận, cài đặt Delay trễ (30-60s) và ấn <strong>Bắt đầu chạy</strong> 24/7!
                </p>
              </div>
            </div>
          </div>

          {/* Section 3: Safety & Anti-Ban Rules */}
          <div className="rounded-3xl border border-[var(--bd)] bg-[var(--surface)] p-6 shadow-lg space-y-4">
            <div className="flex items-center gap-3 border-b border-[var(--bd)] pb-4">
              <div className="flex size-10 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-500 font-bold">
                <Shield className="size-5" />
              </div>
              <div>
                <h3 className="text-base font-black uppercase tracking-wide text-[var(--tx)]">
                  Phần 3: Nguyên Tắc An Toàn & Chống Banned Tài Khoản
                </h3>
                <p className="text-xs text-[var(--tx-m)]">
                  Các khuyến nghị quan trọng giúp tài khoản vận hành bền bỉ 24/7.
                </p>
              </div>
            </div>

            <div className="space-y-2.5 text-xs text-[var(--tx-m)]">
              <div className="flex items-start gap-2.5 rounded-xl border border-[var(--bd)] bg-[var(--bg)] p-3">
                <CheckCircle2 className="size-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <strong className="text-[var(--tx)]">Cài đặt Thời gian giãn cách (Delay):</strong> Nên đặt tối thiểu từ <strong>30 - 60 giây</strong> giữa mỗi nhóm để tránh bị hệ thống Telegram gắn cờ gửi quá nhanh.
                </div>
              </div>

              <div className="flex items-start gap-2.5 rounded-xl border border-[var(--bd)] bg-[var(--bg)] p-3">
                <CheckCircle2 className="size-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <strong className="text-[var(--tx)]">Sử dụng Spintax linh hoạt:</strong> Đưa cú pháp xoay từ <code className="text-orange-400 font-mono">{`{Xin chào|Chào bạn|Hi anh em}`}</code> vào mẫu tin nhắn để mọi tin gửi đi đều độc nhất.
                </div>
              </div>

              <div className="flex items-start gap-2.5 rounded-xl border border-[var(--bd)] bg-[var(--bg)] p-3">
                <CheckCircle2 className="size-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <strong className="text-[var(--tx)]">Sử dụng Proxy riêng biệt:</strong> Khi nuôi từ 2 tài khoản Telegram trở lên, nên trang bị Proxy riêng cho từng tài khoản tại nút <strong>Cấu hình Proxy</strong> để cách ly địa chỉ IP.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL ADD SESSION (OTP) --- */}
      {addSessionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-md my-auto space-y-4 rounded-3xl border border-[var(--bd)] bg-[var(--surface)] p-6 shadow-2xl max-h-[90vh] overflow-y-auto custom-scrollbar">
            <div className="flex items-center justify-between border-b border-[var(--bd)] pb-3">
              <h3 className="text-lg font-black uppercase tracking-tight text-[var(--tx)]">
                Kết nối Tài khoản Telegram
              </h3>
              <button type="button" onClick={() => setAddSessionModal(false)} className="text-[var(--tx-m)] hover:text-[var(--tx)]">
                <X className="size-5" />
              </button>
            </div>

            {authError && <div className="rounded-xl bg-rose-500/10 p-3 text-xs font-bold text-rose-500">{authError}</div>}
            {authSuccess && <div className="rounded-xl bg-emerald-500/10 p-3 text-xs font-bold text-emerald-500">{authSuccess}</div>}

            {otpStep === "phone" ? (
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-[var(--tx-m)]">api_id</label>
                  <input
                    type="number"
                    placeholder="2040 (Mặc định hệ thống nếu để trống)"
                    value={apiIdInput}
                    onChange={(e) => setApiIdInput(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-[var(--bd)] bg-[var(--bg)] px-4 py-2.5 text-sm font-medium focus:border-orange-500 outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-[var(--tx-m)]">api_hash</label>
                  <input
                    type="text"
                    placeholder="b18441a1ed609e1201303ec84116b674 (Mặc định hệ thống nếu để trống)"
                    value={apiHashInput}
                    onChange={(e) => setApiHashInput(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-[var(--bd)] bg-[var(--bg)] px-4 py-2.5 text-sm font-medium focus:border-orange-500 outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-[var(--tx-m)]">Số điện thoại</label>
                  <input
                    type="text"
                    placeholder="+84..."
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-[var(--bd)] bg-[var(--bg)] px-4 py-2.5 text-sm font-medium focus:border-orange-500 outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-[var(--tx-m)]">
                    Limit/ngày <span className="text-[10px] text-[var(--tx-f)] font-normal">(để chỉnh sửa vui lòng nâng cấp gói)</span>
                  </label>
                  <input
                    type="text"
                    value="20"
                    disabled
                    className="mt-1 w-full rounded-xl border border-[var(--bd)] bg-[var(--bg)]/50 px-4 py-2.5 text-sm font-medium text-[var(--tx-f)] outline-none cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-[var(--tx-m)]">Proxy (HTTP/SOCKS5 - Tùy chọn)</label>
                  <input
                    type="text"
                    placeholder="http://user:pass@ip:port"
                    value={proxyUrlInput}
                    onChange={(e) => setProxyUrlInput(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-[var(--bd)] bg-[var(--bg)] px-4 py-2.5 text-sm font-medium focus:border-orange-500 outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => sendOtpMutation.mutate()}
                  disabled={sendOtpMutation.isPending || !phone}
                  className="w-full rounded-xl bg-orange-500 py-3 text-xs font-black uppercase tracking-wider text-white shadow-lg hover:brightness-110 disabled:opacity-50"
                >
                  {sendOtpMutation.isPending ? "Đang gửi OTP..." : "Gửi mã OTP"}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-[var(--tx-m)]">Mã OTP (5 chữ số)</label>
                  <input
                    type="text"
                    placeholder="12345"
                    value={phoneCode}
                    onChange={(e) => setPhoneCode(e.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-[var(--bd)] bg-[var(--bg)] px-4 py-2.5 text-sm font-medium focus:border-orange-500 outline-none"
                  />
                </div>

                {requires2FA && (
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-[var(--tx-m)]">Mật khẩu 2FA Telegram</label>
                    <input
                      type="password"
                      placeholder="Mật khẩu 2FA"
                      value={password2FA}
                      onChange={(e) => setPassword2FA(e.target.value)}
                      className="mt-1.5 w-full rounded-xl border border-[var(--bd)] bg-[var(--bg)] px-4 py-2.5 text-sm font-medium focus:border-orange-500 outline-none"
                    />
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setOtpStep("phone");
                      setAuthError(null);
                      setAuthSuccess(null);
                      setPhoneCode("");
                    }}
                    className="w-1/3 rounded-xl border border-[var(--bd)] bg-slate-500/10 py-3 text-xs font-bold text-[var(--tx-m)] hover:bg-slate-500/20 transition"
                  >
                    Gửi lại mã
                  </button>
                  <button
                    type="button"
                    onClick={() => verifyOtpMutation.mutate()}
                    disabled={verifyOtpMutation.isPending || !phoneCode}
                    className="w-2/3 rounded-xl bg-orange-500 py-3 text-xs font-black uppercase tracking-wider text-white shadow-lg hover:brightness-110 disabled:opacity-50"
                  >
                    {verifyOtpMutation.isPending ? "Xác minh..." : "Xác nhận Đăng nhập"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* --- MODAL ADD TEMPLATE --- */}
      {addTemplateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-lg my-auto space-y-4 rounded-3xl border border-[var(--bd)] bg-[var(--surface)] p-6 shadow-2xl max-h-[90vh] overflow-y-auto custom-scrollbar">
            <div className="flex items-center justify-between border-b border-[var(--bd)] pb-3">
              <h3 className="text-lg font-black uppercase tracking-tight text-[var(--tx)]">Tạo Mẫu Tin nhắn Quảng cáo</h3>
              <button type="button" onClick={() => setAddTemplateModal(false)} className="text-[var(--tx-m)] hover:text-[var(--tx)]">
                <X className="size-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-[var(--tx-m)]">Tên mẫu</label>
                <input
                  type="text"
                  placeholder="Ví dụ: Mẫu rải nhóm GPT-4o"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-[var(--bd)] bg-[var(--bg)] px-4 py-2.5 text-sm font-medium focus:border-orange-500 outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-[var(--tx-m)]">Kiểu mẫu</label>
                <select
                  value={templateType}
                  onChange={(e: any) => setTemplateType(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-[var(--bd)] bg-[var(--bg)] px-4 py-2.5 text-sm font-medium focus:border-orange-500 outline-none"
                >
                  <option value="SPINTAX_TEXT">Text / Spintax (Gõ chữ + xoay từ {`{Chào|Hi}`})</option>
                  <option value="FORWARD_SAVED_MESSAGE">Forward từ "Tin nhắn đã lưu" (Telegram Saved Messages)</option>
                </select>
              </div>

              {templateType === "SPINTAX_TEXT" ? (
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-[var(--tx-m)]">Nội dung (Hỗ trợ Spintax)</label>
                  <textarea
                    rows={5}
                    placeholder="{Chào bạn|Hi bro}! Shop đang bán ChatGPT Premium giá rẻ tại t.me/MyShopBot"
                    value={templateContent}
                    onChange={(e) => setTemplateContent(e.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-[var(--bd)] bg-[var(--bg)] p-3 text-sm font-mono focus:border-orange-500 outline-none"
                  />
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-[var(--tx-m)]">Chọn tài khoản Telegram</label>
                    <select
                      value={selectedSessionForSaved}
                      onChange={(e) => setSelectedSessionForSaved(e.target.value)}
                      className="mt-1.5 w-full rounded-xl border border-[var(--bd)] bg-[var(--bg)] px-4 py-2.5 text-sm font-medium focus:border-orange-500 outline-none"
                    >
                      <option value="">-- Chọn tài khoản --</option>
                      {sessions.map((s: any) => (
                        <option key={s.id} value={s.id}>{s.phoneNumber}</option>
                      ))}
                    </select>
                  </div>

                  {selectedSessionForSaved && (
                    <div>
                      <label className="text-xs font-bold uppercase tracking-wider text-[var(--tx-m)]">
                        Chọn bài mẫu trong "Tin nhắn đã lưu"
                      </label>
                      {fetchingSaved ? (
                        <p className="text-xs text-orange-500 py-2">Đang đồng bộ tin nhắn đã lưu...</p>
                      ) : (
                        <select
                          value={selectedSavedMsgId}
                          onChange={(e) => {
                            const id = e.target.value;
                            setSelectedSavedMsgId(id);
                            const found = savedMessages.find((m: any) => m.id === id);
                            setSelectedSavedMsgText(found?.text || "");
                          }}
                          className="mt-1.5 w-full rounded-xl border border-[var(--bd)] bg-[var(--bg)] px-4 py-2.5 text-sm font-medium focus:border-orange-500 outline-none"
                        >
                          <option value="">-- Chọn tin nhắn --</option>
                          {savedMessages.map((m: any) => (
                            <option key={m.id} value={m.id}>
                              [{m.id}] {m.text.slice(0, 40)}...
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={() => createTemplateMutation.mutate()}
                disabled={createTemplateMutation.isPending || !templateName}
                className="w-full rounded-xl bg-orange-500 py-3 text-xs font-black uppercase tracking-wider text-white shadow-lg hover:brightness-110 disabled:opacity-50"
              >
                Lưu Mẫu Tin nhắn
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL ADD CAMPAIGN --- */}
      {addCampaignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-xl space-y-4 rounded-3xl border border-[var(--bd)] bg-[var(--surface)] p-6 shadow-2xl max-h-[90vh] overflow-y-auto custom-scrollbar">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black uppercase tracking-tight text-[var(--tx)]">Khởi tạo Chiến dịch Rải Nhóm</h3>
              <button type="button" onClick={() => setAddCampaignModal(false)} className="text-[var(--tx-m)] hover:text-[var(--tx)]">
                <X className="size-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-[var(--tx-m)]">Tên chiến dịch</label>
                <input
                  type="text"
                  placeholder="Ví dụ: Chiến dịch rải nhóm buổi tối"
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-[var(--bd)] bg-[var(--bg)] px-4 py-2.5 text-sm font-medium focus:border-orange-500 outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-[var(--tx-m)]">Chọn tài khoản Telegram gửi tin</label>
                <select
                  value={selectedSessionId}
                  onChange={(e) => setSelectedSessionId(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-[var(--bd)] bg-[var(--bg)] px-4 py-2.5 text-sm font-medium focus:border-orange-500 outline-none"
                >
                  <option value="">-- Chọn tài khoản --</option>
                  {sessions.map((s: any) => (
                    <option key={s.id} value={s.id}>{s.phoneNumber} ({s.groupsCount} nhóm)</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-[var(--tx-m)]">Chọn mẫu tin nhắn</label>
                <select
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-[var(--bd)] bg-[var(--bg)] px-4 py-2.5 text-sm font-medium focus:border-orange-500 outline-none"
                >
                  <option value="">-- Chọn mẫu --</option>
                  {templates.map((t: any) => (
                    <option key={t.id} value={t.id}>{t.name} [{t.type}]</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-[var(--tx-m)]">
                  Độ trễ giữa mỗi tin nhắn: <strong className="text-orange-500">{delaySeconds} giây</strong>
                </label>
                <input
                  type="range"
                  min={15}
                  max={300}
                  step={5}
                  value={delaySeconds}
                  onChange={(e) => setDelaySeconds(Number(e.target.value))}
                  className="mt-2 w-full accent-orange-500"
                />
              </div>

              {/* Scheduled Execution */}
              <div className="space-y-2 rounded-2xl border border-[var(--bd)] bg-slate-500/5 p-3.5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isScheduled}
                    onChange={(e) => setIsScheduled(e.target.checked)}
                    className="rounded accent-orange-500"
                  />
                  <span className="text-xs font-black uppercase tracking-wider text-[var(--tx)] flex items-center gap-1.5">
                    <Clock className="size-3.5 text-orange-500" />
                    Hẹn giờ phát tin (Tùy chọn)
                  </span>
                </label>
                {isScheduled && (
                  <input
                    type="datetime-local"
                    value={scheduleTimeInput}
                    onChange={(e) => setScheduleTimeInput(e.target.value)}
                    className="w-full rounded-xl border border-[var(--bd)] bg-[var(--bg)] px-3 py-2 text-xs font-medium focus:border-orange-500 outline-none"
                  />
                )}
              </div>

              {/* Recurring Loop */}
              <div className="space-y-2 rounded-2xl border border-[var(--bd)] bg-slate-500/5 p-3.5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isRecurring}
                    onChange={(e) => setIsRecurring(e.target.checked)}
                    className="rounded accent-orange-500"
                  />
                  <span className="text-xs font-black uppercase tracking-wider text-[var(--tx)] flex items-center gap-1.5">
                    <RefreshCw className="size-3.5 text-orange-500" />
                    Tự động lặp lại chiến dịch
                  </span>
                </label>
                {isRecurring && (
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-[var(--tx-m)]">Chu kỳ lặp lại (sau khi hoàn thành)</label>
                    <select
                      value={repeatIntervalHours}
                      onChange={(e) => setRepeatIntervalHours(Number(e.target.value))}
                      className="w-full rounded-xl border border-[var(--bd)] bg-[var(--bg)] px-3 py-2 text-xs font-medium focus:border-orange-500 outline-none"
                    >
                      <option value={1}>Mỗi 1 giờ</option>
                      <option value={3}>Mỗi 3 giờ</option>
                      <option value={6}>Mỗi 6 giờ</option>
                      <option value={12}>Mỗi 12 giờ</option>
                      <option value={24}>Mỗi 24 giờ (Hàng ngày)</option>
                      <option value={48}>Mỗi 48 giờ (Mỗi 2 ngày)</option>
                      <option value={168}>Mỗi 168 giờ (Hàng tuần)</option>
                    </select>
                  </div>
                )}
              </div>

              {selectedSessionId && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-[var(--tx-m)]">
                      Chọn nhóm Telegram mục tiêu ({selectedGroupIds.length}/{groups.length})
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        if (selectedGroupIds.length === groups.length) setSelectedGroupIds([]);
                        else setSelectedGroupIds(groups.map((g: any) => g.telegramChatId));
                      }}
                      className="text-xs text-orange-500 font-bold hover:underline"
                    >
                      {selectedGroupIds.length === groups.length ? "Bỏ chọn tất cả" : "Chọn tất cả"}
                    </button>
                  </div>

                  <div className="max-h-48 overflow-y-auto rounded-xl border border-[var(--bd)] bg-[var(--bg)] p-3 space-y-2 custom-scrollbar">
                    {groups.map((g: any) => {
                      const isSelected = selectedGroupIds.includes(g.telegramChatId);
                      return (
                        <label key={g.id} className="flex items-center gap-2.5 text-xs text-[var(--tx)] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              if (e.target.checked) setSelectedGroupIds([...selectedGroupIds, g.telegramChatId]);
                              else setSelectedGroupIds(selectedGroupIds.filter((id) => id !== g.telegramChatId));
                            }}
                            className="rounded accent-orange-500"
                          />
                          <span className="font-bold truncate">{g.title}</span>
                          <span className="text-[var(--tx-f)] text-[10px]">({g.memberCount || 0} mems)</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() => createCampaignMutation.mutate()}
                disabled={createCampaignMutation.isPending || !campaignName || !selectedSessionId || !selectedTemplateId || selectedGroupIds.length === 0}
                className="w-full rounded-xl bg-orange-500 py-3 text-xs font-black uppercase tracking-wider text-white shadow-lg hover:brightness-110 disabled:opacity-50"
              >
                {isScheduled ? "Tạo & đặt lịch chạy" : "Tạo Chiến dịch"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL LOG VIEW --- */}
      {viewLogCampaignId && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/60 backdrop-blur-sm">
          <div className="h-full w-full max-w-xl border-l border-[var(--bd)] bg-[var(--surface)] p-6 shadow-2xl flex flex-col space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--bd)] pb-4">
              <h3 className="text-lg font-black uppercase tracking-tight text-[var(--tx)]">
                Nhật ký Phát tin nhắn Real-time
              </h3>
              <button type="button" onClick={() => setViewLogCampaignId(null)} className="text-[var(--tx-m)] hover:text-[var(--tx)]">
                <X className="size-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 rounded-xl bg-black/90 p-4 font-mono text-xs text-slate-200 custom-scrollbar">
              {campaignLogs.length === 0 ? (
                <p className="text-slate-500">Chưa có nhật ký nào được ghi nhận...</p>
              ) : (
                campaignLogs.map((log: any) => (
                  <div key={log.id} className="flex items-start gap-2 border-b border-white/5 pb-2">
                    <span className="text-slate-500 font-bold">[{new Date(log.sentAt).toLocaleTimeString()}]</span>
                    {log.status === "SUCCESS" ? (
                      <span className="text-emerald-400 font-bold">[SUCCESS]</span>
                    ) : (
                      <span className="text-rose-400 font-bold">[FAILED]</span>
                    )}
                    <span className="text-white font-bold">{log.groupTitle}:</span>
                    <span className="text-slate-300">{log.errorDetail || "Đã phát tin nhắn thành công."}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL EDIT PROXY --- */}
      {editProxySessionId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md space-y-4 rounded-3xl border border-[var(--bd)] bg-[var(--surface)] p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black uppercase tracking-tight text-[var(--tx)]">Cấu hình Proxy</h3>
              <button type="button" onClick={() => setEditProxySessionId(null)} className="text-[var(--tx-m)] hover:text-[var(--tx)]">
                <X className="size-5" />
              </button>
            </div>

            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-[var(--tx-m)]">Proxy URL (HTTP/SOCKS5)</label>
              <input
                type="text"
                placeholder="http://user:pass@ip:port"
                value={editProxyUrl}
                onChange={(e) => setEditProxyUrl(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-[var(--bd)] bg-[var(--bg)] px-4 py-2.5 text-sm font-medium focus:border-orange-500 outline-none"
              />
            </div>

            <button
              type="button"
              onClick={() => saveProxyMutation.mutate()}
              disabled={saveProxyMutation.isPending}
              className="w-full rounded-xl bg-orange-500 py-3 text-xs font-black uppercase tracking-wider text-white shadow-lg hover:brightness-110"
            >
              Lưu cấu hình Proxy
            </button>
          </div>
        </div>
      )}
      {/* --- MODAL ACTIVATE LICENSE --- */}
      {activateLicenseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md space-y-4 rounded-3xl border border-[var(--bd)] bg-[var(--surface)] p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--bd)] pb-3">
              <h3 className="text-lg font-black uppercase tracking-tight text-[var(--tx)]">
                Kích hoạt Key License Tele Campaign
              </h3>
              <button type="button" onClick={() => setActivateLicenseModal(false)} className="text-[var(--tx-m)] hover:text-[var(--tx)]">
                <X className="size-5" />
              </button>
            </div>

            {licenseError && <div className="rounded-xl bg-rose-500/10 p-3 text-xs font-bold text-rose-500">{licenseError}</div>}

            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-[var(--tx-m)]">Mã Key License</label>
                <input
                  type="text"
                  placeholder="UB-PLUS-XXXXXXXX..."
                  value={licenseCodeInput}
                  onChange={(e) => setLicenseCodeInput(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-[var(--bd)] bg-[var(--bg)] px-4 py-2.5 text-sm font-mono focus:border-purple-500 outline-none uppercase"
                />
              </div>

              <div className="rounded-2xl bg-slate-500/5 p-3 text-[11px] text-[var(--tx-m)] space-y-1">
                <p className="font-bold text-[var(--tx)]">Thông tin các gói License:</p>
                <p>• <strong>Gói PLUS</strong>: 1 tài khoản Telegram, 1 chiến dịch</p>
                <p>• <strong>Gói PRO</strong>: 3 tài khoản Telegram, 5 chiến dịch</p>
                <p>• <strong>Gói UNLIMITED</strong>: Không giới hạn tài khoản & chiến dịch</p>
              </div>

              <button
                type="button"
                onClick={() => activateLicenseMutation.mutate()}
                disabled={activateLicenseMutation.isPending || !licenseCodeInput}
                className="w-full rounded-xl bg-purple-600 py-3 text-xs font-black uppercase tracking-wider text-white shadow-lg hover:brightness-110 disabled:opacity-50"
              >
                {activateLicenseMutation.isPending ? "Đang kích hoạt..." : "Xác nhận Kích hoạt Key"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
