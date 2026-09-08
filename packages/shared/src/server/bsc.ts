import axios from "axios";

export const BSC_USDT_MAINNET_CONTRACT = "0x55d398326f99059fF775485246999027B3197955";
export const BSC_USDT_DECIMALS = 18;
export const BSC_MIN_CONFIRMATIONS = 15;

// keccak256("Transfer(address,address,uint256)")
export const ERC20_TRANSFER_EVENT_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export const DEFAULT_BSC_RPC_ENDPOINTS = [
  "https://bsc-dataseed.binance.org",
  "https://bsc-dataseed1.defibit.io",
  "https://bsc.publicnode.com",
  "https://binance.llamarpc.com",
];

export type Bep20UsdtTransfer = {
  txHash: string;
  logIndex: number;
  blockNumber: number;
  fromAddress: string;
  toAddress: string;
  amountUsdt: number;
  amountRaw: string;
  contractAddress: string;
};

type JsonRpcLog = {
  address?: string;
  topics?: string[];
  data?: string;
  blockNumber?: string;
  transactionHash?: string;
  logIndex?: string;
  removed?: boolean;
};

type JsonRpcResponse<T> = {
  jsonrpc?: string;
  id?: number | string;
  result?: T;
  error?: { code?: number; message?: string };
};

export function isValidBep20Address(value: string | null | undefined): boolean {
  const s = String(value || "").trim();
  return /^0x[a-fA-F0-9]{40}$/.test(s);
}

export function normalizeBep20Address(value: string | null | undefined): string | null {
  if (!isValidBep20Address(value)) return null;
  return String(value).trim().toLowerCase();
}

/** Pad a 20-byte address (0x + 40 hex) into a 32-byte topic (0x + 64 hex, left-pad zeros). */
export function addressToTopic(addr: string): string {
  const s = String(addr || "").trim().toLowerCase().replace(/^0x/, "");
  if (!/^[a-f0-9]{40}$/.test(s)) throw new Error("invalid address for topic");
  return "0x" + "0".repeat(24) + s;
}

/** Extract a 20-byte hex address (0x-prefixed, lowercase) from a 32-byte topic string. */
export function topicToAddress(topic: string): string {
  const s = String(topic || "").trim().toLowerCase().replace(/^0x/, "");
  if (s.length !== 64) throw new Error("invalid topic length");
  return "0x" + s.slice(24);
}

export function decodeUsdtAmount(dataHex: string, decimals: number = BSC_USDT_DECIMALS): { amountRaw: string; amountUsdt: number } {
  const s = String(dataHex || "").trim().toLowerCase().replace(/^0x/, "") || "0";
  const raw = BigInt("0x" + s);
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const frac = raw % divisor;
  const fracStr = frac.toString().padStart(decimals, "0");
  // Keep 6 decimal places for USDT precision (only 2 are used for matching, extra is buffer)
  const trimmed = fracStr.slice(0, 6);
  const amountUsdt = Number(`${whole}.${trimmed || "0"}`);
  return { amountRaw: raw.toString(), amountUsdt };
}

function isTransientRpcError(err: unknown): boolean {
  const e = err as { code?: string; response?: { status?: number } };
  if (e?.code === "ECONNABORTED" || e?.code === "ETIMEDOUT" || e?.code === "ECONNRESET") return true;
  const status = e?.response?.status;
  if (typeof status === "number" && (status >= 500 || status === 429 || status === 403)) return true;
  return !e?.response;
}

