/**
 * OKX Personal API client (read-only, for auto-verifying USDT deposits).
 *
 * Docs:
 *   Auth:               https://www.okx.com/docs-v5/en/#overview-rest-authentication
 *   Get account config: https://www.okx.com/docs-v5/en/#trading-account-rest-api-get-account-configuration
 *   Deposit history:    https://www.okx.com/docs-v5/en/#funding-account-rest-api-get-deposit-history
 *
 * Networks supported: TRC20, BEP20, Solana (chain values: "USDT-TRC20",
 * "USDT-BEP20", "USDT-Solana").
 */

import * as crypto from "crypto";

import { BadRequestException, Injectable, Logger } from "@nestjs/common";

const OKX_BASE_URL = "https://www.okx.com";

export interface OkxDeposit {
  ccy: string;
  chain: string;
  amt: string;
  from: string;
  to: string;
  txId: string;
  ts: string;
  state: string;
  depId: string;
}

@Injectable()
export class OkxPersonalApiService {
  private readonly logger = new Logger(OkxPersonalApiService.name);

  private signRequest(
    method: string,
    path: string,
    body: string,
    timestamp: string,
    secret: string,
  ): string {
    const prehash = timestamp + method.toUpperCase() + path + body;
    return crypto.createHmac("sha256", secret).update(prehash).digest("base64");
  }

  private async authedFetch(
    apiKey: string,
    secret: string,
    passphrase: string,
    method: "GET" | "POST",
    path: string,
    queryParams?: Record<string, string>,
    body?: any,
  ): Promise<any[]> {
    let fullPath = path;
    if (queryParams && Object.keys(queryParams).length > 0) {
      const qs = new URLSearchParams(queryParams).toString();
      fullPath += "?" + qs;
    }
    const timestamp = new Date().toISOString();
    const bodyStr = body ? JSON.stringify(body) : "";
    const signature = this.signRequest(method, fullPath, bodyStr, timestamp, secret);

    const res = await fetch(OKX_BASE_URL + fullPath, {
      method,
      headers: {
        "OK-ACCESS-KEY": apiKey,
        "OK-ACCESS-SIGN": signature,
        "OK-ACCESS-TIMESTAMP": timestamp,
        "OK-ACCESS-PASSPHRASE": passphrase,
        "Content-Type": "application/json",
      },
      body: body ? bodyStr : undefined,
    });

    const json = (await res.json()) as any;
    if (!res.ok || (json.code && json.code !== "0")) {
      throw new BadRequestException(
        `OKX API error: [${json.code ?? res.status}] ${json.msg || "unknown error"}`,
      );
    }
    return json.data || [];
  }

  async verifyCredentials(
    apiKey: string,
    secret: string,
    passphrase: string,
  ): Promise<{ uid: string; level?: string }> {
    const data = await this.authedFetch(
      apiKey,
      secret,
      passphrase,
      "GET",
      "/api/v5/account/config",
    );
    const first = data[0] || {};
    return { uid: String(first.uid || ""), level: first.level };
  }

  /**
   * Fetch USDT deposits (any chain).
   *
   * @param sinceMs  optional epoch ms cutoff; if set, returns deposits with ts >= sinceMs
   * @returns deposits with state "2" (credited & available) preferred; we also
   *   include "1" (credited but not yet on-chain confirmed) so the bot can
   *   match the user's tx hash early.
   */
  async getDepositHistory(
    apiKey: string,
    secret: string,
    passphrase: string,
    sinceMs?: number,
  ): Promise<OkxDeposit[]> {
    const params: Record<string, string> = { ccy: "USDT", limit: "100" };
    if (sinceMs) params.after = String(sinceMs);
    const data = await this.authedFetch(
      apiKey,
      secret,
      passphrase,
      "GET",
      "/api/v5/asset/deposit-history",
      params,
    );
    return data as OkxDeposit[];
  }

  /**
   * Convenience: find a deposit by tx hash (any chain).
   * Returns null if not found or not yet credited.
   */
  async findDepositByTxHash(
    apiKey: string,
    secret: string,
    passphrase: string,
    txHash: string,
    sinceMs?: number,
  ): Promise<OkxDeposit | null> {
    const deposits = await this.getDepositHistory(apiKey, secret, passphrase, sinceMs);
    const normalized = String(txHash).trim().toLowerCase();
    const hit = deposits.find(
      (d) =>
        String(d.txId || "").trim().toLowerCase() === normalized &&
        (d.state === "2" || d.state === "1"),
    );
    return hit ?? null;
  }

  /**
   * Convenience: find a deposit by amount (USDT) within a tolerance, used for
   * fallback auto-match when the user didn't paste a tx hash.
   */
  async findDepositByAmount(
    apiKey: string,
    secret: string,
    passphrase: string,
    targetAmount: number,
    tolerance: number = 0.001,
    sinceMs?: number,
  ): Promise<OkxDeposit | null> {
    const deposits = await this.getDepositHistory(apiKey, secret, passphrase, sinceMs);
    const hit = deposits.find(
      (d) =>
        d.state === "2" &&
        Math.abs(Number(d.amt) - targetAmount) <= tolerance,
    );
    return hit ?? null;
  }
}
