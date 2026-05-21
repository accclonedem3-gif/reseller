import { CheckCircle2, Copy, QrCode, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

function buildQuickQrUrl(value: string) {
  return `https://quickchart.io/qr?size=360&text=${encodeURIComponent(value)}`;
}

export function ManualCryptoPaymentPage() {
  const [searchParams] = useSearchParams();
  const provider = String(searchParams.get("provider") || "").toLowerCase();
  const token = String(searchParams.get("token") || "USDT").toUpperCase();
  const network = String(searchParams.get("network") || "TRC20").toUpperCase();
  const address = String(searchParams.get("address") || "").trim();
  const amount = String(searchParams.get("amount") || "").trim();
  const reference = String(searchParams.get("ref") || "").trim();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const addressQrUrl = useMemo(() => {
    if (!address) {
      return "";
    }

    return buildQuickQrUrl(address);
  }, [address]);

  const copyText = async (key: string, value: string) => {
    if (!value) {
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((current) => (current === key ? null : current));
      }, 1600);
    } catch {
      setCopiedKey(null);
    }
  };

  if (provider !== "usdt_trc20" || !address || !amount) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <Card className="max-w-xl">
          <p className="app-kicker">Payment helper</p>
          <h1 className="mt-3 font-display text-3xl font-semibold text-white">
            Invalid crypto payment link
          </h1>
          <p className="mt-3 text-sm leading-7 text-slate-300">
            This payment link is missing required TRC20 transfer information.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-5xl overflow-hidden p-0">
        <div className="grid md:grid-cols-[340px,minmax(0,1fr)]">
          <div className="border-b border-white/8 bg-[#0D1425] p-6 md:border-b-0 md:border-r">
            <p className="app-kicker">Crypto payment helper</p>
            <h1 className="mt-3 font-display text-3xl font-semibold text-white">
              {token} ({network})
            </h1>
            <p className="mt-3 text-sm leading-7 text-slate-300">
              The Telegram QR now opens this helper page first. Use the QR below if you want to
              fill the receiving address from another device.
            </p>

            <div className="mt-6 overflow-hidden rounded-[18px] border border-white/10 bg-white p-4">
              {addressQrUrl ? (
                <img
                  src={addressQrUrl}
                  alt={`${token} ${network} address QR`}
                  className="mx-auto h-auto w-full max-w-[280px]"
                />
              ) : null}
            </div>

            <p className="mt-4 text-xs leading-6 text-slate-400">
              This QR usually fills the receiving address only. Some wallets or exchanges still
              require you to choose {token} on {network} and enter the amount manually.
            </p>
          </div>

          <div className="p-6 md:p-8">
            <div className="flex items-start gap-3">
              <div className="glass-chip flex h-12 w-12 items-center justify-center rounded-2xl">
                <Wallet className="h-5 w-5 text-emerald-200" />
              </div>
              <div>
                <p className="app-kicker">Transfer details</p>
                <p className="mt-2 text-sm leading-7 text-slate-300">
                  If your wallet does not auto-fill everything from the QR, copy the fields below
                  and transfer manually.
                </p>
              </div>
            </div>

            <div className="mt-8 space-y-5">
              <div className="rounded-[16px] border border-white/8 bg-[#0D1425] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Token</p>
                    <p className="mt-2 text-sm font-semibold text-white">{token}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Network</p>
                    <p className="mt-2 text-sm font-semibold text-white">{network} (Tron)</p>
                  </div>
                </div>
              </div>

              <div className="rounded-[16px] border border-white/8 bg-[#0D1425] p-4">
                <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Receiving address</p>
                <p className="mt-2 break-all font-mono text-sm leading-7 text-slate-100">{address}</p>
                <div className="mt-4">
                  <Button size="sm" variant="secondary" onClick={() => void copyText("address", address)}>
                    {copiedKey === "address" ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    {copiedKey === "address" ? "Copied" : "Copy address"}
                  </Button>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-[16px] border border-white/8 bg-[#0D1425] p-4">
                  <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Amount</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{amount} USDT</p>
                  <div className="mt-4">
                    <Button size="sm" variant="secondary" onClick={() => void copyText("amount", amount)}>
                      {copiedKey === "amount" ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      {copiedKey === "amount" ? "Copied" : "Copy amount"}
                    </Button>
                  </div>
                </div>

                <div className="rounded-[16px] border border-white/8 bg-[#0D1425] p-4">
                  <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Order reference</p>
                  <p className="mt-2 break-all font-mono text-sm leading-7 text-slate-100">
                    {reference || "-"}
                  </p>
                  <div className="mt-4">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void copyText("reference", reference)}
                      disabled={!reference}
                    >
                      {copiedKey === "reference" ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      {copiedKey === "reference" ? "Copied" : "Copy reference"}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="rounded-[16px] border border-amber-300/18 bg-amber-500/8 p-4">
                <div className="flex items-start gap-3">
                  <QrCode className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" />
                  <div className="space-y-2 text-sm leading-7 text-slate-200">
                    <p>Choose {token} on the {network} network before confirming the transfer.</p>
                    <p>
                      TRC20 transfers need enough TRX in the sending wallet for network fees.
                    </p>
                    <p>
                      A fresh TRON address cannot be activated by a TRC20 transfer alone, so the
                      receiving address should already be an active TRON account.
                    </p>
                    <p>
                      After transferring, go back to the bot and use <span className="font-semibold text-white">Send TX hash</span>.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
