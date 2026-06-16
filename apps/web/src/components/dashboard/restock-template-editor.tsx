import { useEffect, useMemo, useState } from "react";

export type RestockCustomEmojiIds = {
  header?: string;
  product?: string;
  added?: string;
  stock?: string;
};

export type RestockTemplate = {
  header: { icon: string; text: string };
  fieldIcons: { product: string; added: string; stock: string };
  labels: { added: string; stock: string };
  footer: string;
  customEmojiIds: RestockCustomEmojiIds;
};

export const RESTOCK_PLACEHOLDER_HINTS: Array<{ key: string; label: string }> = [
  { key: "{product_name}", label: "Tên sản phẩm" },
  { key: "{added}", label: "Số lượng vừa thêm" },
  { key: "{current_stock}", label: "Tồn kho hiện tại" },
];

const FIELD_LABELS: Record<keyof RestockTemplate["fieldIcons"], string> = {
  product: "Sản phẩm",
  added: "Thêm",
  stock: "Tồn kho",
};

const SAMPLE = { productName: "Slot X Premium 3 tháng | BHF", added: 50, stock: 87 };

function fillPlaceholders(raw: string): string {
  if (!raw) return "";
  return raw
    .replace(/\{product_name\}/g, SAMPLE.productName)
    .replace(/\{added\}/g, String(SAMPLE.added))
    .replace(/\{current_stock\}/g, String(SAMPLE.stock));
}

function renderPreview(t: RestockTemplate): string {
  const headerText = fillPlaceholders(t.header.text || "") || "Thông báo nhập kho!";
  const addedLabel = (t.labels.added || "").trim() || "Thêm";
  const stockLabel = (t.labels.stock || "").trim() || "Tồn kho hiện tại";
  const lines: string[] = [
    `${t.header.icon} ${headerText}`,
    "",
    `${t.fieldIcons.product} ${SAMPLE.productName}`,
    `${t.fieldIcons.added} ${addedLabel}: ${SAMPLE.added}`,
    `${t.fieldIcons.stock} ${stockLabel}: ${SAMPLE.stock}`,
  ];
  const footer = fillPlaceholders(t.footer || "").trim();
  if (footer) {
    lines.push("", footer);
  }
  return lines.join("\n");
}

interface Props {
  value: RestockTemplate;
  defaults: RestockTemplate;
  onChange: (next: RestockTemplate) => void;
  onSave: () => void;
  onReset: () => void;
  onSendTest?: () => void;
  isSaving?: boolean;
  isTesting?: boolean;
  hint?: string;
}

