import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus, Copy, Trash2, CheckCircle2, Clock, ShieldCheck, Search, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";

export function AdminUserbotLicensesPage() {
  const queryClient = useQueryClient();
  const [type, setType] = useState<"PLUS" | "PRO" | "UNLIMITED">("PLUS");
  const [durationDays, setDurationDays] = useState(30);
  const [count, setCount] = useState(1);
  const [search, setSearch] = useState("");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const { data: keys = [], isLoading } = useQuery({
    queryKey: ["admin-userbot-licenses"],
    queryFn: async () => (await api.get("/admin/userbot-licenses")).data,
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      return (
        await api.post("/admin/userbot-licenses/generate", {
          type,
          durationDays,
          count,
        })
      ).data;
    },
    onSuccess: (data) => {
      alert(`Đã tạo thành công ${data.count} mã License Key!`);
      queryClient.invalidateQueries({ queryKey: ["admin-userbot-licenses"] });
    },
    onError: (err: any) => {
      alert(err.response?.data?.message || "Tạo mã Key thất bại.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return (await api.delete(`/admin/userbot-licenses/${id}`)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-userbot-licenses"] });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async (id: string) => {
      return (await api.post(`/admin/userbot-licenses/${id}/reset`)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-userbot-licenses"] });
      alert("Đã khôi phục Key về trạng thái chưa sử dụng.");
    },
  });

  const copyToClipboard = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const filteredKeys = keys.filter((k: any) => {
    const q = search.toLowerCase();
    return (
      k.code.toLowerCase().includes(q) ||
      k.type.toLowerCase().includes(q) ||
      (k.redeemedByEmail && k.redeemedByEmail.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="relative overflow-hidden rounded-3xl border border-purple-500/20 bg-gradient-to-r from-purple-600/10 via-indigo-500/5 to-transparent p-6 shadow-xl backdrop-blur-xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/30 bg-purple-500/10 px-3 py-1 text-xs font-black text-purple-400">
              <ShieldCheck className="size-3.5" />
              SUPER ADMIN MANAGEMENT
            </div>
            <h1 className="text-2xl font-black uppercase tracking-tight text-[var(--tx)]">
              Quản lý License Key Tele Campaign
            </h1>
            <p className="text-sm font-medium text-[var(--tx-m)]">
              Khởi tạo và quản lý mã kích hoạt bản quyền tính năng Telegram Userbot Marketing.
            </p>
          </div>
        </div>
      </div>

      {/* Form Generate Key */}
      <div className="rounded-3xl border border-[var(--bd)] bg-[var(--surface)] p-6 shadow-lg space-y-4">
        <h2 className="text-sm font-black uppercase tracking-wider text-[var(--tx)] flex items-center gap-2">
          <Plus className="size-4 text-purple-500" />
          Tạo mã License Key mới
        </h2>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-[var(--tx-m)]">Loại Gói License</label>
            <select
              value={type}
              onChange={(e: any) => setType(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-[var(--bd)] bg-[var(--bg)] px-4 py-2.5 text-sm font-medium focus:border-purple-500 outline-none"
            >
              <option value="PLUS">Gói PLUS (1 Acc / 1 Campaign)</option>
              <option value="PRO">Gói PRO (3 Accs / 5 Campaigns)</option>
              <option value="UNLIMITED">Gói UNLIMITED (Không giới hạn)</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-[var(--tx-m)]">Thời hạn (ngày)</label>
            <select
              value={durationDays}
              onChange={(e) => setDurationDays(Number(e.target.value))}
              className="mt-1.5 w-full rounded-xl border border-[var(--bd)] bg-[var(--bg)] px-4 py-2.5 text-sm font-medium focus:border-purple-500 outline-none"
            >
              <option value={30}>30 ngày (1 tháng)</option>
              <option value={90}>90 ngày (3 tháng)</option>
              <option value={180}>180 ngày (6 tháng)</option>
              <option value={365}>365 ngày (1 năm)</option>
              <option value={3650}>Vĩnh viễn (10 năm)</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-[var(--tx-m)]">Số lượng Key cần tạo</label>
            <input
              type="number"
              min={1}
              max={50}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="mt-1.5 w-full rounded-xl border border-[var(--bd)] bg-[var(--bg)] px-4 py-2.5 text-sm font-medium focus:border-purple-500 outline-none"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending}
          className="flex items-center gap-2 rounded-xl bg-purple-600 px-5 py-2.5 text-xs font-black uppercase tracking-wider text-white shadow-md hover:brightness-110 disabled:opacity-50"
        >
          <KeyRound className="size-4" />
          {generateMutation.isPending ? "Đang tạo..." : `Tạo ${count} mã Key`}
        </button>
      </div>

      {/* Filter and List Keys */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="text-lg font-black uppercase tracking-tight text-[var(--tx)]">
            Danh sách License Keys ({filteredKeys.length})
          </h2>

          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-2.5 size-4 text-[var(--tx-m)]" />
            <input
              type="text"
              placeholder="Tìm theo mã Key hoặc Email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-[var(--bd)] bg-[var(--surface)] pl-9 pr-4 py-2 text-xs font-medium focus:border-purple-500 outline-none"
            />
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-[var(--bd)] bg-[var(--surface)] shadow-lg">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[var(--bd)] bg-slate-500/5 text-[10px] font-black uppercase tracking-wider text-[var(--tx-f)]">
              <tr>
                <th className="px-4 py-3">Mã Key</th>
                <th className="px-4 py-3">Gói</th>
                <th className="px-4 py-3">Thời hạn</th>
                <th className="px-4 py-3">Trạng thái</th>
                <th className="px-4 py-3">Người kích hoạt</th>
                <th className="px-4 py-3">Ngày tạo</th>
                <th className="px-4 py-3 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--bd)]">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-xs text-[var(--tx-f)]">
                    Đang tải danh sách Key...
                  </td>
                </tr>
              ) : filteredKeys.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-xs text-[var(--tx-f)]">
                    Chưa có mã Key nào.
                  </td>
                </tr>
              ) : (
                filteredKeys.map((item: any) => (
                  <tr key={item.id} className="transition hover:bg-slate-500/5">
                    <td className="px-4 py-3.5 font-mono font-bold text-[var(--tx)]">
                      <div className="flex items-center gap-2">
                        <span>{item.code}</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(item.code)}
                          className="text-[var(--tx-m)] hover:text-purple-400 p-1"
                          title="Sao chép mã"
                        >
                          {copiedCode === item.code ? (
                            <CheckCircle2 className="size-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="size-3.5" />
                          )}
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider",
                          item.type === "PLUS" && "bg-blue-500/10 text-blue-400 border border-blue-500/30",
                          item.type === "PRO" && "bg-purple-500/10 text-purple-400 border border-purple-500/30",
                          item.type === "UNLIMITED" && "bg-amber-500/10 text-amber-400 border border-amber-500/30",
                        )}
                      >
                        {item.type}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-xs text-[var(--tx-m)] font-bold">{item.durationDays} ngày</td>
                    <td className="px-4 py-3.5">
                      {item.isRedeemed ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-black uppercase text-emerald-400 border border-emerald-500/30">
                          Đã sử dụng
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-500/10 px-2.5 py-0.5 text-[10px] font-black uppercase text-slate-400 border border-slate-500/30">
                          Chưa dùng
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-xs text-[var(--tx-m)]">
                      {item.redeemedByEmail ? item.redeemedByEmail : "-"}
                    </td>
                    <td className="px-4 py-3.5 text-xs text-[var(--tx-m)]">
                      {new Date(item.createdAt).toLocaleDateString("vi-VN")}
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {item.isRedeemed && (
                          <button
                            type="button"
                            onClick={() => {
                              if (
                                confirm(
                                  "Khôi phục Key này về trạng thái chưa sử dụng?\nLƯU Ý: Người dùng đã nạp sẽ bị trừ lại số ngày tương ứng!",
                                )
                              )
                                resetMutation.mutate(item.id);
                            }}
                            className="p-1.5 rounded-lg bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 transition"
                            title="Làm mới (Reset) Key"
                          >
                            <RefreshCw className="size-4" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            if (
                              confirm(
                                item.isRedeemed
                                  ? "Thu hồi và xóa Key này vĩnh viễn?\nLƯU Ý: Người dùng đã nạp sẽ bị trừ lại số ngày tương ứng!"
                                  : "Bạn có chắc muốn xóa mã Key chưa dùng này?",
                              )
                            )
                              deleteMutation.mutate(item.id);
                          }}
                          className="p-1.5 rounded-lg bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 transition"
                          title={item.isRedeemed ? "Thu hồi Key" : "Xóa Key"}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
