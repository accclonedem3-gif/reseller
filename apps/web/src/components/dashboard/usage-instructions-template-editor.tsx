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
  return ids
    .map((id) => (id.trim() ? `[cus:${id.trim().slice(0, 8)}…]` : ""))
    .filter(Boolean)
    .join("") || icon || "📖";
}

function renderPreview(t: UsageInstructionsTemplate): string {
  const emojiRow = renderHeaderEmojis(t.headerIcon, t.headerEmojiIds);
  const header = `${emojiRow} ${(t.headerText || DEFAULT_USAGE_INSTRUCTIONS.headerText).trim()}`;
  const lines = [header, "", SAMPLE_INSTRUCTIONS];
  const footer = (t.footer || "").trim();
  if (footer) lines.push("", footer);
  return lines.join("\n");
}

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
    const arr = local.headerEmojiIds.filter((_, i) => i !== idx);
    update({ headerEmojiIds: arr });
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
          <label className="block text-xs font-medium text-gray-500 mb-1">Icon (fallback)</label>
          <input
            className="w-full border rounded px-2 py-1 text-sm"
            value={local.headerIcon}
            placeholder={defaults.headerIcon}
            onChange={(e) => update({ headerIcon: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Tiêu đề</label>
          <input
            className="w-full border rounded px-2 py-1 text-sm"
            value={local.headerText}
            placeholder={defaults.headerText}
            onChange={(e) => update({ headerText: e.target.value })}
          />
        </div>
      </div>

      {/* Custom Emoji IDs */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-gray-500">
            Custom Emoji IDs (header) — nhiều ID cùng 1 hàng
          </label>
          <button
            type="button"
            onClick={addEmojiId}
            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
          >
            <Plus className="w-3 h-3" /> Thêm emoji
          </button>
        </div>
        {local.headerEmojiIds.length === 0 && (
          <p className="text-xs text-gray-400 italic">Chưa có custom emoji — dùng icon fallback ở trên.</p>
        )}
        <div className="space-y-1">
          {local.headerEmojiIds.map((id, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <span className="text-xs text-gray-400 w-5 shrink-0">#{idx + 1}</span>
              <input
                className="flex-1 border rounded px-2 py-1 text-sm font-mono"
                value={id}
                placeholder="5368324170671202286"
                onChange={(e) => setEmojiId(idx, e.target.value)}
              />
              <button
                type="button"
                onClick={() => removeEmojiId(idx)}
                className="text-red-400 hover:text-red-600"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-1">
          Các emoji ID sẽ được render liền nhau trên cùng 1 dòng với tiêu đề.
        </p>
      </div>

      {/* Footer */}
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Footer (tùy chọn)</label>
        <input
          className="w-full border rounded px-2 py-1 text-sm"
          value={local.footer}
          placeholder="Ví dụ: Liên hệ hỗ trợ nếu cần thêm trợ giúp"
          onChange={(e) => update({ footer: e.target.value })}
        />
      </div>

      {/* Preview */}
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Preview</label>
        <pre className="bg-gray-50 border rounded p-3 text-xs whitespace-pre-wrap font-mono">
          {preview}
        </pre>
        <p className="text-xs text-gray-400 mt-1">
          * Preview dùng emoji placeholder. Nội dung thực lấy từ trường "Hướng dẫn sử dụng" của mỗi sản phẩm.
        </p>
      </div>
    </div>
  );
}