export function RestockTemplateEditor({
  value,
  defaults,
  onChange,
  onSave,
  onReset,
  onSendTest,
  isSaving,
  isTesting,
  hint,
}: Props) {
  const [local, setLocal] = useState<RestockTemplate>({ ...value, customEmojiIds: value.customEmojiIds ?? {} });

  useEffect(() => {
    setLocal({ ...value, customEmojiIds: value.customEmojiIds ?? {} });
  }, [JSON.stringify(value)]);

  const preview = useMemo(() => renderPreview(local), [JSON.stringify(local)]);

  function patch(p: Partial<RestockTemplate>) {
    const next: RestockTemplate = {
      ...local,
      ...p,
      header: { ...local.header, ...(p.header ?? {}) },
      fieldIcons: { ...local.fieldIcons, ...(p.fieldIcons ?? {}) },
      labels: { ...local.labels, ...(p.labels ?? {}) },
      customEmojiIds: { ...local.customEmojiIds, ...(p.customEmojiIds ?? {}) },
    };
    setLocal(next);
    onChange(next);
  }

  function patchEmojiId(key: keyof RestockCustomEmojiIds, v: string) {
    const trimmed = v.trim();
    const next = { ...local.customEmojiIds };
    if (trimmed) next[key] = trimmed;
    else delete next[key];
    patch({ customEmojiIds: next });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <Group title="Header (dòng đầu)">
            <div className="grid grid-cols-[80px_1fr] gap-2">
              <input
                value={local.header.icon}
                onChange={(e) => patch({ header: { ...local.header, icon: e.target.value } })}
                className={inputCls}
                style={inputStyle}
                placeholder="📢"
              />
              <input
                value={local.header.text}
                onChange={(e) => patch({ header: { ...local.header, text: e.target.value } })}
                className={inputCls}
                style={inputStyle}
                placeholder="Thông báo nhập kho!"
              />
            </div>
            <EmojiIdRow value={local.customEmojiIds.header} onChange={(v) => patchEmojiId("header", v)} />
            <p className="mt-1 text-[10px]" style={{ color: "var(--tx-f)" }}>
              Để trống text → dùng mặc định theo ngôn ngữ khách (vi/en/th).
            </p>
          </Group>

          <Group title="Icon từng dòng">
            <div className="space-y-1.5">
              {(Object.keys(local.fieldIcons) as Array<keyof RestockTemplate["fieldIcons"]>).map((k) => (
                <div key={k} className="grid items-center gap-2" style={{ gridTemplateColumns: "76px 56px 1fr 24px" }}>
                  <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--tx-f)" }}>
                    {FIELD_LABELS[k]}
                  </span>
                  <input
                    value={local.fieldIcons[k]}
                    onChange={(e) =>
                      patch({ fieldIcons: { ...local.fieldIcons, [k]: e.target.value } as RestockTemplate["fieldIcons"] })
                    }
                    className="rounded-lg px-1 py-1.5 text-center text-[14px] outline-none"
                    style={inputStyle}
                    title="Icon mặc định (text)"
                  />
                  <input
                    value={local.customEmojiIds[k] ?? ""}
                    onChange={(e) => patchEmojiId(k, e.target.value)}
                    placeholder="Custom emoji ID (vd: 5391...)"
                    className="rounded-lg px-2 py-1.5 font-mono text-[11px] outline-none"
                    style={{ ...inputStyle, width: "100%" }}
                    title="Telegram premium custom emoji ID"
                  />
                  {local.customEmojiIds[k] ? (
                    <span className="text-center text-[10px] font-black" style={{ color: "rgb(168,85,247)" }} title="Đang dùng custom emoji">ID</span>
                  ) : <span />}
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-[10px]" style={{ color: "var(--tx-f)" }}>
              Icon dòng sản phẩm sẽ tự ưu tiên icon riêng của từng SP nếu có. Custom Emoji ID = icon động Telegram Premium.
            </p>
          </Group>

          <Group title="Nhãn dòng (để trống = mặc định theo ngôn ngữ)">
            <div className="grid grid-cols-[76px_1fr] items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--tx-f)" }}>Thêm</span>
              <input
                value={local.labels.added}
                onChange={(e) => patch({ labels: { ...local.labels, added: e.target.value } })}
                className={inputCls}
                style={inputStyle}
                placeholder="Thêm"
              />
            </div>
            <div className="mt-1.5 grid grid-cols-[76px_1fr] items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--tx-f)" }}>Tồn kho</span>
              <input
                value={local.labels.stock}
                onChange={(e) => patch({ labels: { ...local.labels, stock: e.target.value } })}
                className={inputCls}
                style={inputStyle}
                placeholder="Tồn kho hiện tại"
              />
            </div>
          </Group>

          <Group title="Footer (dòng cuối, optional)">
            <textarea
              value={local.footer}
              onChange={(e) => patch({ footer: e.target.value })}
              className={inputCls}
              style={{ ...inputStyle, minHeight: 56 }}
              placeholder="vd: Nhanh tay kẻo hết! 🔥"
            />
            <p className="mt-1 text-[10px]" style={{ color: "var(--tx-f)" }}>
              Biến: {RESTOCK_PLACEHOLDER_HINTS.map((p) => p.key).join(" · ")}
            </p>
          </Group>
        </div>

        <div className="space-y-2">
          <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>
            Preview thông báo nhập kho
          </p>
          <p className="text-[10px]" style={{ color: "var(--tx-f)" }}>
            ⚠️ Preview chỉ hiển thị icon text. Custom emoji ID (icon động) chỉ render trong Telegram thực — bấm <b>Test</b> để xem.
          </p>
          <pre
            className="whitespace-pre-wrap rounded-xl p-4 text-[12.5px] leading-relaxed"
            style={{
              background: "var(--inp)",
              border: "1px solid var(--bd)",
              color: "var(--tx)",
              fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
            }}
          >
            {preview}
          </pre>
          <div
            className="rounded-lg px-3 py-2 text-center text-[12px] font-bold"
            style={{ background: "var(--surface)", border: "1px solid var(--bd)", color: "var(--tx-m)" }}
          >
            🛒 Mua ngay
          </div>
          <p className="text-[10px]" style={{ color: "var(--tx-f)" }}>
            Nút "Mua ngay" lấy từ nhãn nút (buttonLabels.buyNow) — chỉnh ở phần customization.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving}
          className="rounded-xl px-4 py-2 text-[13px] font-black transition hover:opacity-90 disabled:opacity-40"
          style={{ background: "rgb(16,185,129)", color: "#fff" }}
        >
          {isSaving ? "Đang lưu..." : "💾 Lưu"}
        </button>
        <button
          type="button"
          onClick={onReset}
          className="rounded-xl px-3 py-2 text-[12px] font-black transition hover:opacity-80"
          style={{ background: "var(--surface)", border: "1px solid var(--bd)", color: "var(--tx-m)" }}
        >
          🔄 Đặt lại mặc định
        </button>
        {onSendTest && (
          <button
            type="button"
            onClick={onSendTest}
            disabled={isTesting}
            className="rounded-xl px-3 py-2 text-[12px] font-black transition hover:opacity-90 disabled:opacity-40"
            style={{ background: "rgb(56,189,248)", color: "#fff" }}
          >
            {isTesting ? "Đang gửi..." : "🧪 Gửi thử"}
          </button>
        )}
      </div>

      {hint && (
        <p className="text-[11px]" style={{ color: "var(--tx-f)" }}>
          {hint}
        </p>
      )}

      {defaults && (
        <p className="text-[10px]" style={{ color: "var(--tx-f)" }}>
          Mặc định: <code className="font-mono">{JSON.stringify(defaults.header)}</code>
        </p>
      )}
    </div>
  );
}

const inputCls = "w-full rounded-lg px-2.5 py-1.5 text-[13px] outline-none";
const inputStyle: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--bd)",
  color: "var(--tx)",
};

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl p-3" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
      <p className="mb-2 text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>
        {title}
      </p>
      {children}
    </div>
  );
}

function EmojiIdRow({ value, onChange }: { value: string | undefined; onChange: (v: string) => void }) {
  return (
    <div className="mt-2 flex items-center gap-2">
      <span className="w-[72px] shrink-0 text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--tx-f)" }}>
        Emoji ID
      </span>
      <input
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Custom emoji ID Telegram Premium (optional)"
        className={`${inputCls} flex-1 font-mono text-[11px]`}
        style={inputStyle}
      />
      {value ? (
        <span className="shrink-0 rounded-md px-1.5 text-[10px] font-black" style={{ background: "rgba(168,85,247,0.15)", color: "rgb(168,85,247)" }}>ID</span>
      ) : null}
    </div>
  );
}