async function jsonRpcCall<T>(input: {
  endpoints: string[];
  method: string;
  params: unknown[];
  timeoutMs?: number;
  headers?: Record<string, string>;
}): Promise<T> {
  const endpoints = input.endpoints.filter(Boolean);
  if (endpoints.length === 0) throw new Error("no BSC RPC endpoints configured");
  let lastErr: unknown;
  for (let attempt = 0; attempt < endpoints.length; attempt++) {
    const url = endpoints[attempt]!;
    try {
      const response = await axios.post<JsonRpcResponse<T>>(
        url,
        { jsonrpc: "2.0", id: 1, method: input.method, params: input.params },
        {
          timeout: Math.max(4000, Number(input.timeoutMs || 15000)),
          headers: {
            "Content-Type": "application/json",
            ...(input.headers || {}),
          },
        },
      );
      const body = response.data;
      if (body?.error) {
        // JSON-RPC application error — not transient, don't rotate.
        throw new Error(`BSC RPC error: ${body.error.code} ${body.error.message}`);
      }
      if (body?.result === undefined) throw new Error("BSC RPC empty result");
      return body.result;
    } catch (err) {
      lastErr = err;
      if (!isTransientRpcError(err)) throw err;
      // Try next endpoint.
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("BSC RPC failed on all endpoints");
}

export async function getBscLatestBlockNumber(input: {
  endpoints: string[];
  timeoutMs?: number;
}): Promise<number> {
  const hex = await jsonRpcCall<string>({
    endpoints: input.endpoints,
    method: "eth_blockNumber",
    params: [],
    timeoutMs: input.timeoutMs,
  });
  return Number(BigInt(hex));
}

export type FetchBep20UsdtLogsInput = {
  endpoints: string[];
  fromBlock: number;
  toBlock: number;
  ownerAddresses: string[]; // set of destination wallets to include
  contractAddress?: string;
  decimals?: number;
  timeoutMs?: number;
};

export async function fetchBep20UsdtTransfers(input: FetchBep20UsdtLogsInput): Promise<Bep20UsdtTransfer[]> {
  const contract = String(input.contractAddress || BSC_USDT_MAINNET_CONTRACT).toLowerCase();
  const owners = Array.from(
    new Set(
      input.ownerAddresses
        .map((addr) => normalizeBep20Address(addr))
        .filter((addr): addr is string => Boolean(addr)),
    ),
  );
  if (owners.length === 0) return [];

  // topic[0] = Transfer signature
  // topic[1] = from (null = wildcard)
  // topic[2] = to (array = OR filter — supported by most BSC nodes)
  const toTopics = owners.map((addr) => addressToTopic(addr));

  const fromHex = "0x" + input.fromBlock.toString(16);
  const toHex = "0x" + input.toBlock.toString(16);

  const logs = await jsonRpcCall<JsonRpcLog[]>({
    endpoints: input.endpoints,
    method: "eth_getLogs",
    params: [
      {
        fromBlock: fromHex,
        toBlock: toHex,
        address: contract,
        topics: [ERC20_TRANSFER_EVENT_TOPIC, null, toTopics],
      },
    ],
    timeoutMs: input.timeoutMs,
  });

  const decimals = Number.isFinite(input.decimals) ? Number(input.decimals) : BSC_USDT_DECIMALS;
  const transfers: Bep20UsdtTransfer[] = [];
  for (const log of Array.isArray(logs) ? logs : []) {
    if (log?.removed) continue;
    if (!log?.transactionHash || !log?.topics || log.topics.length < 3) continue;
    if (String(log.address || "").toLowerCase() !== contract) continue;
    if (String(log.topics[0] || "").toLowerCase() !== ERC20_TRANSFER_EVENT_TOPIC) continue;
    let fromAddress = "";
    let toAddress = "";
    try {
      fromAddress = topicToAddress(String(log.topics[1] || ""));
      toAddress = topicToAddress(String(log.topics[2] || ""));
    } catch {
      continue;
    }
    const { amountRaw, amountUsdt } = decodeUsdtAmount(String(log.data || "0x0"), decimals);
    transfers.push({
      txHash: String(log.transactionHash).toLowerCase(),
      logIndex: Number(BigInt(log.logIndex || "0x0")),
      blockNumber: Number(BigInt(log.blockNumber || "0x0")),
      fromAddress,
      toAddress,
      amountUsdt,
      amountRaw,
      contractAddress: contract,
    });
  }
  return transfers;
}

export type Bep20TxReceipt = {
  txHash: string;
  status: number; // 1 = success, 0 = reverted
  blockNumber: number;
  blockTimestamp: Date;
  confirmations: number;
  transfers: Bep20UsdtTransfer[];
};

/** Fetch a single tx receipt + confirmations (used by manual submit / fallback verify). */
export async function fetchBep20TxReceipt(input: {
  endpoints: string[];
  txHash: string;
  contractAddress?: string;
  decimals?: number;
  timeoutMs?: number;
}): Promise<Bep20TxReceipt | null> {
  const txHash = String(input.txHash || "").trim().toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(txHash)) return null;
  const receipt = await jsonRpcCall<{
    status?: string;
    blockNumber?: string;
    transactionHash?: string;
    logs?: JsonRpcLog[];
  } | null>({
    endpoints: input.endpoints,
    method: "eth_getTransactionReceipt",
    params: [txHash],
    timeoutMs: input.timeoutMs,
  });
  if (!receipt) return null;
  const status = Number(BigInt(receipt.status || "0x0"));
  const blockNumber = Number(BigInt(receipt.blockNumber || "0x0"));
  const block = await jsonRpcCall<{ timestamp?: string } | null>({
    endpoints: input.endpoints,
    method: "eth_getBlockByNumber",
    params: [receipt.blockNumber || "0x0", false],
    timeoutMs: input.timeoutMs,
  });
  const blockTimestampSeconds = Number(BigInt(block?.timestamp || "0x0"));
  if (!Number.isFinite(blockTimestampSeconds) || blockTimestampSeconds <= 0) {
    throw new Error("BSC RPC returned an invalid block timestamp");
  }
  const blockTimestamp = new Date(blockTimestampSeconds * 1000);
  const latest = await getBscLatestBlockNumber({ endpoints: input.endpoints, timeoutMs: input.timeoutMs });
  const confirmations = Math.max(0, latest - blockNumber + 1);
  const contract = String(input.contractAddress || BSC_USDT_MAINNET_CONTRACT).toLowerCase();
  const decimals = Number.isFinite(input.decimals) ? Number(input.decimals) : BSC_USDT_DECIMALS;
  const transfers: Bep20UsdtTransfer[] = [];
  for (const log of receipt.logs || []) {
    if (log?.removed) continue;
    if (String(log.address || "").toLowerCase() !== contract) continue;
    const topics = log.topics || [];
    if (String(topics[0] || "").toLowerCase() !== ERC20_TRANSFER_EVENT_TOPIC) continue;
    if (topics.length < 3) continue;
    let fromAddress = "";
    let toAddress = "";
    try {
      fromAddress = topicToAddress(String(topics[1] || ""));
      toAddress = topicToAddress(String(topics[2] || ""));
    } catch {
      continue;
    }
    const { amountRaw, amountUsdt } = decodeUsdtAmount(String(log.data || "0x0"), decimals);
    transfers.push({
      txHash,
      logIndex: Number(BigInt(log.logIndex || "0x0")),
      blockNumber,
      fromAddress,
      toAddress,
      amountUsdt,
      amountRaw,
      contractAddress: contract,
    });
  }
  return { txHash, status, blockNumber, blockTimestamp, confirmations, transfers };
}
