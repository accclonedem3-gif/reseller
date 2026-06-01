import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PaymentProvider, SellerTier, WalletLedgerType } from "@prisma/client";

import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../db/prisma.service";
import { MailService } from "../lib/mail.service";
import { PaymentService } from "../lib/payment.service";
import { decimalToNumber, generateExternalPaymentCode, toDecimal } from "../lib/utils";
import type { AuthenticatedUser } from "../types";

// Only PRO is publicly purchasable. ULTRA is admin-assigned only.
const TIER_PRICES: Record<"pro", number> = {
  pro: 199000,
};

const TIER_LABELS: Record<"pro", string> = {
  pro: "PRO",
};

const TIER_ENUM: Record<"pro", SellerTier> = {
  pro: SellerTier.PRO,
};

const UPGRADE_EXPIRY_MS = 15 * 60 * 1000; // 15 phút

@Injectable()
export class UpgradeService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(PaymentService)
    private readonly paymentService: PaymentService,
    @Inject(AppConfigService)
    private readonly config: AppConfigService,
    @Inject(MailService)
    private readonly mail: MailService,
  ) {}

  async createUpgradePayment(user: AuthenticatedUser, targetTier: "pro") {
    const seller = await this.prisma.seller.findUnique({
      where: { userId: user.id },
    });

    if (!seller) {
      throw new NotFoundException("Seller not found.");
    }

    const currentTier = seller.tier.toLowerCase() as "free" | "pro" | "ultra";

    if (currentTier === "ultra") {
      throw new BadRequestException("Tài khoản ULTRA không thể tự thay đổi gói.");
    }

    if (currentTier === targetTier) {
      throw new BadRequestException(`Tài khoản đã ở gói ${TIER_LABELS[targetTier]}.`);
    }

    const amount = TIER_PRICES[targetTier];
    const externalOrderCode = generateExternalPaymentCode();
    const expiresAt = new Date(Date.now() + UPGRADE_EXPIRY_MS);
    const description = `NANGCAP-${TIER_LABELS[targetTier]}`;

    // Always use platform PayOS credentials for upgrade payments.
    // "platform-upgrade" has no PaymentConfig → PaymentService falls back to
    // PAYOS_CLIENT_ID / PAYOS_API_KEY / PAYOS_CHECKSUM_KEY env vars.
    // providerOverride bypasses PAYMENT_MODE=mock so dev env still uses real PayOS.
    const payment = await this.paymentService.createPaymentLink({
      shopId: "platform-upgrade",
      externalOrderCode,
      amount,
      description,
      expiredAt: expiresAt,
      providerOverride: PaymentProvider.PAYOS,
    });

    await this.prisma.depositRequest.create({
      data: {
        sellerId: seller.id,
        amount: toDecimal(amount),
        provider: payment.provider,
        externalOrderCode,
        checkoutUrl: payment.checkoutUrl,
        qrCode: payment.qrCode,
        expiresAt,
        note: `UPGRADE_TIER:${targetTier}:${seller.id}`,
        rawPayloadJson: payment.providerPayload as any,
      },
    });

    return {
      externalOrderCode,
      checkoutUrl: payment.checkoutUrl,
      qrCode: payment.qrCode,
      amount,
      targetTier,
      provider: payment.provider.toLowerCase(),
      expiresAt,
      reconcileToken: this.paymentService.buildPublicReconcileToken(externalOrderCode),
    };
  }

  /**
   * Được gọi sau khi payment confirm (webhook hoặc mock-confirm).
   * Tự động đổi tier của seller.
   */
  async confirmUpgradeByExternalOrderCode(externalOrderCode: string, rawPayload?: unknown) {
    const deposit = await this.prisma.depositRequest.findUnique({
      where: { externalOrderCode },
    });

    if (!deposit) {
      throw new NotFoundException("Upgrade payment request not found.");
    }

    // Chỉ xử lý nếu note có format UPGRADE_TIER:...
    const note = deposit.note || "";
    const match = note.match(/^UPGRADE_TIER:(pro):(.+)$/);

    if (!match) {
      // Không phải upgrade request → skip
      return null;
    }

    const targetTier = match[1] as "pro";
    const sellerId = match[2]!;

    if (deposit.status === "CONFIRMED") {
      await this.prisma.$transaction(async (tx) => {
        // Reverse erroneous wallet credit if the wallet service mistakenly processed this deposit
        const errLedger = await tx.walletLedger.findFirst({
          where: { referenceType: "deposit_request", referenceId: deposit.id },
        });
        if (errLedger) {
          const wallet = await tx.sellerWallet.findUnique({ where: { sellerId } });
          if (wallet) {
            const balanceBefore = decimalToNumber(wallet.balance);
            const creditAmount = decimalToNumber(errLedger.amount);
            const balanceAfter = Math.max(0, balanceBefore - creditAmount);
            await tx.sellerWallet.update({
              where: { id: wallet.id },
              data: { balance: toDecimal(balanceAfter) },
            });
            await tx.walletLedger.create({
              data: {
                sellerId,
                walletId: wallet.id,
                type: WalletLedgerType.ADJUST,
                amount: toDecimal(-creditAmount),
                balanceBefore: toDecimal(balanceBefore),
                balanceAfter: toDecimal(balanceAfter),
                referenceType: "upgrade_reversal",
                referenceId: deposit.id,
                note: "Reversal: upgrade payment was incorrectly credited to wallet",
              },
            });
          }
        }
        // Ensure tier is applied (keep existing tierExpiresAt if already set)
        await tx.seller.update({
          where: { id: sellerId },
          data: { tier: TIER_ENUM[targetTier] },
        });

      });
      return { alreadyConfirmed: true, tier: targetTier };
    }

    await this.prisma.$transaction(async (tx) => {
      // Xác nhận deposit
      await tx.depositRequest.update({
        where: { id: deposit.id },
        data: {
          status: "CONFIRMED",
          paidAt: new Date(),
          approvedAt: new Date(),
          rawPayloadJson: rawPayload as any,
        },
      });

      // Tính tierExpiresAt: gia hạn thì cộng từ expiry hiện tại, mới thì tính từ now
      const currentSeller = await tx.seller.findUnique({
        where: { id: sellerId },
        select: { tier: true, tierStartedAt: true, tierExpiresAt: true },
      });
      const now = new Date();
      const isRenewal =
        currentSeller?.tier === TIER_ENUM[targetTier] &&
        currentSeller.tierExpiresAt != null;
      const base =
        isRenewal && currentSeller!.tierExpiresAt! > now
          ? currentSeller!.tierExpiresAt!
          : now;
      const tierStartedAt = isRenewal ? (currentSeller!.tierStartedAt ?? now) : now;
      const tierExpiresAt = new Date(base.getTime() + 30 * 24 * 60 * 60 * 1000);

      // Tự động nâng tier
      await tx.seller.update({
        where: { id: sellerId },
        data: {
          tier: TIER_ENUM[targetTier],
          tierStartedAt,
          tierExpiresAt,
        },
      });
    });

    await this.sendUpgradeEmail(sellerId, targetTier).catch(() => null);

    return { success: true, tier: targetTier };
  }

  private async sendUpgradeEmail(sellerId: string, tier: "pro") {
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      include: { user: { select: { email: true } } },
    });
    const email = seller?.user?.email;
    if (!email) return;

    const tierLabel = TIER_LABELS[tier];
    const gradient = "linear-gradient(135deg,#34D399,#10B981)";
    const btnColor = "#07131e";
    const icon = "⚡";
    const webUrl = this.config.webPublicUrl;

    const html = `<!DOCTYPE html><html lang="vi"><body style="margin:0;padding:0;font-family:system-ui,sans-serif;background:#070e1a;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;"><tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" style="border-radius:20px;background:#0d1525;border:1px solid rgba(255,255,255,0.08);">
  <tr><td style="padding:40px 32px 24px;text-align:center;">
    <div style="display:inline-flex;align-items:center;justify-content:center;width:72px;height:72px;border-radius:22px;background:${gradient};font-size:32px;margin-bottom:20px;">${icon}</div>
    <h1 style="color:#fff;font-size:26px;font-weight:800;margin:0;">Chào mừng lên gói ${tierLabel}!</h1>
    <p style="color:#94a3b8;font-size:15px;margin:12px 0 0;line-height:1.6;">Tài khoản của bạn đã được nâng cấp thành công.</p>
  </td></tr>
  <tr><td style="padding:0 32px 24px;">
    <div style="background:#1e2a47;border-radius:14px;padding:18px 20px;border:1px solid rgba(255,255,255,0.07);">
      <p style="color:#475569;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.12em;margin:0 0 6px;">Gói hiện tại</p>
      <p style="color:#fff;font-size:19px;font-weight:700;margin:0;">Gói ${tierLabel} &nbsp;·&nbsp; Đang hoạt động ✓</p>
    </div>
  </td></tr>
  <tr><td style="padding:0 32px 32px;text-align:center;">
    <a href="${webUrl}" style="display:inline-block;padding:14px 36px;border-radius:12px;background:${gradient};color:${btnColor};font-weight:700;font-size:15px;text-decoration:none;">Vào Dashboard →</a>
  </td></tr>
  <tr><td style="padding:0 32px 24px;border-top:1px solid rgba(255,255,255,0.06);">
    <p style="color:#334155;font-size:13px;text-align:center;margin:16px 0 0;">Cần hỗ trợ? Liên hệ @thaidem57 trên Telegram.</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

    await this.mail.send({
      to: email,
      subject: `[Altivox] Tài khoản đã được nâng lên gói ${tierLabel} 🎉`,
      text: `Chào mừng lên gói ${tierLabel}! Tài khoản của bạn đã được nâng cấp thành công. Vào dashboard: ${webUrl}`,
      html,
    });
  }

  async getUpgradeStatus(user: AuthenticatedUser, externalOrderCode: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { userId: user.id },
    });

    if (!seller) {
      throw new NotFoundException("Seller not found.");
    }

    const deposit = await this.prisma.depositRequest.findUnique({
      where: { externalOrderCode },
    });

    if (!deposit) {
      throw new NotFoundException("Upgrade payment not found.");
    }

    if (deposit.sellerId !== seller.id) {
      throw new BadRequestException("Unauthorized.");
    }

    return {
      status: deposit.status.toLowerCase(),
      amount: decimalToNumber(deposit.amount),
      expiresAt: deposit.expiresAt,
      paidAt: deposit.paidAt,
    };
  }
}
