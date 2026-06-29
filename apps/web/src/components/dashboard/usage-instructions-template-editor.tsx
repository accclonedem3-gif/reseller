import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

export type UsageInstructionsTemplate = {
  headerText: string;
  headerIcon: string;
  headerEmojiIds: string[];
  footer: string;
};

export const DEFAULT_USAGE_INSTRUCTIONS: UsageInstructionsTemplate = {
  headerText: "HƯỚNG DẪN SỬ DỤNG",
  headerIcon: "📖",
  headerEmojiIds: [],
  footer: "",
};

const SAMPLE_INSTRUCTIONS =
  "1. Đăng nhập tại website chính thức\n2. Vào Settings → Account\n3. Nhập thông tin tài khoản vừa nhận\n4. Liên hệ hỗ trợ nếu gặp vấn đề";

function renderHeaderEmojis(icon: string, ids: string[]): string {
  if (!ids || ids.length === 0) return icon || "📖";
  return (
    ids
      .map((id) => (id.trim() ? `[cus:${id.trim().slice(0, 8)}…]` : ""))
      .filter(Boolean)
      .join("") || icon || "📖"
  );
}

function renderPreview(t: UsageInstructionsTemplate): string {
  const emojiRow = renderHeaderEmojis(t.headerIcon, t.headerEmojiIds);
  const header = `${emojiRow} ${(t.headerText || DEFAULT_USAGE_INSTRUCTIONS.headerText).trim()}`;
  const lines = [header, "", SAMPLE_INSTRUCTIONS];
  const footer = (t.footer || "").trim();
  if (footer) lines.push("", footer);
  return lines.join("\n");
}

const inputCls = "w-full rounded-xl px-3 py-2 text-[13px] outline-none";
const inputStyle = {
  background: "var(--inp)",
  border: "1px solid var(--bd)",
  color: "var(--tx)",
} as React.CSSProperties;
const labelStyle = {
  color: "var(--tx-f)",
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
  marginBottom: 6,
  display: "block",
};

interface Props {
  value: UsageInstructionsTemplate;
  defaults: UsageInstructionsTemplate;
  onChange: (v: UsageInstructionsTemplate) => void;
}

export function UsageInstructionsTemplateEditor({ value, defaults, onChange }: Props) {
  const [local, setLocal] = useState<UsageInstructionsTemplate>(() => ({
    ...DEFAULT_USAGE_INSTRUCTIONS,
    ...value,
    headerEmojiIds: Array.isArray(value.headerEmojiIds) ? [...value.headerEmojiIds] : [],
  }));

  useEffect(() => {
    setLocal({
      ...DEFAULT_USAGE_INSTRUCTIONS,
      ...value,
      headerEmojiIds: Array.isArray(value.headerEmojiIds) ? [...value.headerEmojiIds] : [],
    });
  }, [value]);

  function update(patch: Partial<UsageInstructionsTemplate>) {
    const next = { ...local, ...patch };
    setLocal(next);
    onChange(next);
  }

  function addEmojiId() {
    update({ headerEmojiIds: [...local.headerEmojiIds, ""] });
  }

  function removeEmojiId(idx: number) {
    update({ headerEmojiIds: local.headerEmojiIds.filter((_, i) => i !== idx) });
  }

  function setEmojiId(idx: number, val: string) {
    const arr = [...local.headerEmojiIds];
    arr[idx] = val;
    update({ headerEmojiIds: arr });
  }

  const preview = renderPreview(local);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label style={labelStyle}>Icon (fallback)</label>
          <input
            className={inputCls}
            style={inputStyle}
            value={local.headerIcon}
            placeholder={defaults.headerIcon}
            onChange={(e) => update({ headerIcon: e.target.value })}
          />
        </div>
        <div>
          <label style={labelStyle}>Tiêu đề</label>
          <input
            className={inputCls}
            style={inputStyle}
            value={local.headerText}
            placeholder={defaults.headerText}
            onChange={(e) => update({ headerText: e.target.value })}
          />
        </div>
      </div>

      {/* Custom Emoji IDs */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label style={labelStyle}>Custom Emoji IDs (header) — nhiều ID cùng 1 hàng</label>
          <button
            type="button"
            onClick={addEmojiId}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-black transition hover:opacity-80"
            style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx-m)" }}
          >
            <Plus className="w-3 h-3" /> Thêm emoji
          </button>
        </div>
        {local.headerEmojiIds.length === 0 && (
          <p className="text-[12px] italic" style={{ color: "var(--tx-f)" }}>
            Chưa có custom emoji — dùng icon fallback ở trên.
          </p>
        )}
        <div className="space-y-1.5">
          {local.headerEmojiIds.map((id, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <span className="text-[11px] w-5 shrink-0" style={{ color: "var(--tx-f)" }}>#{idx + 1}</span>
              <input
                className={`${inputCls} font-mono`}
                style={inputStyle}
                value={id}
                placeholder="5368324170671202286"
                onChange={(e) => setEmojiId(idx, e.target.value)}
              />
              <button
                type="button"
                onClick={() => removeEmojiId(idx)}
                className="shrink-0 rounded-lg p-1 transition hover:opacity-70"
                style={{ color: "rgb(239,68,68)" }}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
        <p className="text-[11px] mt-1.5" style={{ color: "var(--tx-f)" }}>
          Các emoji ID sẽ được render liền nhau trên cùng 1 dòng với tiêu đề.
        </p>
      </div>

      {/* Footer */}
      <div>
        <label style={labelStyle}>Footer (tùy chọn)</label>
        <input
          className={inputCls}
          style={inputStyle}
          value={local.footer}
          placeholder="Ví dụ: Liên hệ hỗ trợ nếu cần thêm trợ giúp"
          onChange={(e) => update({ footer: e.target.value })}
        />
      </div>

      {/* Preview */}
      <div>
        <label style={labelStyle}>Preview</label>
        <pre
          className="rounded-xl p-3 text-[12px] whitespace-pre-wrap font-mono leading-relaxed"
          style={{ background: "var(--inp)", border: "1px solid var(--bd)", color: "var(--tx)" }}
        >
          {preview}
        </pre>
        <p className="text-[11px] mt-1" style={{ color: "var(--tx-f)" }}>
          * Preview dùng nội dung mẫu. Nội dung thực lấy từ trường "Hướng dẫn sử dụng" của mỗi sản phẩm.
        </p>
      </div>
    </div>
  );
}
