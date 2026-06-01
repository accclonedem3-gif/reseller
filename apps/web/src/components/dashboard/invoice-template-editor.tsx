import { useEffect, useMemo, useState } from "react";

export type InvoiceCustomEmojiIds = {
  header?: string;
  order?: string;
  product?: string;
  quantity?: string;
  price?: string;
  warranty?: string;
  datetime?: string;
  shop?: string;
  accountBlock?: string;
};

export type InvoiceTemplate = {
  header: { icon: string; text: string };
  fieldIcons: {
    order: string;
    product: string;
    quantity: string;
    price: string;
    warranty: string;
    datetime: string;
    shop: string;
  };
  accountBlock: { icon: string; labelTemplate: string };
  footer: string;
  inlineThreshold: number;
  customEmojiIds: InvoiceCustomEmojiIds;
};

export const PLACEHOLDER_HINTS: Array<{ key: string; label: string }> = [
  { key: "{order_code}", label: "Mã đơn" },
  { key: "{product_name}", label: "Tên sản phẩm" },
  { key: "{quantity}", label: "Số lượng" },
  { key: "{total_price}", label: "Tổng tiền" },
  { key: "{customer_name}", label: "Tên khách" },
  { key: "{shop_name}", label: "Tên shop" },
  { key: "{date_time}", label: "Ngày mua" },
  { key: "{warranty_info}", label: "Bảo hành" },
];

const FIELD_LABELS: Record<keyof InvoiceTemplate["fieldIcons"], string> = {
  order: "Đơn hàng",
  product: "Sản phẩm",
  quantity: "Số lượng",
  price: "Tổng tiền",
  warranty: "Bảo hành",
  datetime: "Ngày mua",
  shop: "Tên shop",
};

const SAMPLE_PREVIEW = {
  orderCode: "DH510277926",
  productName: "Grok Super 3 Tháng | BHF",
  quantity: 2,
  totalPriceText: "180.000đ",
  shopName: "Shop của bạn",
  customerName: "Khách mẫu",
  dateTimeText: "22/05/2026 17:28:15",
  warrantyText: "Bảo hành 3 ngày",
  accountList: [
    "renaude@vodich1.com|Giare#123",
    "lokrjjfi@vodich1.com|Giare#123",
  ],
};

function fillPlaceholders(raw: string): string {
  if (!raw) return "";
  return raw
    .replace(/\{order_code\}/g, SAMPLE_PREVIEW.orderCode)
    .replace(/\{product_name\}/g, SAMPLE_PREVIEW.productName)
    .replace(/\{quantity\}/g, String(SAMPLE_PREVIEW.quantity))
    .replace(/\{total_price\}/g, SAMPLE_PREVIEW.totalPriceText)
    .replace(/\{customer_name\}/g, SAMPLE_PREVIEW.customerName)
    .replace(/\{shop_name\}/g, SAMPLE_PREVIEW.shopName)
    .replace(/\{date_time\}/g, SAMPLE_PREVIEW.dateTimeText)
    .replace(/\{warranty_info\}/g, SAMPLE_PREVIEW.warrantyText);
}

function renderPreview(template: InvoiceTemplate): string {
  const lines: string[] = [];
  const headerText = fillPlaceholders(template.header.text || "");
  lines.push(`${template.header.icon} ${headerText}`);
  lines.push(`${template.fieldIcons.order} Đơn hàng: ${SAMPLE_PREVIEW.orderCode}`);
  lines.push(`${template.fieldIcons.product} Sản phẩm: ${SAMPLE_PREVIEW.productName}`);
  lines.push(`${template.fieldIcons.quantity} Tổng số tài khoản: ${SAMPLE_PREVIEW.quantity}`);
  lines.push(`${template.fieldIcons.price} Tổng tiền: ${SAMPLE_PREVIEW.totalPriceText}`);
  lines.push(`${template.fieldIcons.warranty} Bảo hành: ${SAMPLE_PREVIEW.warrantyText}`);
  lines.push(`${template.fieldIcons.datetime} Ngày mua: ${SAMPLE_PREVIEW.dateTimeText}`);
  lines.push(`${template.fieldIcons.shop} Shop: ${SAMPLE_PREVIEW.shopName}`);
  lines.push("");
  lines.push("💬 DANH SÁCH TÀI KHOẢN:");
  SAMPLE_PREVIEW.accountList.forEach((acc, idx) => {
    const label = (template.accountBlock.labelTemplate || "TÀI KHOẢN #{index}").replace(/\{index\}/g, String(idx + 1));
    lines.push("");
    lines.push(`${template.accountBlock.icon} ${label}:`);
    lines.push(acc);
  });
  lines.push("");
  lines.push(`Đã giao ${SAMPLE_PREVIEW.accountList.length} tài khoản thành công!`);
  const footer = fillPlaceholders(template.footer || "").trim();
  if (footer) {
    lines.push("");
    lines.push(footer);
  }
  return lines.join("\n");
}

interface Props {
  value: InvoiceTemplate;
  defaults: InvoiceTemplate;
  onChange: (next: InvoiceTemplate) => void;
  onSave: () => void;
  onReset: () => void;
  onSendTest?: (mode: "small" | "large") => void;
  isSaving?: boolean;
  isTesting?: boolean;
  hint?: string;
}

