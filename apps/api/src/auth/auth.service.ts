import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { SellerTier, UserRole, UserStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

import { AppConfigService } from "../config/app-config.service";
import {
  getSellerCapabilities,
  isSellerReadOnly,
} from "../business/seller-tier";
import { PrismaService } from "../db/prisma.service";
import { MailService } from "../lib/mail.service";
import { decimalToNumber, durationToMs, hashValue, slugify, toDecimal } from "../lib/utils";

import type { AuthenticatedUser } from "../types";
import type { CreateSellerByAdminDto, UpdateSellerByAdminDto } from "./auth.dto";

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(JwtService)
    private readonly jwtService: JwtService,
    @Inject(AppConfigService)
    private readonly config: AppConfigService,
    @Inject(MailService)
    private readonly mail: MailService,
  ) {}

  async login(username: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: username.toLowerCase().trim() },
      include: {
        seller: true,
      },
    });

    if (!user || user.status !== "ACTIVE") {
      throw new UnauthorizedException("Invalid username or password.");
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);

    if (!isValid) {
      throw new UnauthorizedException("Invalid username or password.");
    }

    return this.issueAuthResponse({
      id: user.id,
      email: user.email,
      role: user.role,
    });
  }

  async refresh(refreshToken: string) {
    const payload = await this.jwtService.verifyAsync<{ sub: string }>(refreshToken, {
      secret: this.config.refreshSecret,
    });
    const tokenHash = hashValue(refreshToken);
    const storedToken = await this.prisma.refreshToken.findFirst({
      where: {
        userId: payload.sub,
        tokenHash,
        revokedAt: null,
        expiresAt: {
          gt: new Date(),
        },
      },
      include: {
        user: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (!storedToken || storedToken.user.status !== "ACTIVE") {
      throw new UnauthorizedException("Refresh token is invalid.");
    }

    await this.prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: {
        revokedAt: new Date(),
      },
    });

    return this.issueAuthResponse({
      id: storedToken.user.id,
      email: storedToken.user.email,
      role: storedToken.user.role,
    });
  }

  async requestPasswordReset(email: string) {
    const genericResponse = {
      message:
        "Nếu email khôi phục tồn tại trong hệ thống, chúng tôi đã gửi link đặt lại mật khẩu.",
    };
    const normalizedEmail = this.normalizeRecoveryEmail(email);

    if (!normalizedEmail) {
      return genericResponse;
    }

    const user = await this.prisma.user.findFirst({
      where: {
        recoveryEmail: normalizedEmail,
        status: UserStatus.ACTIVE,
      },
      include: {
        seller: {
          select: {
            displayName: true,
          },
        },
      },
    });

    if (!user) {
      return genericResponse;
    }

    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = hashValue(rawToken);
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + this.config.passwordResetTtlMinutes * 60 * 1000,
    );
    const resetLink = this.buildPasswordResetLink(rawToken);

    await this.prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.updateMany({
        where: {
          userId: user.id,
          usedAt: null,
        },
        data: {
          usedAt: now,
        },
      });

      await tx.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt,
        },
      });
    });

    await this.deliverPasswordResetEmail({
      to: normalizedEmail,
      displayName: user.seller?.displayName || user.email,
      resetLink,
    });

    if (this.config.nodeEnv !== "production" && !this.config.resendApiKey) {
      return {
        ...genericResponse,
        devResetLink: resetLink,
      };
    }

    return genericResponse;
  }

  async resetPassword(token: string, newPassword: string) {
    const normalizedToken = token.trim();

    if (!normalizedToken) {
      throw new BadRequestException("Link đặt lại mật khẩu không hợp lệ.");
    }

    const resetToken = await this.prisma.passwordResetToken.findFirst({
      where: {
        tokenHash: hashValue(normalizedToken),
        usedAt: null,
        expiresAt: {
          gt: new Date(),
        },
      },
      include: {
        user: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (!resetToken || resetToken.user.status !== UserStatus.ACTIVE) {
      throw new BadRequestException("Link đặt lại mật khẩu đã hết hạn hoặc không hợp lệ.");
    }

    this.assertStrongPassword(newPassword);
    const nextPasswordHash = await bcrypt.hash(newPassword, 10);
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: resetToken.userId },
        data: {
          passwordHash: nextPasswordHash,
        },
      });

      await tx.passwordResetToken.update({
        where: { id: resetToken.id },
        data: {
          usedAt: now,
        },
      });

      await tx.refreshToken.updateMany({
        where: {
          userId: resetToken.userId,
          revokedAt: null,
        },
        data: {
          revokedAt: now,
        },
      });
    });

    return {
      message: "Đặt lại mật khẩu thành công. Bạn có thể đăng nhập bằng mật khẩu mới.",
    };
  }

  async createSellerAccountByAdmin(dto: CreateSellerByAdminDto) {
    const created = await this.createSellerAccount({
      username: dto.username,
      password: dto.password,
      displayName: dto.displayName,
      shopName: dto.shopName,
      recoveryEmail: dto.recoveryEmail,
      sellerTier: dto.sellerTier || SellerTier.PRO,
    });

    return {
      id: created.user.id,
      username: created.user.email,
      recoveryEmail: created.user.recoveryEmail,
      role: created.user.role.toLowerCase(),
      displayName: created.seller.displayName,
      sellerId: created.seller.id,
      sellerTier: created.seller.tier.toLowerCase(),
      shopId: created.shop.id,
      shopName: created.shop.name,
      shopSlug: created.shop.slug,
      createdAt: created.user.createdAt,
    };
  }

  async updateSellerAccountByAdmin(userId: string, dto: UpdateSellerByAdminDto) {
    const target = await this.getManagedSellerUserOrThrow(userId);
    const managedSeller = target.seller!;
    const nextUsername = dto.username?.trim().toLowerCase();
    const nextDisplayName = dto.displayName?.trim();
    const nextShopName = dto.shopName?.trim();
    const nextPassword = dto.password?.trim();
    const nextSellerTier = dto.sellerTier;
    const hasRecoveryEmailInput = Object.prototype.hasOwnProperty.call(dto, "recoveryEmail");
    const nextRecoveryEmail = hasRecoveryEmailInput
      ? this.normalizeRecoveryEmail(dto.recoveryEmail)
      : undefined;

    if (nextUsername && nextUsername !== target.email) {
      const existing = await this.prisma.user.findUnique({
        where: { email: nextUsername },
        select: { id: true },
      });

      if (existing && existing.id !== target.id) {
        throw new BadRequestException("Username already exists.");
      }
    }

    if (nextRecoveryEmail) {
      await this.ensureRecoveryEmailAvailable(nextRecoveryEmail, target.id);
    }

    if (nextPassword) {
      this.assertStrongPassword(nextPassword);
    }

    const passwordHash = nextPassword ? await bcrypt.hash(nextPassword, 10) : null;
    const revokeSessions = Boolean(passwordHash || (nextUsername && nextUsername !== target.email));
    const now = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: target.id },
        data: {
          email: nextUsername || undefined,
          recoveryEmail: hasRecoveryEmailInput ? nextRecoveryEmail : undefined,
          passwordHash: passwordHash || undefined,
        },
      });

      const updatedSeller = await tx.seller.update({
        where: { id: managedSeller.id },
        data: {
          displayName: nextDisplayName || undefined,
          tier: nextSellerTier || undefined,
        },
      });

      const primaryShop = managedSeller.shops[0]
        ? await tx.shop.update({
            where: { id: managedSeller.shops[0].id },
            data: {
              name: nextShopName || undefined,
            },
          })
        : null;

      if (revokeSessions) {
        await tx.refreshToken.updateMany({
          where: {
            userId: target.id,
            revokedAt: null,
          },
          data: {
            revokedAt: now,
          },
        });
      }

      return { user, updatedSeller, primaryShop };
    });

    return {
      id: updated.user.id,
      username: updated.user.email,
      recoveryEmail: updated.user.recoveryEmail,
      role: updated.user.role.toLowerCase(),
      status: updated.user.status.toLowerCase(),
      displayName: updated.updatedSeller.displayName,
      sellerTier: updated.updatedSeller.tier.toLowerCase(),
      sellerStatus: updated.updatedSeller.status.toLowerCase(),
      shopId: updated.primaryShop?.id || managedSeller.shops[0]?.id || null,
      shopName: updated.primaryShop?.name || managedSeller.shops[0]?.name || null,
      shopSlug: updated.primaryShop?.slug || managedSeller.shops[0]?.slug || null,
    };
  }

  async setSellerAccountDisabledByAdmin(userId: string, disabled: boolean) {
    const target = await this.getManagedSellerUserOrThrow(userId);
    const managedSeller = target.seller!;
    const now = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: target.id },
        data: {
          status: disabled ? "DISABLED" : "ACTIVE",
        },
      });

      const updatedSeller = await tx.seller.update({
        where: { id: managedSeller.id },
        data: {
          status: disabled ? "DISABLED" : "ACTIVE",
        },
      });

      for (const shop of managedSeller.shops) {
        await tx.shop.update({
          where: { id: shop.id },
          data: {
            status: disabled
              ? "SUSPENDED"
              : shop.providerConfig?.connectionStatus === "VERIFIED"
                ? "ACTIVE"
                : "DRAFT",
          },
        });
      }

      await tx.refreshToken.updateMany({
        where: {
          userId: target.id,
          revokedAt: null,
        },
        data: {
          revokedAt: now,
        },
      });

      return { user, updatedSeller };
    });

    return {
      id: updated.user.id,
      username: updated.user.email,
      status: updated.user.status.toLowerCase(),
      sellerStatus: updated.updatedSeller.status.toLowerCase(),
      message: disabled ? "Đã khóa tài khoản CTV." : "Đã mở khóa tài khoản CTV.",
    };
  }

  async deleteSellerAccountByAdmin(userId: string, force = false) {
    const target = await this.getManagedSellerUserOrThrow(userId);
    const seller = target.seller!;
    const walletBalance = seller.wallet
      ? decimalToNumber(seller.wallet.balance)
      : 0;

    // Block if there are real financial records or active orders — customers
    // alone don't count (bot interactions without purchases shouldn't lock deletion).
    const hasHardData =
      seller._count.orders > 0 ||
      seller._count.deposits > 0 ||
      seller._count.withdraws > 0 ||
      walletBalance > 0;

    if (hasHardData && !force) {
      throw new BadRequestException(
        `Tài khoản có ${seller._count.orders} đơn, ${seller._count.deposits} giao dịch nạp, số dư ${walletBalance}₫. Dùng force=true để xóa bắt buộc, hoặc khóa tài khoản thay vì xóa.`,
      );
    }

    await this.prisma.user.delete({
      where: { id: target.id },
    });

    return {
      success: true,
      id: target.id,
      username: target.email,
      forced: force,
    };
  }

  async listSellerAccountsForAdmin() {
    const users = await this.prisma.user.findMany({
      where: {
        role: UserRole.SELLER,
      },
      orderBy: {
        createdAt: "desc",
      },
      include: {
        seller: {
          include: {
            shops: {
              include: {
                providerConfig: {
                  select: {
                    connectionStatus: true,
                  },
                },
              },
              orderBy: {
                createdAt: "asc",
              },
              take: 1,
            },
            wallet: true,
            _count: {
              select: {
                customers: true,
                orders: true,
                ledgers: true,
                deposits: true,
                withdraws: true,
                broadcasts: true,
              },
            },
          },
        },
      },
      take: 200,
    });

    return users.map((user) => ({
      id: user.id,
      username: user.email,
      recoveryEmail: user.recoveryEmail,
      role: user.role.toLowerCase(),
      status: user.status.toLowerCase(),
      createdAt: user.createdAt,
      displayName: user.seller?.displayName || null,
      sellerTier: user.seller?.tier.toLowerCase() || null,
      sellerStatus: user.seller?.status.toLowerCase() || null,
      shopId: user.seller?.shops[0]?.id || null,
      shopName: user.seller?.shops[0]?.name || null,
      shopSlug: user.seller?.shops[0]?.slug || null,
      walletBalance: user.seller?.wallet ? decimalToNumber(user.seller.wallet.balance) : 0,
      shopStatus: user.seller?.shops[0]?.status.toLowerCase() || null,
      orderCount: user.seller?._count.orders ?? 0,
      customerCount: user.seller?._count.customers ?? 0,
      depositCount: user.seller?._count.deposits ?? 0,
    }));
  }

  async me(user: Pick<AuthenticatedUser, "id">) {
    const me = await this.prisma.user.findUnique({
      where: { id: user.id },
      include: {
        seller: true,
      },
    });

    if (!me) {
      throw new UnauthorizedException("User not found.");
    }

    let referrer: { referralCode: string | null; displayName: string | null } | null = null;
    if (me.seller?.referredBySellerId) {
      const ref = await this.prisma.seller.findUnique({
        where: { id: me.seller.referredBySellerId },
        select: { referralCode: true, displayName: true },
      });
      if (ref) {
        referrer = { referralCode: ref.referralCode, displayName: ref.displayName };
      }
    }

    return {
      id: me.id,
      email: me.email,
      recoveryEmail: me.recoveryEmail,
      role: me.role.toLowerCase(),
      displayName: me.seller?.displayName || null,
      sellerId: me.seller?.id || null,
      sellerTier: me.seller?.tier.toLowerCase() || null,
      sellerTierStartedAt: me.seller?.tierStartedAt || null,
      sellerTierExpiresAt: me.seller?.tierExpiresAt || null,
      sellerStatus: me.seller?.status.toLowerCase() || null,
      sellerCapabilities: getSellerCapabilities(me.seller?.tier).map((item) =>
        item.toLowerCase(),
      ),
      sellerReadOnly: isSellerReadOnly(me.seller?.tier),
      referralCode: me.seller?.referralCode || null,
      hasReferrer: Boolean(me.seller?.referredBySellerId),
      referrer,
    };
  }

  async updateRecoveryEmail(userId: string, recoveryEmail: string | null | undefined) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
      },
    });

    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException("User not found.");
    }

    const nextRecoveryEmail = this.normalizeRecoveryEmail(recoveryEmail);

    if (nextRecoveryEmail) {
      await this.ensureRecoveryEmailAvailable(nextRecoveryEmail, user.id);
    }

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        recoveryEmail: nextRecoveryEmail,
      },
      select: {
        recoveryEmail: true,
      },
    });

    return {
      recoveryEmail: updated.recoveryEmail,
      message: updated.recoveryEmail
        ? "Đã cập nhật email khôi phục."
        : "Đã xóa email khôi phục.",
    };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        passwordHash: true,
      },
    });

    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException("User not found.");
    }

    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.passwordHash);

    if (!isCurrentPasswordValid) {
      throw new BadRequestException("Mật khẩu hiện tại không đúng.");
    }

    if (currentPassword === newPassword) {
      throw new BadRequestException("Mật khẩu mới phải khác mật khẩu hiện tại.");
    }

    this.assertStrongPassword(newPassword);
    const nextPasswordHash = await bcrypt.hash(newPassword, 10);
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash: nextPasswordHash,
        },
      });

      await tx.refreshToken.updateMany({
        where: {
          userId: user.id,
          revokedAt: null,
        },
        data: {
          revokedAt: now,
        },
      });
    });

    return this.issueAuthResponse({
      id: user.id,
      email: user.email,
      role: user.role,
    });
  }

  private async issueAuthResponse(
    user: Pick<AuthenticatedUser, "id" | "email" | "role">,
  ) {
    const accessToken = await this.jwtService.signAsync(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
      },
      {
        secret: this.config.accessSecret,
        expiresIn: this.config.accessExpiresIn as any,
      },
    );

    const refreshToken = await this.jwtService.signAsync(
      {
        sub: user.id,
      },
      {
        secret: this.config.refreshSecret,
        expiresIn: this.config.refreshExpiresIn as any,
      },
    );

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashValue(refreshToken),
        expiresAt: new Date(Date.now() + durationToMs(this.config.refreshExpiresIn)),
      },
    });

    const me = await this.me(user);

    return {
      accessToken,
      refreshToken,
      user: me,
    };
  }

  private async createSellerAccount(input: {
    username: string;
    password: string;
    displayName: string;
    shopName?: string;
    recoveryEmail?: string | null;
    sellerTier?: SellerTier;
    referralCode?: string | null;
    signupIp?: string | null;
    signupDeviceFingerprint?: string | null;
  }) {
    const username = input.username.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({
      where: { email: username },
      select: { id: true },
    });

    if (existing) {
      throw new UnauthorizedException("Username already exists.");
    }

    const recoveryEmail = this.normalizeRecoveryEmail(input.recoveryEmail);

    if (recoveryEmail) {
      await this.ensureRecoveryEmailAvailable(recoveryEmail);
    }

    this.assertStrongPassword(input.password);
    const passwordHash = await bcrypt.hash(input.password, 10);
    const displayName = input.displayName.trim();
    const shopName = input.shopName?.trim() || displayName;

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: username,
          recoveryEmail,
          passwordHash,
          role: UserRole.SELLER,
          status: UserStatus.ACTIVE,
        },
      });

      // Generate unique referral code for new seller
      let referralCode: string | null = null;
      const charset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      for (let attempt = 0; attempt < 20; attempt++) {
        let code = "";
        for (let i = 0; i < 8; i++) code += charset[Math.floor(Math.random() * charset.length)];
        const existing = await tx.seller.findUnique({ where: { referralCode: code } });
        if (!existing) {
          referralCode = code;
          break;
        }
      }

      // Resolve referrer from referralCode if provided.
      // Looks up Seller.referralCode first, then falls back to active DiscountCode.code
      // (so admin-created custom codes like "LAMTHANHTHIEN" can also act as ref).
      let referredBySellerId: string | null = null;
      if (input.referralCode) {
        const normalizedRef = input.referralCode.trim().toUpperCase();
        if (normalizedRef.length >= 4) {
          const referrer = await tx.seller.findUnique({
            where: { referralCode: normalizedRef },
            select: { id: true },
          });
          if (referrer) {
            referredBySellerId = referrer.id;
          } else {
            const discountCode = await tx.discountCode.findUnique({
              where: { code: normalizedRef },
              select: { active: true, referrerSellerId: true },
            });
            if (discountCode?.active) {
              referredBySellerId = discountCode.referrerSellerId;
            }
          }
        }
      }

      const seller = await tx.seller.create({
        data: {
          userId: user.id,
          displayName,
          status: "ACTIVE",
          tier: input.sellerTier || SellerTier.PRO,
          referralCode,
          referredBySellerId,
          signupIp: input.signupIp ?? null,
          signupDeviceFingerprint: input.signupDeviceFingerprint ?? null,
        },
      });

      const shop = await tx.shop.create({
        data: {
          sellerId: seller.id,
          slug: `${slugify(displayName)}-${Math.random().toString(36).slice(2, 6)}`,
          name: shopName,
          status: "DRAFT",
          defaultCurrency: this.config.defaultCurrency,
        },
      });

      await tx.sellerWallet.create({
        data: {
          sellerId: seller.id,
          balance: toDecimal(0),
          currency: this.config.defaultCurrency,
        },
      });

      await tx.botConfig.create({
        data: {
          shopId: shop.id,
          telegramBotTokenEncrypted: "",
          webhookStatus: "DISABLED",
          deliveryMode: "POLLING",
        },
      });

      await tx.providerConfig.create({
        data: {
          shopId: shop.id,
          providerName: this.config.providerName,
          baseUrl: this.config.providerBaseUrl,
          buyerKeyEncrypted: "",
          connectionStatus: "PENDING",
        },
      });

      await tx.paymentConfig.create({
        data: {
          shopId: shop.id,
          provider: this.config.paymentMode === "payos" ? "PAYOS" : "MOCK",
        },
      });

      return {
        user,
        seller,
        shop,
      };
    });
  }

  private normalizeRecoveryEmail(value: string | null | undefined) {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    return normalized || null;
  }

  private assertStrongPassword(password: string) {
    const value = String(password || "");

    if (value.length < 6) {
      throw new BadRequestException("Mật khẩu phải có ít nhất 6 ký tự.");
    }

    if (/\s/.test(value)) {
      throw new BadRequestException("Mật khẩu không được chứa khoảng trắng.");
    }
  }

  private async ensureRecoveryEmailAvailable(email: string, currentUserId?: string) {
    const existing = await this.prisma.user.findFirst({
      where: {
        recoveryEmail: email,
      },
      select: {
        id: true,
      },
    });

    if (existing && existing.id !== currentUserId) {
      throw new BadRequestException("Email khôi phục này đã được dùng cho tài khoản khác.");
    }
  }

  private buildPasswordResetLink(token: string) {
    const baseUrl = this.config.webPublicUrl.replace(/\/+$/, "");
    return `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
  }

  private async deliverPasswordResetEmail(input: {
    to: string;
    displayName: string;
    resetLink: string;
  }) {
    const subject = "Đặt lại mật khẩu Reseller Platform";
    const text = [
      `Xin chào ${input.displayName},`,
      "",
      "Bạn vừa yêu cầu đặt lại mật khẩu cho tài khoản Reseller Platform.",
      `Mở link này để tạo mật khẩu mới: ${input.resetLink}`,
      "",
      `Link có hiệu lực trong ${this.config.passwordResetTtlMinutes} phút. Nếu không phải bạn yêu cầu, hãy bỏ qua email này.`,
    ].join("\n");
    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a">
        <h2>Đặt lại mật khẩu</h2>
        <p>Xin chào <strong>${this.escapeHtml(input.displayName)}</strong>,</p>
        <p>Bạn vừa yêu cầu đặt lại mật khẩu cho tài khoản Reseller Platform.</p>
        <p>
          <a href="${input.resetLink}" style="display:inline-block;border-radius:10px;background:#10b981;color:#07131e;padding:12px 18px;text-decoration:none;font-weight:700">
            Tạo mật khẩu mới
          </a>
        </p>
        <p>Link có hiệu lực trong ${this.config.passwordResetTtlMinutes} phút. Nếu không phải bạn yêu cầu, hãy bỏ qua email này.</p>
      </div>
    `;

    await this.mail.send({ to: input.to, subject, text, html });
  }

  private escapeHtml(value: string) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  private async getManagedSellerUserOrThrow(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        seller: {
          include: {
            wallet: true,
            shops: {
              include: {
                providerConfig: {
                  select: {
                    connectionStatus: true,
                  },
                },
              },
              orderBy: {
                createdAt: "asc",
              },
            },
            _count: {
              select: {
                customers: true,
                orders: true,
                ledgers: true,
                deposits: true,
                withdraws: true,
                broadcasts: true,
              },
            },
          },
        },
      },
    });

    if (!user || user.role !== UserRole.SELLER || !user.seller) {
      throw new NotFoundException("CTV account not found.");
    }

    return user;
  }

  async register(
    username: string,
    email: string,
    password: string,
    displayName: string,
    referralCode?: string | null,
    signupMeta?: { signupIp?: string | null; signupDeviceFingerprint?: string | null },
  ) {
    // Nếu email được cung cấp, lưu thành recoveryEmail để dùng reset mật khẩu
    const created = await this.createSellerAccount({
      username,
      password,
      displayName,
      recoveryEmail: email || null,
      sellerTier: SellerTier.FREE,
      referralCode: referralCode ?? null,
      signupIp: signupMeta?.signupIp ?? null,
      signupDeviceFingerprint: signupMeta?.signupDeviceFingerprint ?? null,
    });

    return this.issueAuthResponse({
      id: created.user.id,
      email: created.user.email,
      role: created.user.role,
    });
  }

  async setReferralCode(userId: string, referralCode: string) {
    const seller = await this.prisma.seller.findFirst({
      where: { userId },
      select: { id: true, referredBySellerId: true, referralCode: true },
    });
    if (!seller) {
      throw new NotFoundException("Seller not found.");
    }
    if (seller.referredBySellerId) {
      throw new BadRequestException("Mã giới thiệu đã được thiết lập trước đó, không thể đổi.");
    }
    const normalized = referralCode.trim().toUpperCase();
    if (normalized.length < 4) {
      throw new BadRequestException("Mã giới thiệu không hợp lệ.");
    }
    if (seller.referralCode === normalized) {
      throw new BadRequestException("Không thể tự giới thiệu chính mình.");
    }
    const referrer = await this.prisma.seller.findUnique({
      where: { referralCode: normalized },
      select: { id: true },
    });
    if (!referrer) {
      throw new BadRequestException("Mã giới thiệu không tồn tại.");
    }
    if (referrer.id === seller.id) {
      throw new BadRequestException("Không thể tự giới thiệu chính mình.");
    }
    await this.prisma.seller.update({
      where: { id: seller.id },
      data: { referredBySellerId: referrer.id },
    });
    return { ok: true };
  }
}
