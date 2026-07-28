type UnknownRecord = Record<string, unknown>;

export type PaypalOrderSummary = {
  orderId: string;
  status: string;
  externalOrderCode: string;
  currency: string;
  amount: number;
  amountPaid: number;
  captureId: string | null;
  completed: boolean;
};

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function firstRecord(value: unknown): UnknownRecord | null {
  return Array.isArray(value) ? asRecord(value[0]) : null;
}

function nonEmptyString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function formatPaypalUsdAmount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("PayPal amount must be greater than zero.");
  }
  return value.toFixed(2);
}

export function extractPaypalApprovalUrl(payload: unknown): string {
  const root = asRecord(payload);
  const links = Array.isArray(root?.links) ? root.links : [];
  for (const entry of links) {
    const link = asRecord(entry);
    const rel = nonEmptyString(link?.rel).toLowerCase();
    const href = nonEmptyString(link?.href);
    if ((rel === "payer-action" || rel === "approve") && /^https:\/\//i.test(href)) {
      return href;
    }
  }
  return "";
}

export function extractPaypalWebhookExternalOrderCode(event: unknown): string {
  const resource = asRecord(asRecord(event)?.resource);
  const purchaseUnit = firstRecord(resource?.purchase_units);
  return nonEmptyString(resource?.custom_id)
    || nonEmptyString(resource?.invoice_id)
    || nonEmptyString(resource?.reference_id)
    || nonEmptyString(purchaseUnit?.custom_id)
    || nonEmptyString(purchaseUnit?.invoice_id)
    || nonEmptyString(purchaseUnit?.reference_id);
}

export function extractPaypalWebhookOrderId(event: unknown): string {
  const root = asRecord(event);
  const resource = asRecord(root?.resource);
  const eventType = nonEmptyString(root?.event_type).toUpperCase();
  if (eventType.startsWith("CHECKOUT.ORDER.")) {
    return nonEmptyString(resource?.id);
  }
  const supplementary = asRecord(resource?.supplementary_data);
  const relatedIds = asRecord(supplementary?.related_ids);
  return nonEmptyString(relatedIds?.order_id);
}

export function summarizePaypalOrder(payload: unknown): PaypalOrderSummary {
  const root = asRecord(payload);
  const purchaseUnit = firstRecord(root?.purchase_units);
  const amount = asRecord(purchaseUnit?.amount);
  const payments = asRecord(purchaseUnit?.payments);
  const captures = Array.isArray(payments?.captures) ? payments.captures : [];
  const completedCaptures = captures
    .map(asRecord)
    .filter((capture): capture is UnknownRecord => Boolean(capture))
    .filter((capture) => nonEmptyString(capture.status).toUpperCase() === "COMPLETED");

  let currency = nonEmptyString(amount?.currency_code).toUpperCase();
  let amountPaid = 0;
  for (const capture of completedCaptures) {
    const captureAmount = asRecord(capture.amount);
    const captureCurrency = nonEmptyString(captureAmount?.currency_code).toUpperCase();
    if (!currency) currency = captureCurrency;
    if (captureCurrency === currency) {
      amountPaid += Number(captureAmount?.value || 0);
    }
  }

  const status = nonEmptyString(root?.status).toUpperCase();
  return {
    orderId: nonEmptyString(root?.id),
    status,
    externalOrderCode:
      nonEmptyString(purchaseUnit?.custom_id)
      || nonEmptyString(purchaseUnit?.invoice_id)
      || nonEmptyString(purchaseUnit?.reference_id),
    currency,
    amount: Number(amount?.value || 0),
    amountPaid,
    captureId: nonEmptyString(completedCaptures[0]?.id) || null,
    completed: status === "COMPLETED" && completedCaptures.length > 0,
  };
}