export function InvoiceTemplateEditor({
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
  const normalized: InvoiceTemplate = {
    ...value,
    customEmojiIds: value.customEmojiIds ?? {},
  };
  const [local, setLocal] = useState<InvoiceTemplate>(normalized);

  useEffect(() => {
    setLocal({
      ...value,
      customEmojiIds: value.customEmojiIds ?? {},
    });
  }, [JSON.stringify(value)]);

  const preview = useMemo(() => renderPreview(local), [JSON.stringify(local)]);

  function patch(p: Partial<InvoiceTemplate>) {
    const next: InvoiceTemplate = {
      ...local,
      ...p,
      header: { ...local.header, ...(p.header ?? {}) },
      fieldIcons: { ...local.fieldIcons, ...(p.fieldIcons ?? {}) },
      accountBlock: { ...local.accountBlock, ...(p.accountBlock ?? {}) },
      customEmojiIds: { ...local.customEmojiIds, ...(p.customEmojiIds ?? {}) },
    };
    setLocal(next);
    onChange(next);
  }

  function patchEmojiId(key: keyof InvoiceCustomEmojiIds, value: string) {
    const trimmed = value.trim();
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
                placeholder="✅"
              />
              <input
                value={local.header.text}
                onChange={(e) => patch({ header: { ...local.header, text: e.target.value } })}
                className={inputCls}
                style={inputStyle}
                placeholder="THANH TOÁN THÀNH CÔNG"
              />
            </div>
            <EmojiIdRow
              value={local.customEmojiIds.header}
              onChange={(v) => patchEmojiId("header", v)}
            />
          </Group>

          <Group title="Icon từng dòng">
            <div className="space-y-1.5">
              {(Object.keys(local.fieldIcons) as Array<keyof InvoiceTemplate["fieldIcons"]>).map((k) => (
                <div key={k} className="grid items-center gap-2" style={{ gridTemplateColumns: "76px 56px 1fr 24px" }}>
                  <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--tx-f)" }}>
                    {FIELD_LABELS[k]}
                  </span>
                  <input
                    value={local.fieldIcons[k]}
                    onChange={(e) =>
                      patch({ fieldIcons: { ...local.fieldIcons, [k]: e.target.value } as InvoiceTemplate["fieldIcons"] })
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
              Custom Emoji ID = icon động Telegram Premium. Để trống = dùng icon text bên trái.
              <br />
              Cách lấy ID: gửi emoji động vào bot <code className="font-mono">@idstickerbot</code> hoặc dùng <code className="font-mono">@StickerThief</code>.
            </p>
          </Group>

          <Group title="Khối tài khoản (Account block)">
            <div className="grid grid-cols-[80px_1fr] gap-2">
              <input
                value={local.accountBlock.icon}
                onChange={(e) => patch({ accountBlock: { ...local.accountBlock, icon: e.target.value } })}
                className={inputCls}
                style={inputStyle}
                placeholder="🎁"
              />
              <input
                value={local.accountBlock.labelTemplate}
                onChange={(e) => patch({ accountBlock: { ...local.accountBlock, labelTemplate: e.target.value } })}
                className={inputCls}
                style={inputStyle}
                placeholder="TÀI KHOẢN #{index}"
              />
            </div>
            <EmojiIdRow
              value={local.customEmojiIds.accountBlock}
              onChange={(v) => patchEmojiId("accountBlock", v)}
            />
            <p className="mt-1 text-[10px]" style={{ color: "var(--tx-f)" }}>
              <code className="font-mono">{"{index}"}</code> = số thứ tự (1, 2, 3...)
            </p>
          </Group>

          <Group title="Footer (dòng cuối)">
            <textarea
              value={local.footer}
              onChange={(e) => patch({ footer: e.target.value })}
              className={inputCls}
              style={{ ...inputStyle, minHeight: 60 }}
              placeholder="Cảm ơn bạn đã mua hàng! 🎉"
            />
            <p className="mt-1 text-[10px]" style={{ color: "var(--tx-f)" }}>
              Biến: {PLACEHOLDER_HINTS.map((p) => p.key).join(" · ")}
            </p>
          </Group>

          <Group title="Ngưỡng gửi file (>N tài khoản → gửi file .txt)">
            <input
              type="number"
              min={1}
              max={50}
              value={local.inlineThreshold}
              onChange={(e) => patch({ inlineThreshold: Math.max(1, Math.min(50, Number(e.target.value) || 5)) })}
              className={inputCls}
              style={inputStyle}
            />
          </Group>
        </div>

        <div className="space-y-2">
          <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: "var(--tx-f)" }}>
            Preview hóa đơn (≤ {local.inlineThreshold} acc)
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
          <>
            <button
              type="button"
              onClick={() => onSendTest("small")}
              disabled={isTesting}
              className="rounded-xl px-3 py-2 text-[12px] font-black transition hover:opacity-90 disabled:opacity-40"
              style={{ background: "rgb(56,189,248)", color: "#fff" }}
            >
              {isTesting ? "Đang gửi..." : "🧪 Test (2 acc)"}
            </button>
            <button
              type="button"
              onClick={() => onSendTest("large")}
              disabled={isTesting}
              className="rounded-xl px-3 py-2 text-[12px] font-black transition hover:opacity-90 disabled:opacity-40"
              style={{ background: "rgb(168,85,247)", color: "#fff" }}
            >
              {isTesting ? "Đang gửi..." : "🧪 Test (6 acc, gửi file)"}
            </button>
          </>
        )}
      </div>

      {hint && (
        <p className="text-[11px]" style={{ color: "var(--tx-f)" }}>
          {hint}
        </p>
      )}

      <details className="text-[11px]" style={{ color: "var(--tx-f)" }}>
        <summary className="cursor-pointer font-bold">📖 Danh sách biến placeholder</summary>
        <ul className="mt-1 grid grid-cols-2 gap-1 sm:grid-cols-4">
          {PLACEHOLDER_HINTS.map((p) => (
            <li key={p.key} className="rounded-md px-2 py-1" style={{ background: "var(--surface)" }}>
              <code className="font-mono">{p.key}</code> — {p.label}
            </li>
          ))}
        </ul>
      </details>

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
