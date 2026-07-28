export const TON_USDT_MAINNET_MASTER = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';

export type TonUsdtTransfer = {
  txHash: string;
  traceId: string | null;
  amountUnits: string;
  amountUsdt: number;
  sourceAddress: string | null;
  destinationAddress: string;
  jettonMasterAddress: string;
  transactionAt: Date;
  transactionLt: string | null;
};

type TonCenterJettonTransfer = {
  amount?: unknown;
  destination?: unknown;
  jetton_master?: unknown;
  source?: unknown;
  trace_id?: unknown;
  transaction_aborted?: unknown;
  transaction_hash?: unknown;
  transaction_lt?: unknown;
  transaction_now?: unknown;
};

type TonCenterJettonTransfersResponse = {
  jetton_transfers?: TonCenterJettonTransfer[];
};

function crc16Xmodem(bytes: Uint8Array) {
  let crc = 0;

  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }

  return crc;
}

/** Convert a raw or checksum-validated friendly TON address to `workchain:hex`. */
export function normalizeTonAddress(value: string | null | undefined): string | null {
  const input = String(value || '').trim();
  const rawMatch = input.match(/^(-?\d+):([a-f\d]{64})$/i);

  if (rawMatch) {
    const workchain = Number(rawMatch[1]);
    if (!Number.isInteger(workchain) || workchain < -128 || workchain > 127) return null;
    return `${workchain}:${rawMatch[2]!.toLowerCase()}`;
  }

  if (!/^[A-Za-z0-9_-]{48}$/.test(input)) return null;

  try {
    const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (input.length % 4)) % 4);
    const bytes = Buffer.from(padded, 'base64');
    if (bytes.length !== 36) return null;

    // Reject test-only friendly addresses (0x91/0xd1) on the mainnet payment path.
    const addressTag = bytes[0]!;
    if (addressTag !== 0x11 && addressTag !== 0x51) return null;

    const expectedCrc = bytes.readUInt16BE(34);
    const actualCrc = crc16Xmodem(bytes.subarray(0, 34));
    if (actualCrc !== expectedCrc) return null;

    return `${bytes.readInt8(1)}:${bytes.subarray(2, 34).toString('hex')}`;
  } catch {
    return null;
  }
}

export function isValidTonAddress(value: string | null | undefined) {
  return normalizeTonAddress(value) !== null;
}

export async function fetchTonUsdtTransfers(input: {
  ownerAddresses: string[];
  since: Date;
  apiBaseUrl?: string;
  apiKey?: string;
  jettonMasterAddress?: string;
  decimals?: number;
  limit?: number;
}): Promise<TonUsdtTransfer[]> {
  const ownerAddresses = Array.from(
    new Set(input.ownerAddresses.map((address) => normalizeTonAddress(address)).filter((address): address is string => !!address)),
  );
  if (ownerAddresses.length === 0) return [];
  if (ownerAddresses.length > 1000) {
    throw new Error("TON Center accepts at most 1000 owner addresses per request.");
  }

  const jettonMasterAddress = input.jettonMasterAddress || TON_USDT_MAINNET_MASTER;
  const normalizedMaster = normalizeTonAddress(jettonMasterAddress);
  if (!normalizedMaster) throw new Error("TON_USDT_MASTER_ADDRESS is invalid.");

  const decimals = Number(input.decimals ?? 6);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new Error("TON_USDT_DECIMALS must be an integer between 0 and 18.");
  }

  return fetchTonUsdtTransferRows(input, ownerAddresses, jettonMasterAddress, normalizedMaster, decimals);
}

async function fetchTonUsdtTransferRows(
  input: {
    since: Date;
    apiBaseUrl?: string;
    apiKey?: string;
    limit?: number;
  },
  ownerAddresses: string[],
  jettonMasterAddress: string,
  normalizedMaster: string,
  decimals: number,
) {
  const apiBaseUrl = String(input.apiBaseUrl || "https://toncenter.com/api/v3").replace(/\/+$/, "");
  const url = new URL(`${apiBaseUrl}/jetton/transfers`);
  for (const address of ownerAddresses) url.searchParams.append("owner_address", address);
  url.searchParams.set("jetton_master", jettonMasterAddress);
  url.searchParams.set("direction", "in");
  url.searchParams.set("start_utime", String(Math.floor(input.since.getTime() / 1000)));
  url.searchParams.set("limit", String(Math.max(1, Math.min(1000, Math.floor(input.limit || 1000)))));
  url.searchParams.set("sort", "desc");

  const headers: Record<string, string> = { Accept: "application/json" };
  if (input.apiKey) headers["X-API-Key"] = input.apiKey;

  const response = await fetch(url, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`TON Center request failed with HTTP ${response.status}.`);
  }

  const payload = await response.json() as TonCenterJettonTransfersResponse;
  return parseTonUsdtTransfers(payload, ownerAddresses, normalizedMaster, decimals, input.since);
}

function parseTonUsdtTransfers(
  payload: TonCenterJettonTransfersResponse,
  ownerAddresses: string[],
  normalizedMaster: string,
  decimals: number,
  since: Date,
) {
  const rows = Array.isArray(payload.jetton_transfers) ? payload.jetton_transfers : [];
  const ownerSet = new Set(ownerAddresses);
  const divisor = 10 ** decimals;
  const sinceSeconds = Math.floor(since.getTime() / 1000);
  const transfers: TonUsdtTransfer[] = [];

  for (const row of rows) {
    if (row.transaction_aborted === true || String(row.transaction_aborted).toLowerCase() === "true") continue;

    const destinationAddress = normalizeTonAddress(String(row.destination || ""));
    const rowMasterAddress = normalizeTonAddress(String(row.jetton_master || ""));
    const sourceAddress = normalizeTonAddress(String(row.source || ""));
    const txHash = String(row.transaction_hash || "").trim();
    const transactionNow = Number(row.transaction_now || 0);
    const amountUnits = String(row.amount || "").trim();

    if (!destinationAddress || !ownerSet.has(destinationAddress)) continue;
    if (!rowMasterAddress || rowMasterAddress !== normalizedMaster) continue;
    if (!txHash || !/^\d+$/.test(amountUnits)) continue;
    if (!Number.isInteger(transactionNow) || transactionNow < sinceSeconds) continue;

    const amountUsdt = Number(amountUnits) / divisor;
    if (!Number.isFinite(amountUsdt) || amountUsdt <= 0) continue;

    transfers.push({
      txHash,
      traceId: String(row.trace_id || "").trim() || null,
      amountUnits,
      amountUsdt,
      sourceAddress,
      destinationAddress,
      jettonMasterAddress: rowMasterAddress,
      transactionAt: new Date(transactionNow * 1000),
      transactionLt: String(row.transaction_lt || "").trim() || null,
    });
  }

  return transfers;
}
