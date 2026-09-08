import React, { useRef, useState } from "react";
import { Bold, Italic, Link2, Sparkles, HelpCircle, X, Check } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

interface TelegramRichEditorProps {
  label: string;
  hint?: string;
  description?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  botUsername?: string;
}

const COMMON_FALLBACKS = [
  "⭐️",
  "👑",
  "🔥",
  "💎",
  "🚨",
  "⚡️",
  "⬇️",
  "➡️",
  "💳",
  "🔔",
  "✅",
  "🎉",
  "0",
  "9",
];

export function TelegramRichEditor({
  label,
  hint,
  description,
  value,
  onChange,
  placeholder,
  rows = 4,
  botUsername,
}: TelegramRichEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showEmojiModal, setShowEmojiModal] = useState(false);
  const [emojiId, setEmojiId] = useState("");
  const [fallbackIcon, setFallbackIcon] = useState("⭐️");
  const [showTip, setShowTip] = useState(false);
  const [savedSelection, setSavedSelection] = useState<{
    start: number;
    end: number;
  }>({
    start: 0,
    end: 0,
  });

  const updateSelection = () => {
    if (textareaRef.current) {
      setSavedSelection({
        start: textareaRef.current.selectionStart,
        end: textareaRef.current.selectionEnd,
      });
    }
  };

  const openEmojiModal = () => {
    updateSelection();
    setEmojiId("");
    setShowEmojiModal(true);
  };

  const handleInsertEmoji = () => {
    const cleanId = emojiId.trim();
    if (!cleanId) return;
    const cleanFallback = fallbackIcon.trim() || "⭐️";
    const tag = `<tg-emoji emoji-id="${cleanId}">${cleanFallback}</tg-emoji>`;

    const start = savedSelection.start;
    const end = savedSelection.end;
    const currentVal = value || "";
    const nextVal = currentVal.slice(0, start) + tag + currentVal.slice(end);

    onChange(nextVal);
    setShowEmojiModal(false);
    setEmojiId("");

    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        const nextCursor = start + tag.length;
        textareaRef.current.setSelectionRange(nextCursor, nextCursor);
      }
    }, 50);
  };

  const wrapSelection = (
    openTag: string,
    closeTag: string,
    defaultText = "nội dung",
  ) => {
    const el = textareaRef.current;
    const currentVal = value || "";
    const start = el ? el.selectionStart : currentVal.length;
    const end = el ? el.selectionEnd : currentVal.length;
    const selected = currentVal.slice(start, end);
    const content = selected || defaultText;
    const insertion = `${openTag}${content}${closeTag}`;
    const nextVal =
      currentVal.slice(0, start) + insertion + currentVal.slice(end);

    onChange(nextVal);

    setTimeout(() => {
      if (el) {
        el.focus();
        el.setSelectionRange(
          start + openTag.length,
          start + openTag.length + content.length,
        );
      }
    }, 50);
  };

  const handleInsertLink = () => {
    const url = window.prompt(
      "Nhập đường dẫn liên kết (URL):",
      "https://t.me/",
    );
    if (!url) return;
    const el = textareaRef.current;
    const currentVal = value || "";
    const start = el ? el.selectionStart : currentVal.length;
    const end = el ? el.selectionEnd : currentVal.length;
    const selected = currentVal.slice(start, end) || "Xem tại đây";
    const insertion = `<a href="${url}">${selected}</a>`;
    const nextVal =
      currentVal.slice(0, start) + insertion + currentVal.slice(end);
    onChange(nextVal);
    setTimeout(() => {
      if (el) {
        el.focus();
        el.setSelectionRange(start + insertion.length, start + insertion.length);
      }
    }, 50);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label
          className="text-xs font-black uppercase tracking-wider"
          style={{ color: "var(--tx)" }}
        >
          {label}
          {hint && (
            <span className="ml-2 text-[10px] font-normal normal-case opacity-60">
              ({hint})
            </span>
          )}
        </label>

        {/* Toolbar */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={openEmojiModal}
            title="Đặt con trỏ chuột và bấm để chèn Emoji động / Huy hiệu"
            className="flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-bold text-white shadow-sm transition hover:opacity-90 active:scale-95"
            style={{
              background:
                "linear-gradient(135deg, rgb(249,115,22), rgb(234,88,12))",
            }}
          >
            <Sparkles className="h-3.5 w-3.5" />
            + Chèn Emoji Động
          </button>

          <button
            type="button"
            onClick={() => wrapSelection("<b>", "</b>", "in đậm")}
            title="In đậm (<b>...</b>)"
            className="flex h-7 w-7 items-center justify-center rounded-lg border text-xs font-bold transition hover:bg-white/10 active:scale-95"
            style={{ borderColor: "var(--bd)", color: "var(--tx)" }}
          >
            <Bold className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={() => wrapSelection("<i>", "</i>", "in nghiêng")}
            title="In nghiêng (<i>...</i>)"
            className="flex h-7 w-7 items-center justify-center rounded-lg border text-xs font-bold transition hover:bg-white/10 active:scale-95"
            style={{ borderColor: "var(--bd)", color: "var(--tx)" }}
          >
            <Italic className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={handleInsertLink}
            title="Chèn liên kết (<a href='...'>...</a>)"
            className="flex h-7 w-7 items-center justify-center rounded-lg border text-xs font-bold transition hover:bg-white/10 active:scale-95"
            style={{ borderColor: "var(--bd)", color: "var(--tx)" }}
          >
            <Link2 className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={() => setShowTip((prev) => !prev)}
            title="Cách lấy mã Emoji ID từ Telegram"
            className="flex h-7 items-center gap-1 rounded-lg border px-2 text-[11px] font-medium transition hover:bg-white/10"
            style={{
              borderColor: showTip ? "rgb(249,115,22)" : "var(--bd)",
              color: showTip ? "rgb(249,115,22)" : "var(--tx-f)",
            }}
          >
            <HelpCircle className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Mẹo lấy ID</span>
          </button>
        </div>
      </div>

      {/* Tip box */}
      {showTip && (
        <div
          className="rounded-xl border p-3 text-xs leading-relaxed transition"
          style={{
            background: "rgba(249,115,22,0.06)",
            borderColor: "rgba(249,115,22,0.25)",
            color: "var(--tx)",
          }}
        >
          <div className="font-bold text-amber-500 mb-1 flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5" />
            Cách lấy mã Emoji ID siêu nhanh:
          </div>
          <ol className="list-decimal pl-4 space-y-1 text-[11px] opacity-90">
            <li>
              Mở cuộc trò chuyện với bot Telegram của shop
              {botUsername ? (
                <span className="font-semibold text-orange-400">
                  {" "}
                  (@{botUsername})
                </span>
              ) : (
                ""
              )}
              .
            </li>
            <li>
              Gửi trực tiếp các <b>Emoji động, huy hiệu hoặc nhãn</b> bạn muốn
              lấy vào khung chat với bot.
            </li>
            <li>
              Bot sẽ tự động trả lời ngay mã <b>ID</b> và thẻ HTML. Bạn chỉ cần
              chạm vào mã để sao chép!
            </li>
            <li>
              Quay lại đây, đặt con trỏ chuột vào vị trí muốn hiển thị, bấm nút{" "}
              <b>"+ Chèn Emoji Động"</b> và dán mã ID vào.
            </li>
          </ol>
        </div>
      )}

      {/* Textarea */}
      <Textarea
        ref={textareaRef}
        rows={rows}
        className="min-h-[90px] font-mono text-xs leading-relaxed"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onSelect={updateSelection}
        onKeyUp={updateSelection}
        onMouseUp={updateSelection}
        placeholder={placeholder}
      />

      {description && (
        <p className="text-[11px]" style={{ color: "var(--tx-f)" }}>
          {description}
        </p>
      )}

      {/* Modal chèn Emoji */}
      {showEmojiModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div
            className="w-full max-w-md rounded-2xl border p-5 shadow-2xl space-y-4"
            style={{
              background: "var(--card-bg, #18181b)",
              borderColor: "var(--bd, #27272a)",
              color: "var(--tx, #fff)",
            }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between border-b pb-3"
              style={{ borderColor: "var(--bd)" }}
            >
              <div className="flex items-center gap-2">
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-xl"
                  style={{ background: "rgba(249,115,22,0.15)" }}
                >
                  <Sparkles className="h-4 w-4 text-orange-400" />
                </div>
                <div>
                  <h3 className="text-sm font-black">
                    Chèn Telegram Custom Emoji
                  </h3>
                  <p className="text-[11px]" style={{ color: "var(--tx-f)" }}>
                    Emoji động, huy hiệu badge, số neon Telegram
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowEmojiModal(false)}
                className="rounded-lg p-1 hover:bg-white/10 text-gray-400 hover:text-white transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold mb-1">
                  Mã Emoji ID (document_id){" "}
                  <span className="text-orange-400">*</span>
                </label>
                <input
                  type="text"
                  autoFocus
                  value={emojiId}
                  onChange={(e) =>
                    setEmojiId(e.target.value.replace(/\D/g, ""))
                  }
                  placeholder="VD: 5368324170671202286"
                  className="w-full rounded-xl border px-3 py-2 text-xs font-mono outline-none transition focus:border-orange-500"
                  style={{
                    background: "var(--inp, #09090b)",
                    borderColor: "var(--bd, #27272a)",
                    color: "var(--tx, #fff)",
                  }}
                />
                <p
                  className="mt-1 text-[10px]"
                  style={{ color: "var(--tx-f)" }}
                >
                  Nhập dãy số ID từ Telegram sticker pack (chỉ gồm các chữ số).
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold mb-1">
                  Icon hiển thị dự phòng (Fallback Emoji)
                </label>
                <input
                  type="text"
                  value={fallbackIcon}
                  onChange={(e) => setFallbackIcon(e.target.value)}
                  placeholder="⭐️"
                  className="w-full rounded-xl border px-3 py-2 text-xs outline-none transition focus:border-orange-500"
                  style={{
                    background: "var(--inp, #09090b)",
                    borderColor: "var(--bd, #27272a)",
                    color: "var(--tx, #fff)",
                  }}
                />
                <div className="mt-2 flex flex-wrap gap-1">
                  {COMMON_FALLBACKS.map((icon) => (
                    <button
                      key={icon}
                      type="button"
                      onClick={() => setFallbackIcon(icon)}
                      className={`h-7 w-7 rounded-lg border text-sm transition hover:scale-110 ${
                        fallbackIcon === icon
                          ? "border-orange-500 bg-orange-500/20"
                          : "border-zinc-700 bg-zinc-800/60"
                      }`}
                    >
                      {icon}
                    </button>
                  ))}
                </div>
              </div>

              {/* Live Preview */}
              <div
                className="rounded-xl border p-2.5 text-[11px] font-mono break-all"
                style={{
                  background: "rgba(0,0,0,0.3)",
                  borderColor: "var(--bd)",
                  color: "rgb(249,115,22)",
                }}
              >
                &lt;tg-emoji emoji-id=&quot;{emojiId || "ID_EMOJI"}&quot;&gt;
                {fallbackIcon || "⭐️"}&lt;/tg-emoji&gt;
              </div>
            </div>

            {/* Footer */}
            <div
              className="flex items-center justify-end gap-2 border-t pt-3"
              style={{ borderColor: "var(--bd)" }}
            >
              <button
                type="button"
                onClick={() => setShowEmojiModal(false)}
                className="rounded-xl border px-3 py-1.5 text-xs font-semibold hover:bg-white/10 transition"
                style={{ borderColor: "var(--bd)", color: "var(--tx)" }}
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={!emojiId.trim()}
                onClick={handleInsertEmoji}
                className="flex items-center gap-1.5 rounded-xl px-4 py-1.5 text-xs font-black text-white transition hover:opacity-90 disabled:opacity-40"
                style={{ background: "rgb(249,115,22)" }}
              >
                <Check className="h-3.5 w-3.5" />
                Chèn vào vị trí con trỏ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
