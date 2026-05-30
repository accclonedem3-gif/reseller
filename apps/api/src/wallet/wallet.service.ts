import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  CustomerWalletLedgerType,
  DepositStatus,
  PaymentTransactionStatus,
  Prisma,
  WalletLedgerType,
  WithdrawStatus,
} from "@prisma/client";

import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../db/prisma.service";
import { PaymentService } from "../lib/payment.service";
import { decimalToNumber, generateExternalPaymentCode, toDecimal } from "../lib/utils";
import { ShopsService } from "../shops/shops.service";
import type { AuthenticatedUser } from "../types";

import type {
  AdjustCustomerWalletDto,
  CreateDepositRequestDto,
  CreateWithdrawRequestDto,
} from "./wallet.dto";

@Injectable()
export class WalletService {
  private readonly depositExpiryMs = 5 * 60 * 1000;

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(ShopsService)
    private readonly shopsService: ShopsService,
    @Inject(PaymentService)
    private readonly paymentService: PaymentService,
    @Inject(AppConfigService)
    private readonly config: AppConfigService,
  ) {}

  async getWallet(user: AuthenticatedUser) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const wallet = await this.prisma.sellerWallet.findUnique({
      where: { sellerId: shop.sellerId },
    });

    if (!wallet) {
      throw new NotFoundException("Wallet not found.");
    }

    const pendingWithdrawAmount = await this.getPendingWithdrawAmount(shop.sellerId);
    const balance = decimalToNumber(wallet.balance);
    const withdrawableBalance = Math.max(0, balance - pendingWithdrawAmount);

    return {
      id: wallet.id,
      sellerId: wallet.sellerId,
      balance,
      pendingWithdrawAmount,
      withdrawableBalance,
      currency: wallet.currency,
      updatedAt: wallet.updatedAt,
    };
  }

  async getSourceWallet(user: AuthenticatedUser) {
    const sourceWallet = await this.shopsService.getProviderBalanceForUser(user.id);

    return {
      walletCurrency: sourceWallet.walletCurrency,
      balance: sourceWallet.balance,
      balanceVnd: sourceWallet.balanceVnd,
      balanceUsd: sourceWallet.balanceUsd,
      balanceText: sourceWallet.balanceText,
      usdtBalance: sourceWallet.usdtBalance,
      requesterName: sourceWallet.requesterName,
      requesterChatId: sourceWallet.requesterChatId,
      botSource: sourceWallet.botSource,
      updatedAt: sourceWallet.updatedAt,
    };
  }

  async getWalletLedgers(user: AuthenticatedUser) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const ledgers = await this.prisma.walletLedger.findMany({
      where: {
        sellerId: shop.sellerId,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 100,
    });

    return ledgers.map((ledger) => ({
      id: ledger.id,
      type: ledger.type.toLowerCase(),
      amount: decimalToNumber(ledger.amount),
      balanceBefore: decimalToNumber(ledger.balanceBefore),
      balanceAfter: decimalToNumber(ledger.balanceAfter),
      referenceType: ledger.referenceType,
      referenceId: ledger.referenceId,
      note: ledger.note,
      createdAt: ledger.createdAt,
    }));
  }

  async listDepositRequests(user: AuthenticatedUser) {
    const shop = await this.shopsService.getSellerShop(user.id);
    return this.prisma.depositRequest.findMany({
      where: {
        sellerId: shop.sellerId,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 50,
    });
  }

  async listWithdrawRequests(user: AuthenticatedUser) {
    const shop = await this.shopsService.getSellerShop(user.id);
    return this.prisma.withdrawRequest.findMany({
      where: {
        sellerId: shop.sellerId,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 50,
    });
  }

  async createDepositRequest(user: AuthenticatedUser, dto: CreateDepositRequestDto) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const amount = Number(dto.amount);

    if (!Number.isInteger(amount) || amount < 100000) {
      throw new BadRequestException("Số tiền nạp tối thiểu là 100.000đ.");
    }

    const platformShopId = this.config.platformDepositShopId;
    if (!platformShopId) {
      throw new BadRequestException(
        "Tính năng nạp ví chưa được cấu hình. Vui lòng liên hệ admin.",
      );
    }

    const providerOverride =
      dto.paymentMethod === "USDT_SOL"
        ? "USDT_SOL"
        : dto.paymentMethod === "BINANCE"
          ? "BINANCE"
          : "PAYOS";

    // PayOS: 5 phút (chuyển ngân hàng nhanh) — USDT/Binance: 30 phút (chuyển crypto chậm hơn)
    const expiryMinutes = providerOverride === "PAYOS" ? 5 : 30;
    const externalOrderCode = generateExternalPaymentCode();
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);
    const payment = await this.paymentService.createPaymentLink({
      shopId: platformShopId,
      externalOrderCode,
      amount,
      description: `NAPVI-${externalOrderCode.slice(-6)}`,
      expiredAt: expiresAt,
      providerOverride: providerOverride as any,
    });

    const deposit = await this.prisma.depositRequest.create({
      data: {
        sellerId: shop.sellerId,
        amount: toDecimal(amount),
        provider: payment.provider,
        externalOrderCode,
        checkoutUrl: payment.checkoutUrl,
        qrCode: payment.qrCode,
        expiresAt,
        note: `WALLET_TOPUP:${shop.sellerId}${dto.note ? `:${dto.note}` : ""}`,
        rawPayloadJson: payment.providerPayload as Prisma.InputJsonValue,
      },
    });

    return {
      id: deposit.id,
      externalOrderCode,
      amount,
      provider: payment.provider,
      checkoutUrl: payment.checkoutUrl,
      qrCode: payment.qrCode,
      expiresAt,
      providerPayload: payment.providerPayload,
      bankInfo: (payment as any).bankInfo ?? null,
      manualCrypto: (payment as any).manualCrypto ?? null,
      reconcileToken: this.paymentService.buildPublicReconcileToken(externalOrderCode),
    };
  }

  async confirmDepositRequestByExternalOrderCode(externalOrderCode: string, rawPayload?: unknown) {
    const deposit = await this.prisma.depositRequest.findUnique({
      where: {
        externalOrderCode,
      },
    });

    if (!deposit) {
      throw new NotFoundException("Deposit request not found.");
    }

    // Upgrade deposits are handled by UpgradeService, not wallet
    if (deposit.note && deposit.note.startsWith("UPGRADE_TIER:")) {
      throw new NotFoundException("Deposit request not found.");
    }

    // Tier subscription deposits are handled by TiersService, not wallet
    if (deposit.note && deposit.note.startsWith("TIER_SUB:")) {
      throw new NotFoundException("Deposit request not found.");
    }

    if (deposit.status === DepositStatus.CONFIRMED) {
      return deposit;
    }

    if (deposit.status !== DepositStatus.PENDING) {
      return deposit;
    }

    await this.creditWallet(
      deposit.sellerId,
      decimalToNumber(deposit.amount),
      WalletLedgerType.TOPUP,
      "deposit_request",
      deposit.id,
      "Top up seller wallet from dashboard payment",
    );

    return this.prisma.depositRequest.update({
      where: {
        id: deposit.id,
      },
      data: {
        status: DepositStatus.CONFIRMED,
        paidAt: new Date(),
        approvedAt: new Date(),
        rawPayloadJson: rawPayload as Prisma.InputJsonValue,
        note: deposit.note ?? "Top up seller wallet from dashboard",
      },
    });
  }

  async cancelDepositRequest(user: AuthenticatedUser, depositId: string) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const deposit = await this.prisma.depositRequest.findUnique({
      where: { id: depositId },
      select: { id: true, sellerId: true, status: true, note: true },
    });
    if (!deposit) {
      throw new NotFoundException("Deposit request not found.");
    }
    if (deposit.sellerId !== shop.sellerId) {
      throw new NotFoundException("Deposit request not found.");
    }
    if (deposit.status !== DepositStatus.PENDING) {
      throw new BadRequestException("Chỉ có thể hủy yêu cầu đang chờ.");
    }
    return this.prisma.depositRequest.update({
      where: { id: deposit.id },
      data: {
        status: DepositStatus.REJECTED,
        note: deposit.note ? `${deposit.note} | Hủy bởi người dùng` : "Hủy bởi người dùng",
      },
    });
  }

  async cancelWithdrawRequest(user: AuthenticatedUser, withdrawId: string) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const withdraw = await this.prisma.withdrawRequest.findUnique({
      where: { id: withdrawId },
      select: { id: true, sellerId: true, status: true },
    });
    if (!withdraw) {
      throw new NotFoundException("Withdraw request not found.");
    }
    if (withdraw.sellerId !== shop.sellerId) {
      throw new NotFoundException("Withdraw request not found.");
    }
    if (withdraw.status !== WithdrawStatus.PENDING) {
      throw new BadRequestException("Chỉ có thể hủy yêu cầu đang chờ duyệt.");
    }
    return this.prisma.withdrawRequest.update({
      where: { id: withdraw.id },
      data: {
        status: WithdrawStatus.REJECTED,
        rejectReason: "Hủy bởi người dùng",
        reviewedAt: new Date(),
      },
    });
  }

  async adminListWithdrawRequests(adminUser: AuthenticatedUser, status?: WithdrawStatus) {
    if (adminUser.role !== "SUPER_ADMIN") {
      throw new ForbiddenException("Only super admin can list all withdraw requests.");
    }
    return this.prisma.withdrawRequest.findMany({
      where: status ? { status } : undefined,
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: {
        seller: {
          select: {
            id: true,
            displayName: true,
            user: { select: { email: true } },
            wallet: { select: { balance: true } },
          },
        },
        reviewedBy: { select: { id: true, email: true } },
      },
      take: 200,
    });
  }

  async adminApproveWithdrawRequest(
    adminUser: AuthenticatedUser,
    withdrawId: string,
    options?: { note?: string },
  ) {
    if (adminUser.role !== "SUPER_ADMIN") {
      throw new ForbiddenException("Only super admin can approve withdraw requests.");
    }
    return this.prisma.$transaction(async (tx) => {
      // Lock the withdraw row first to prevent concurrent admin double-approval
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM withdraw_requests WHERE id = ${withdrawId} FOR UPDATE`,
      );
      const withdraw = await tx.withdrawRequest.findUnique({
        where: { id: withdrawId },
        select: {
          id: true,
          sellerId: true,
          amount: true,
          status: true,
          note: true,
          bankName: true,
          bankAccountNumber: true,
          bankAccountName: true,
        },
      });
      if (!withdraw) throw new NotFoundException("Withdraw request not found.");
      if (withdraw.status !== WithdrawStatus.PENDING) {
        throw new BadRequestException(`Lệnh rút đang ở trạng thái ${withdraw.status}, không thể duyệt.`);
      }

      const amount = decimalToNumber(withdraw.amount);

      const wallet = await tx.sellerWallet.findUnique({ where: { sellerId: withdraw.sellerId } });
      if (!wallet) throw new NotFoundException("Wallet not found.");

      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM seller_wallets WHERE id = ${wallet.id} FOR UPDATE`,
      );
      const fresh = await tx.sellerWallet.findUniqueOrThrow({ where: { id: wallet.id } });
      const balanceBefore = decimalToNumber(fresh.balance);
      const balanceAfter = balanceBefore - amount;
      if (balanceAfter < 0) {
        throw new BadRequestException("Số dư ví không đủ để duyệt lệnh rút này.");
      }

      await tx.sellerWallet.update({
        where: { id: wallet.id },
        data: { balance: toDecimal(balanceAfter) },
      });

      await tx.walletLedger.create({
        data: {
          sellerId: withdraw.sellerId,
          walletId: wallet.id,
          type: WalletLedgerType.WITHDRAW,
          amount: toDecimal(-amount),
          balanceBefore: toDecimal(balanceBefore),
          balanceAfter: toDecimal(balanceAfter),
          referenceType: "withdraw_request",
          referenceId: withdraw.id,
          note: options?.note
            ? `${withdraw.note ? withdraw.note + " | " : ""}admin approved: ${options.note}`
            : `Admin duyệt lệnh rút ${withdraw.id.slice(0, 8)}`,
        },
      });

      const updated = await tx.withdrawRequest.update({
        where: { id: withdraw.id },
        data: {
          status: WithdrawStatus.APPROVED,
          reviewedById: adminUser.id,
          reviewedAt: new Date(),
          note: options?.note
            ? `${withdraw.note ? withdraw.note + "\n" : ""}[admin] ${options.note}`
            : withdraw.note,
        },
      });

      // Fire-and-forget notification email — don't block the transaction
      this.sendWithdrawNotificationEmail({
        sellerId: withdraw.sellerId,
        status: "APPROVED",
        amount,
        bankName: withdraw.bankName,
        bankAccountNumber: withdraw.bankAccountNumber,
        bankAccountName: withdraw.bankAccountName,
        note: options?.note,
      }).catch((err) => console.error("[withdraw-notify approve]", err));

      return updated;
    });
  }

  async adminRejectWithdrawRequest(
    adminUser: AuthenticatedUser,
    withdrawId: string,
    reason: string,
  ) {
    if (adminUser.role !== "SUPER_ADMIN") {
      throw new ForbiddenException("Only super admin can reject withdraw requests.");
    }
    const reasonTrim = String(reason || "").trim();
    if (!reasonTrim) {
      throw new BadRequestException("Phải nhập lý do từ chối.");
    }
    const updated = await this.prisma.withdrawRequest.updateMany({
      where: { id: withdrawId, status: WithdrawStatus.PENDING },
      data: {
        status: WithdrawStatus.REJECTED,
        rejectReason: reasonTrim,
        reviewedById: adminUser.id,
        reviewedAt: new Date(),
      },
    });
    if (updated.count === 0) {
      const existing = await this.prisma.withdrawRequest.findUnique({
        where: { id: withdrawId },
        select: { status: true },
      });
      if (!existing) throw new NotFoundException("Withdraw request not found.");
      throw new BadRequestException(`Lệnh rút đang ở trạng thái ${existing.status}, không thể từ chối.`);
    }
    const result = await this.prisma.withdrawRequest.findUnique({ where: { id: withdrawId } });

    if (result) {
      this.sendWithdrawNotificationEmail({
        sellerId: result.sellerId,
        status: "REJECTED",
        amount: decimalToNumber(result.amount),
        bankName: result.bankName,
        bankAccountNumber: result.bankAccountNumber,
        bankAccountName: result.bankAccountName,
        rejectReason: reasonTrim,
      }).catch((err) => console.error("[withdraw-notify reject]", err));
    }

    return result;
  }

  async expirePendingDepositRequests(limit = 50) {
    const expiredRequests = await this.prisma.depositRequest.findMany({
      where: {
        status: DepositStatus.PENDING,
        externalOrderCode: {
          not: null,
        },
        expiresAt: {
          lte: new Date(),
        },
      },
      orderBy: {
        expiresAt: "asc",
      },
      take: limit,
    });

    for (const request of expiredRequests) {
      await this.prisma.depositRequest.updateMany({
        where: {
          id: request.id,
          status: DepositStatus.PENDING,
        },
        data: {
          status: DepositStatus.REJECTED,
          note: request.note || "Expired payment link",
        },
      });
    }

    return expiredRequests.length;
  }

  async createWithdrawRequest(user: AuthenticatedUser, dto: CreateWithdrawRequestDto) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const amount = Number(dto.amount);

    if (!Number.isInteger(amount) || amount < 100000) {
      throw new BadRequestException("Số tiền rút tối thiểu là 100.000đ.");
    }

    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.sellerWallet.findUnique({
        where: { sellerId: shop.sellerId },
      });

      if (!wallet) {
        throw new NotFoundException("Wallet not found.");
      }

      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM seller_wallets WHERE id = ${wallet.id} FOR UPDATE`,
      );

      const pendingWithdrawAggregate = await tx.withdrawRequest.aggregate({
        where: {
          sellerId: shop.sellerId,
          status: WithdrawStatus.PENDING,
        },
        _sum: {
          amount: true,
        },
      });
      const balance = decimalToNumber(wallet.balance);
      const pendingWithdrawAmount = decimalToNumber(pendingWithdrawAggregate._sum.amount);
      const withdrawableBalance = Math.max(0, balance - pendingWithdrawAmount);

      if (withdrawableBalance < amount) {
        throw new BadRequestException("Insufficient withdrawable wallet balance.");
      }

      return tx.withdrawRequest.create({
        data: {
          sellerId: shop.sellerId,
          amount: toDecimal(amount),
          bankName: dto.bankName,
          bankAccountNumber: dto.bankAccountNumber,
          bankAccountName: dto.bankAccountName,
          note: dto.note ?? null,
        },
      });
    });
  }

  async debitForOrder(
    sellerId: string,
    amount: number,
    referenceId: string,
    note = "Debit wallet for upstream purchase",
  ) {
    return this.applyWalletMutation(
      sellerId,
      amount * -1,
      WalletLedgerType.DEBIT_PURCHASE,
      "order",
      referenceId,
      note,
    );
  }

  async refundForOrder(
    sellerId: string,
    amount: number,
    referenceId: string,
    note = "Refund wallet after upstream failure",
  ) {
    return this.applyWalletMutation(
      sellerId,
      amount,
      WalletLedgerType.REFUND_PURCHASE,
      "order",
      referenceId,
      note,
    );
  }

  async creditWallet(
    sellerId: string,
    amount: number,
    type: WalletLedgerType,
    referenceType: string,
    referenceId: string,
    note?: string,
  ) {
    return this.applyWalletMutation(
      sellerId,
      amount,
      type,
      referenceType,
      referenceId,
      note,
    );
  }

  private async applyWalletMutation(
    sellerId: string,
    delta: number,
    type: WalletLedgerType,
    referenceType: string,
    referenceId: string,
    note?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.sellerWallet.findUnique({
        where: { sellerId },
      });

      if (!wallet) {
        throw new NotFoundException("Wallet not found.");
      }

      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM seller_wallets WHERE id = ${wallet.id} FOR UPDATE`,
      );

      const balanceBefore = decimalToNumber(wallet.balance);
      const balanceAfter = balanceBefore + delta;

      if (balanceAfter < 0) {
        throw new BadRequestException("Insufficient wallet balance.");
      }

      const updatedWallet = await tx.sellerWallet.update({
        where: { id: wallet.id },
        data: {
          balance: toDecimal(balanceAfter),
        },
      });

      const ledger = await tx.walletLedger.create({
        data: {
          sellerId,
          walletId: wallet.id,
          type,
          amount: toDecimal(delta),
          balanceBefore: toDecimal(balanceBefore),
          balanceAfter: toDecimal(balanceAfter),
          referenceType,
          referenceId,
          note: note ?? null,
        },
      });

      return {
        wallet: updatedWallet,
        ledger,
      };
    });
  }

  async getCustomerWallets(user: AuthenticatedUser) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const usdtVndRate = this.config.usdtVndRate;

    const [customers, apiConnections] = await Promise.all([
      this.prisma.customer.findMany({
        where: { shopId: shop.id },
        include: {
          wallet: {
            include: {
              topups: {
                where: { status: PaymentTransactionStatus.PAID },
                orderBy: { createdAt: "desc" },
                take: 1,
                select: { createdAt: true, amount: true },
              },
            },
          },
        },
        orderBy: [
          { wallet: { balance: "desc" } },
          { createdAt: "desc" },
        ],
      }),
      this.prisma.downstreamSourceConnection.findMany({
        where: { upstreamShopId: shop.id },
        select: { downstreamTelegramChatId: true },
      }),
    ]);

    const apiConnectedChatIds = new Set(
      apiConnections.map((c) => c.downstreamTelegramChatId).filter(Boolean),
    );

    return {
      usdtVndRate,
      items: customers.map((c) => {
        const displayName = [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || null;
        const balance = c.wallet ? decimalToNumber(c.wallet.balance) : 0;
        const commissionBalance = c.wallet ? decimalToNumber(c.wallet.commissionBalance) : 0;
        const balanceUsdt = c.wallet ? decimalToNumber(c.wallet.balanceUsdt) : 0;
        return {
          id: c.wallet?.id ?? c.id,
          customerId: c.id,
          balance,
          commissionBalance,
          balanceUsdt,
          currency: c.wallet?.currency ?? "VND",
          updatedAt: c.wallet?.updatedAt ?? c.updatedAt,
          telegramUsername: c.telegramUsername,
          telegramUserId: c.telegramUserId,
          telegramChatId: c.telegramChatId,
          name: displayName,
          isCtv: c.isCtv,
          blacklisted: c.blacklisted,
          discountPercent: c.discountPercent,
          isApiConnected: apiConnectedChatIds.has(c.telegramChatId),
          lastTopupAt: c.wallet?.topups[0]?.createdAt ?? null,
          lastTopupAmount: c.wallet?.topups[0] ? decimalToNumber(c.wallet.topups[0].amount) : null,
        };
      }),
    };
  }

  private async sendWithdrawNotificationEmail(input: {
    sellerId: string;
    status: "APPROVED" | "REJECTED";
    amount: number;
    bankName: string | null;
    bankAccountNumber: string | null;
    bankAccountName: string | null;
    note?: string | null;
    rejectReason?: string | null;
  }) {
    const seller = await this.prisma.seller.findUnique({
      where: { id: input.sellerId },
      select: { displayName: true, user: { select: { recoveryEmail: true, email: true } } },
    });
    const to = seller?.user?.recoveryEmail || null;
    if (!to) {
      console.log(`[withdraw-notify] no email for seller ${input.sellerId}, skipping`);
      return;
    }

    const amountStr = input.amount.toLocaleString("vi-VN") + "đ";
    const bankInfo = `${input.bankName ?? "?"} • ${input.bankAccountNumber ?? "?"} • ${input.bankAccountName ?? "?"}`;
    const escape = (s: string | null | undefined) => String(s || "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");

    const subject = input.status === "APPROVED"
      ? `✅ Yêu cầu rút ${amountStr} đã được duyệt`
      : `❌ Yêu cầu rút ${amountStr} đã bị từ chối`;

    const text = input.status === "APPROVED"
      ? `Xin chào ${seller?.displayName ?? ""},\n\nYêu cầu rút ${amountStr} của bạn đã được admin duyệt.\nThông tin chuyển khoản: ${bankInfo}\nGhi chú admin: ${input.note || "(không)"}\n\nSố tiền sẽ được chuyển vào tài khoản trong vòng 24 giờ.`
      : `Xin chào ${seller?.displayName ?? ""},\n\nYêu cầu rút ${amountStr} của bạn đã bị từ chối.\nLý do: ${input.rejectReason || "(không nêu)"}\n\nSố tiền vẫn còn nguyên trong ví của bạn. Bạn có thể tạo yêu cầu mới hoặc liên hệ admin để biết thêm chi tiết.`;

    const html = input.status === "APPROVED"
      ? `
        <div style="font-family:sans-serif;max-width:560px">
          <h2 style="color:#10b981">✅ Yêu cầu rút tiền đã được duyệt</h2>
          <p>Xin chào <b>${escape(seller?.displayName)}</b>,</p>
          <p>Yêu cầu rút <b>${escape(amountStr)}</b> của bạn đã được admin duyệt.</p>
          <table style="border-collapse:collapse;margin:16px 0">
            <tr><td style="padding:4px 12px 4px 0;color:#666">Ngân hàng:</td><td><b>${escape(input.bankName)}</b></td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#666">Số tài khoản:</td><td><code>${escape(input.bankAccountNumber)}</code></td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#666">Chủ tài khoản:</td><td>${escape(input.bankAccountName)}</td></tr>
            ${input.note ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Ghi chú admin:</td><td>${escape(input.note)}</td></tr>` : ""}
          </table>
          <p>Số tiền sẽ được chuyển vào tài khoản trong vòng <b>24 giờ</b>.</p>
        </div>`
      : `
        <div style="font-family:sans-serif;max-width:560px">
          <h2 style="color:#ef4444">❌ Yêu cầu rút tiền bị từ chối</h2>
          <p>Xin chào <b>${escape(seller?.displayName)}</b>,</p>
          <p>Yêu cầu rút <b>${escape(amountStr)}</b> của bạn đã bị từ chối.</p>
          <p style="background:#fef2f2;border-left:4px solid #ef4444;padding:12px 16px;color:#991b1b">
            <b>Lý do:</b> ${escape(input.rejectReason || "(không nêu)")}
          </p>
          <p>Số tiền vẫn còn nguyên trong ví của bạn. Bạn có thể tạo yêu cầu mới hoặc liên hệ admin để biết thêm chi tiết.</p>
        </div>`;

    if (!this.config.resendApiKey) {
      console.log(`[withdraw-notify] DRY (no Resend key) → ${to}: ${subject}`);
      return;
    }

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from: this.config.mailFrom, to: [to], subject, text, html }),
      });
      if (!response.ok) {
        console.error(`[withdraw-notify] Failed: ${response.status} ${await response.text()}`);
      }
    } catch (error) {
      console.error("[withdraw-notify] Email send failed", error);
    }
  }

  async adjustCustomerWallet(user: AuthenticatedUser, customerId: string, dto: AdjustCustomerWalletDto) {
    const shop = await this.shopsService.getSellerShop(user.id);

    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, shopId: shop.id },
    });
    if (!customer) throw new NotFoundException("Customer not found.");

    const USDT_VND_RATE = this.config.usdtVndRate || 27000;

    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.customerWallet.upsert({
        where: { customerId },
        update: {},
        create: { customerId, balance: toDecimal(0), balanceUsdt: toDecimal(0) },
      });

      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM customer_wallets WHERE id = ${wallet.id} FOR UPDATE`,
      );

      const isUsdt = dto.currency === "USDT";
      const balanceBefore = isUsdt ? decimalToNumber(wallet.balanceUsdt) : decimalToNumber(wallet.balance);
      let delta: number;
      let balanceAfter: number;

      if (dto.action === "topup") {
        delta = dto.amount;
        balanceAfter = balanceBefore + delta;
      } else if (dto.action === "deduct") {
        delta = -dto.amount;
        balanceAfter = balanceBefore + delta;
        if (balanceAfter < 0) {
          throw new BadRequestException("Số dư không đủ để trừ.");
        }
      } else {
        delta = dto.amount - balanceBefore;
        balanceAfter = dto.amount;
      }

      // Sync the other currency (topup/deduct only, not set)
      const syncOther = dto.action === "topup" || dto.action === "deduct";
      const syncDelta = isUsdt ? delta * USDT_VND_RATE : delta / USDT_VND_RATE;
      const syncBalanceBefore = isUsdt ? decimalToNumber(wallet.balance) : decimalToNumber(wallet.balanceUsdt);
      const syncBalanceAfter = Math.max(0, syncBalanceBefore + syncDelta);

      const updatedWallet = await tx.customerWallet.update({
        where: { id: wallet.id },
        data: isUsdt
          ? {
              balanceUsdt: toDecimal(balanceAfter),
              ...(syncOther ? { balance: toDecimal(syncBalanceAfter) } : {}),
            }
          : {
              balance: toDecimal(balanceAfter),
              ...(syncOther ? { balanceUsdt: toDecimal(syncBalanceAfter) } : {}),
            },
      });

      await tx.customerWalletLedger.create({
        data: {
          customerId,
          walletId: wallet.id,
          type: CustomerWalletLedgerType.ADJUST,
          currency: isUsdt ? "USDT" : "VND",
          amount: toDecimal(delta),
          balanceBefore: toDecimal(balanceBefore),
          balanceAfter: toDecimal(balanceAfter),
          referenceType: "manual_adjust",
          referenceId: customerId,
          note: `Manual ${dto.action} by seller`,
        },
      });

      if (syncOther) {
        await tx.customerWalletLedger.create({
          data: {
            customerId,
            walletId: wallet.id,
            type: CustomerWalletLedgerType.ADJUST,
            currency: isUsdt ? "VND" : "USDT",
            amount: toDecimal(syncDelta),
            balanceBefore: toDecimal(syncBalanceBefore),
            balanceAfter: toDecimal(syncBalanceAfter),
            referenceType: "manual_adjust",
            referenceId: customerId,
            note: `Auto-sync ${isUsdt ? "VND" : "USDT"} from ${isUsdt ? "USDT" : "VND"} ${dto.action}`,
          },
        });
      }

      return {
        balance: decimalToNumber(updatedWallet.balance),
        balanceUsdt: decimalToNumber(updatedWallet.balanceUsdt),
        balanceBefore,
        balanceAfter,
      };
    });
  }

  async getCustomerTopupHistory(user: AuthenticatedUser, customerId: string) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const ledgers = await this.prisma.customerWalletLedger.findMany({
      where: { customer: { shopId: shop.id, id: customerId } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return ledgers.map((l) => ({
      id: l.id,
      type: l.type,
      currency: l.currency,
      amount: decimalToNumber(l.amount),
      balanceBefore: decimalToNumber(l.balanceBefore),
      balanceAfter: decimalToNumber(l.balanceAfter),
      note: l.note,
      createdAt: l.createdAt,
    }));
  }

  private async getPendingWithdrawAmount(sellerId: string) {
    const aggregate = await this.prisma.withdrawRequest.aggregate({
      where: {
        sellerId,
        status: WithdrawStatus.PENDING,
      },
      _sum: {
        amount: true,
      },
    });

    return decimalToNumber(aggregate._sum.amount);
  }
}
