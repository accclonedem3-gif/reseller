import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../db/prisma.service";
import { QueueService } from "../lib/queue.service";
import { decryptSecret, encryptSecret, getUserbotCampaignJobId } from "@reseller/shared/server";
import type { AuthenticatedUser } from "../types";
import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { CreateTemplateDto, CreateUserbotCampaignDto, SendOtpDto, UpdateProxyDto, UpdateUserbotCampaignDto, VerifyOtpDto } from "./userbot-campaign.dto";
import {
  parseUserbotCampaignScheduleTime,
  planUserbotCampaignStart,
} from "./userbot-campaign-schedule";

export function parseGramJsProxy(proxyUrl?: string | null) {
  if (!proxyUrl) return undefined;
  try {
    const url = new URL(proxyUrl);
    const isSocks4 = url.protocol.startsWith("socks4");
    const isSocks = url.protocol.startsWith("socks");
    const port = url.port ? parseInt(url.port) : isSocks ? 1080 : 80;
    const username = url.username ? decodeURIComponent(url.username) : undefined;
    const password = url.password ? decodeURIComponent(url.password) : undefined;

    return {
      ip: url.hostname,
      port,
      socksType: (isSocks4 ? 4 : 5) as 4 | 5,
      username,
      password,
    };
  } catch {
    return undefined;
  }
}

export function maskProxyUrl(proxyUrl?: string | null) {
  if (!proxyUrl) return null;
  try {
    const url = new URL(proxyUrl);
    if (url.username || url.password) {
      url.username = "***";
      url.password = "***";
    }
    return url.toString();
  } catch {
    return "http://***:***@proxy";
  }
}

function formatGramJsError(error: any): string {
  const msg = error?.errorMessage || error?.message || String(error);
  if (msg.includes("PHONE_CODE_EXPIRED")) {
    return "Mã OTP đã hết hạn. Vui lòng quay lại nhập lại SĐT để gửi lại mã OTP mới.";
  }
  if (msg.includes("PHONE_CODE_INVALID")) {
    return "Mã OTP không chính xác. Vui lòng kiểm tra lại tin nhắn Telegram.";
  }
  if (msg.includes("PHONE_NUMBER_INVALID")) {
    return "Số điện thoại không hợp lệ. Vui lòng định dạng đầy đủ có + (VD: +84338423660).";
  }
  if (msg.includes("API_ID_INVALID") || msg.includes("API_HASH_INVALID")) {
    return "api_id hoặc api_hash không chính xác. Hãy để trống nếu muốn dùng mặc định.";
  }
  if (msg.includes("FLOOD_WAIT")) {
    return "Tài khoản Telegram đang bị giới hạn tạm thời (Flood Wait). Vui lòng chờ ít phút rồi thử lại.";
  }
  if (msg.includes("PASSWORD_HASH_INVALID")) {
    return "Mật khẩu 2FA không chính xác. Vui lòng thử lại.";
  }
  return msg;
}

@Injectable()
export class UserbotCampaignService {
  private readonly logger = new Logger(UserbotCampaignService.name);
  private readonly apiId: number;
  private readonly apiHash: string;
  private readonly encryptionKey: string;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
    @Inject(QueueService) private readonly queueService: QueueService,
  ) {
    this.apiId = Number(process.env.TELEGRAM_API_ID || "2040");
    this.apiHash = process.env.TELEGRAM_API_HASH || "b18441a1ed609e1201303ec84116b674";
    this.encryptionKey = process.env.APP_ENCRYPTION_KEY || "default-secret-key-32-chars-long!!";
  }

  // --- 0. LICENSE MANAGEMENT & QUOTAS ---

  async getLicenseStatus(user: AuthenticatedUser) {
    if (!user.sellerId) throw new BadRequestException("Seller required.");
    const seller = await this.prisma.seller.findUnique({
      where: { id: user.sellerId },
      select: { userbotLicenseType: true, userbotLicenseExpiresAt: true },
    });
    if (!seller) throw new NotFoundException("Seller not found.");

    // Check if system requires license key (default is false -> free mode)
    const configRequireLicense = await this.prisma.systemConfig.findUnique({
      where: { key: "userbot_campaign_require_license" },
    });
    const isLicenseRequired = configRequireLicense?.value === "true";

    const now = new Date();
    const hasRedeemedActiveKey = Boolean(
      seller.userbotLicenseExpiresAt && new Date(seller.userbotLicenseExpiresAt) > now,
    );

    // Free Mode active when no key is redeemed and system license key requirement is not enforced
    if (!isLicenseRequired && !hasRedeemedActiveKey) {
      return {
        licenseType: "FREE_TIER",
        expiresAt: null,
        isActive: true,
        isFreeMode: true,
        maxSessions: 1,
        maxCampaigns: 1,
        minDelaySeconds: 30,
      };
    }

    let maxSessions = 0;
    let maxCampaigns = 0;
    let minDelaySeconds = 60;

    if (hasRedeemedActiveKey && seller.userbotLicenseType) {
      if (seller.userbotLicenseType === "PLUS") {
        maxSessions = 1;
        maxCampaigns = 1;
        minDelaySeconds = 30;
      } else if (seller.userbotLicenseType === "PRO") {
        maxSessions = 3;
        maxCampaigns = 5;
        minDelaySeconds = 20;
      } else if (seller.userbotLicenseType === "UNLIMITED") {
        maxSessions = 9999;
        maxCampaigns = 9999;
        minDelaySeconds = 15;
      }
    }

    return {
      licenseType: seller.userbotLicenseType || null,
      expiresAt: seller.userbotLicenseExpiresAt || null,
      isActive: hasRedeemedActiveKey || !isLicenseRequired,
      isFreeMode: !isLicenseRequired && !hasRedeemedActiveKey,
      maxSessions: hasRedeemedActiveKey ? maxSessions : 9999,
      maxCampaigns: hasRedeemedActiveKey ? maxCampaigns : 9999,
      minDelaySeconds: hasRedeemedActiveKey ? minDelaySeconds : 15,
    };
  }

  async activateLicenseKey(user: AuthenticatedUser, code: string) {
    if (!user.sellerId) throw new BadRequestException("Seller required.");
    const trimmedCode = String(code || "").trim();

    const key = await this.prisma.telegramUserbotLicenseKey.findUnique({
      where: { code: trimmedCode },
    });

    if (!key) throw new NotFoundException("Mã License Key không tồn tại.");
    if (key.isRedeemed) throw new BadRequestException("Mã License Key này đã được sử dụng.");

    const seller = await this.prisma.seller.findUnique({
      where: { id: user.sellerId },
      select: { userbotLicenseType: true, userbotLicenseExpiresAt: true },
    });

    const now = new Date();
    let newExpiresAt: Date;

    if (seller?.userbotLicenseType === key.type && seller.userbotLicenseExpiresAt && new Date(seller.userbotLicenseExpiresAt) > now) {
      newExpiresAt = new Date(new Date(seller.userbotLicenseExpiresAt).getTime() + key.durationDays * 86400 * 1000);
    } else {
      newExpiresAt = new Date(now.getTime() + key.durationDays * 86400 * 1000);
    }

    await this.prisma.$transaction([
      this.prisma.seller.update({
        where: { id: user.sellerId },
        data: {
          userbotLicenseType: key.type,
          userbotLicenseExpiresAt: newExpiresAt,
        },
      }),
      this.prisma.telegramUserbotLicenseKey.update({
        where: { id: key.id },
        data: {
          isRedeemed: true,
          redeemedBySellerId: user.sellerId,
          redeemedAt: now,
          expiresAt: newExpiresAt,
        },
      }),
    ]);

    return {
      success: true,
      message: `Kích hoạt thành công License Gói ${key.type} (${key.durationDays} ngày)!`,
      licenseType: key.type,
      expiresAt: newExpiresAt,
    };
  }

  // --- 1. USERBOT AUTH & SESSIONS ---

  async sendOtp(user: AuthenticatedUser, dto: SendOtpDto) {
    if (!user.sellerId) {
      throw new BadRequestException("Only sellers can use Tele Campaign.");
    }

    const license = await this.getLicenseStatus(user);
    if (!license.isActive) {
      throw new BadRequestException("Bạn cần kích hoạt License Key để sử dụng tính năng Tele Campaign.");
    }

    const currentSessionsCount = await this.prisma.telegramUserSession.count({
      where: { sellerId: user.sellerId },
    });
    const existingSession = await this.prisma.telegramUserSession.findFirst({
      where: { sellerId: user.sellerId, phoneNumber: dto.phoneNumber },
    });

    if (!existingSession && currentSessionsCount >= license.maxSessions) {
      throw new BadRequestException(`Gói License ${license.licenseType} giới hạn tối đa ${license.maxSessions} tài khoản Telegram.`);
    }

    const effectiveApiId = dto.apiId ? Number(dto.apiId) : this.apiId;
    const effectiveApiHash = dto.apiHash?.trim() || this.apiHash;

    const client = new TelegramClient(new StringSession(""), effectiveApiId, effectiveApiHash, {
      connectionRetries: 5,
      proxy: parseGramJsProxy(dto.proxyUrl),
    });

    try {
      await client.connect();
      const sendResult = await client.sendCode(
        { apiId: effectiveApiId, apiHash: effectiveApiHash },
        dto.phoneNumber,
      );
      const tempSessionString = (client.session as StringSession).save();
      await client.disconnect();

      return {
        success: true,
        phoneNumber: dto.phoneNumber,
        phoneCodeHash: sendResult.phoneCodeHash,
        tempSessionString,
        message: "Mã OTP đã được gửi về ứng dụng Telegram của bạn.",
      };
    } catch (error) {
      await client.disconnect().catch(() => undefined);
      this.logger.error(`Send OTP failed for ${dto.phoneNumber}:`, error);
      throw new BadRequestException(formatGramJsError(error));
    }
  }

  async verifyOtp(user: AuthenticatedUser, dto: VerifyOtpDto) {
    if (!user.sellerId) {
      throw new BadRequestException("Only sellers can use Tele Campaign.");
    }

    const license = await this.getLicenseStatus(user);
    if (!license.isActive) {
      throw new BadRequestException("Bạn cần kích hoạt License Key để sử dụng tính năng Tele Campaign.");
    }

    const effectiveApiId = dto.apiId ? Number(dto.apiId) : this.apiId;
    const effectiveApiHash = dto.apiHash?.trim() || this.apiHash;

    const sessionToUse = dto.tempSessionString
      ? new StringSession(dto.tempSessionString)
      : new StringSession("");

    const client = new TelegramClient(sessionToUse, effectiveApiId, effectiveApiHash, {
      connectionRetries: 5,
      proxy: parseGramJsProxy(dto.proxyUrl),
    });

    try {
      await client.connect();

      let userResult: any;
      try {
        userResult = await client.invoke(
          new Api.auth.SignIn({
            phoneNumber: dto.phoneNumber,
            phoneCodeHash: dto.phoneCodeHash,
            phoneCode: dto.phoneCode,
          }),
        );
      } catch (signInErr: any) {
        if (signInErr?.errorMessage === "SESSION_PASSWORD_NEEDED") {
          if (!dto.password) {
            await client.disconnect();
            return {
              requires2FA: true,
              message: "Tài khoản có bảo mật 2 lớp. Vui lòng nhập mật khẩu 2FA.",
            };
          }
          const passwordCheck = await client.signInWithPassword(
            { apiId: effectiveApiId, apiHash: effectiveApiHash },
            {
              password: async () => dto.password!,
              onError: (err) => {
                throw err;
              },
            },
          );
          userResult = passwordCheck;
        } else {
          throw signInErr;
        }
      }

      const sessionString = (client.session as StringSession).save();
      const tgUser = (userResult as any)?.user || (await client.getMe());
      const telegramUserId = tgUser?.id ? String(tgUser.id) : null;
      const telegramUsername = tgUser?.username || null;

      await client.disconnect();

      const sessionEncrypted = encryptSecret(sessionString, this.encryptionKey);

      const savedSession = await this.prisma.telegramUserSession.upsert({
        where: {
          id: `${user.sellerId}_${dto.phoneNumber}`,
        },
        create: {
          id: `${user.sellerId}_${dto.phoneNumber}`,
          sellerId: user.sellerId,
          phoneNumber: dto.phoneNumber,
          apiId: effectiveApiId,
          apiHash: effectiveApiHash,
          sessionStringEncrypted: sessionEncrypted,
          telegramUserId,
          telegramUsername,
          proxyUrl: dto.proxyUrl || null,
          status: "ACTIVE",
        },
        update: {
          apiId: effectiveApiId,
          apiHash: effectiveApiHash,
          sessionStringEncrypted: sessionEncrypted,
          telegramUserId,
          telegramUsername,
          proxyUrl: dto.proxyUrl || null,
          status: "ACTIVE",
        },
      });

      return {
        success: true,
        session: {
          id: savedSession.id,
          phoneNumber: savedSession.phoneNumber,
          telegramUserId: savedSession.telegramUserId,
          telegramUsername: savedSession.telegramUsername,
          status: savedSession.status,
        },
      };
    } catch (error) {
      await client.disconnect().catch(() => undefined);
      this.logger.error(`Verify OTP failed for ${dto.phoneNumber}:`, error);
      throw new BadRequestException(formatGramJsError(error));
    }
  }

  async listSessions(user: AuthenticatedUser) {
    if (!user.sellerId) return [];

    const sessions = await this.prisma.telegramUserSession.findMany({
      where: { sellerId: user.sellerId },
      include: {
        _count: {
          select: { groups: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return sessions.map((s) => ({
      id: s.id,
      phoneNumber: s.phoneNumber,
      telegramUserId: s.telegramUserId,
      telegramUsername: s.telegramUsername,
      proxyUrl: maskProxyUrl(s.proxyUrl),
      status: s.status,
      groupsCount: s._count.groups,
      lastSyncAt: s.lastSyncAt,
      createdAt: s.createdAt,
    }));
  }

  async updateProxy(user: AuthenticatedUser, sessionId: string, dto: UpdateProxyDto) {
    const session = await this.prisma.telegramUserSession.findFirst({
      where: { id: sessionId, sellerId: user.sellerId! },
    });

    if (!session) throw new NotFoundException("Telegram session not found.");

    return this.prisma.telegramUserSession.update({
      where: { id: sessionId },
      data: { proxyUrl: dto.proxyUrl || null },
    });
  }

  async deleteSession(user: AuthenticatedUser, sessionId: string) {
    const session = await this.prisma.telegramUserSession.findFirst({
      where: { id: sessionId, sellerId: user.sellerId! },
    });

    if (!session) throw new NotFoundException("Telegram session not found.");

    const runningCampaign = await this.prisma.telegramUserCampaign.findFirst({
      where: { sessionId, status: "RUNNING" },
    });

    if (runningCampaign) {
      throw new BadRequestException("Không thể xóa tài khoản Telegram đang có chiến dịch chạy.");
    }

    await this.prisma.telegramUserSession.delete({
      where: { id: sessionId },
    });

    return { success: true };
  }

  // --- 2. GROUP SYNCING & SAVED MESSAGES ---

  async syncGroups(user: AuthenticatedUser, sessionId: string) {
    const sessionRecord = await this.prisma.telegramUserSession.findFirst({
      where: { id: sessionId, sellerId: user.sellerId! },
    });

    if (!sessionRecord) throw new NotFoundException("Telegram session not found.");

    const rawSession = decryptSecret(sessionRecord.sessionStringEncrypted, this.encryptionKey);
    const effectiveApiId = sessionRecord.apiId || this.apiId;
    const effectiveApiHash = sessionRecord.apiHash || this.apiHash;
    const client = new TelegramClient(new StringSession(rawSession), effectiveApiId, effectiveApiHash, {
      connectionRetries: 3,
      proxy: parseGramJsProxy(sessionRecord.proxyUrl),
    });

    try {
      await client.connect();
      const dialogs = await client.getDialogs({ limit: 100 });

      const groupRecords: Array<{
        sessionId: string;
        telegramChatId: bigint;
        title: string;
        username?: string | null;
        memberCount?: number | null;
        canSendMessages: boolean;
        isSupergroup: boolean;
      }> = [];

      for (const dialog of dialogs) {
        if (dialog.isGroup || dialog.isChannel) {
          const entity = dialog.entity as any;
          if (entity) {
            const isBroadcastChannel = entity.broadcast === true;
            if (isBroadcastChannel && !entity.creator && !entity.adminRights?.postMessages) {
              continue;
            }

            if (!dialog.id) continue;
            const chatId = BigInt(dialog.id.toString());
            const title = dialog.title || "Group Telegram";
            const username = entity.username || null;
            const memberCount = entity.participantsCount || null;

            groupRecords.push({
              sessionId: sessionRecord.id,
              telegramChatId: chatId,
              title,
              username,
              memberCount,
              canSendMessages: true,
              isSupergroup: Boolean(dialog.isChannel || entity.megagroup),
            });
          }
        }
      }

      await client.disconnect();

      for (const rec of groupRecords) {
        await this.prisma.telegramUserGroup.upsert({
          where: {
            sessionId_telegramChatId: {
              sessionId: rec.sessionId,
              telegramChatId: rec.telegramChatId,
            },
          },
          create: rec,
          update: {
            title: rec.title,
            username: rec.username,
            memberCount: rec.memberCount,
            syncedAt: new Date(),
          },
        });
      }

      await this.prisma.telegramUserSession.update({
        where: { id: sessionRecord.id },
        data: { lastSyncAt: new Date(), status: "ACTIVE" },
      });

      return {
        success: true,
        count: groupRecords.length,
      };
    } catch (error) {
      await client.disconnect().catch(() => undefined);
      this.logger.error(`Sync groups failed for session ${sessionId}:`, error);
      throw new BadRequestException(
        error instanceof Error ? error.message : "Đồng bộ nhóm Telegram thất bại.",
      );
    }
  }

  async listGroups(user: AuthenticatedUser, sessionId?: string) {
    if (!user.sellerId) return [];

    const groups = await this.prisma.telegramUserGroup.findMany({
      where: {
        session: {
          sellerId: user.sellerId,
          ...(sessionId ? { id: sessionId } : {}),
        },
      },
      orderBy: { syncedAt: "desc" },
    });

    return groups.map((g) => ({
      id: g.id,
      sessionId: g.sessionId,
      telegramChatId: g.telegramChatId.toString(),
      title: g.title,
      username: g.username,
      memberCount: g.memberCount,
      canSendMessages: g.canSendMessages,
      isSupergroup: g.isSupergroup,
      syncedAt: g.syncedAt,
    }));
  }

  async getSavedMessages(user: AuthenticatedUser, sessionId: string) {
    const sessionRecord = await this.prisma.telegramUserSession.findFirst({
      where: { id: sessionId, sellerId: user.sellerId! },
    });

    if (!sessionRecord) throw new NotFoundException("Telegram session not found.");

    const rawSession = decryptSecret(sessionRecord.sessionStringEncrypted, this.encryptionKey);
    const effectiveApiId = sessionRecord.apiId || this.apiId;
    const effectiveApiHash = sessionRecord.apiHash || this.apiHash;
    const client = new TelegramClient(new StringSession(rawSession), effectiveApiId, effectiveApiHash, {
      connectionRetries: 3,
      proxy: parseGramJsProxy(sessionRecord.proxyUrl),
    });

    try {
      await client.connect();
      const messages = await client.getMessages("me", { limit: 20 });
      await client.disconnect();

      return messages
        .filter((m: any) => m && !m.action && (m.text || m.message || m.media))
        .map((m: any) => ({
          id: m.id.toString(),
          text: (m.text || m.message || (m.media ? "[Hình ảnh / File đính kèm]" : "")).trim(),
          date: m.date ? new Date(m.date * 1000).toISOString() : null,
        }))
        .filter((m: any) => m.text.length > 0);
    } catch (error) {
      await client.disconnect().catch(() => undefined);
      this.logger.error(`Get saved messages failed for session ${sessionId}:`, error);
      throw new BadRequestException(
        error instanceof Error ? error.message : "Lấy danh sách Tin nhắn đã lưu thất bại.",
      );
    }
  }

  // --- 3. TEMPLATES ---

  async listTemplates(user: AuthenticatedUser) {
    if (!user.sellerId) return [];

    const templates = await this.prisma.telegramUserTemplate.findMany({
      where: { sellerId: user.sellerId },
      orderBy: { createdAt: "desc" },
    });

    return templates.map((t) => ({
      ...t,
      savedMessageId: t.savedMessageId ? t.savedMessageId.toString() : null,
    }));
  }

  async createTemplate(user: AuthenticatedUser, dto: CreateTemplateDto) {
    if (!user.sellerId) throw new BadRequestException("Only sellers can manage templates.");

    const template = await this.prisma.telegramUserTemplate.create({
      data: {
        sellerId: user.sellerId,
        name: dto.name,
        type: dto.type,
        content: dto.content || null,
        mediaUrl: dto.mediaUrl || null,
        savedMessageId: dto.savedMessageId ? BigInt(dto.savedMessageId) : null,
        savedMessageText: dto.savedMessageText || null,
      },
    });

    return {
      ...template,
      savedMessageId: template.savedMessageId ? template.savedMessageId.toString() : null,
    };
  }

  async deleteTemplate(user: AuthenticatedUser, templateId: string) {
    const template = await this.prisma.telegramUserTemplate.findFirst({
      where: { id: templateId, sellerId: user.sellerId! },
    });

    if (!template) throw new NotFoundException("Template not found.");

    await this.prisma.telegramUserTemplate.delete({
      where: { id: templateId },
    });

    return { success: true };
  }

  async deleteAllTemplates(user: AuthenticatedUser) {
    if (!user.sellerId) throw new BadRequestException("Only sellers can manage templates.");

    const result = await this.prisma.telegramUserTemplate.deleteMany({
      where: { sellerId: user.sellerId },
    });

    return { success: true, deletedCount: result.count };
  }

  // --- 4. CAMPAIGNS ---

  async listCampaigns(user: AuthenticatedUser) {
    if (!user.sellerId) return [];

    const campaigns = await this.prisma.telegramUserCampaign.findMany({
      where: { sellerId: user.sellerId },
      include: {
        session: {
          select: { phoneNumber: true, telegramUsername: true },
        },
        template: {
          select: { name: true, type: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return campaigns.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      sessionId: c.sessionId,
      sessionPhoneNumber: c.session.phoneNumber,
      templateId: c.templateId,
      templateName: c.template.name,
      templateType: c.template.type,
      targetGroupIds: c.targetGroupIds,
      delaySeconds: c.delaySeconds,
      totalTarget: c.totalTarget,
      sentCount: c.sentCount,
      failedCount: c.failedCount,
      scheduleTime: c.scheduleTime,
      isRecurring: c.isRecurring,
      repeatIntervalHours: c.repeatIntervalHours,
      lastRunAt: c.lastRunAt,
      nextRunAt: c.nextRunAt,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));
  }

  async createCampaign(user: AuthenticatedUser, dto: CreateUserbotCampaignDto) {
    if (!user.sellerId) throw new BadRequestException("Only sellers can create campaigns.");

    const license = await this.getLicenseStatus(user);
    if (!license.isActive) {
      throw new BadRequestException("Bạn cần kích hoạt License Key để sử dụng tính năng Tele Campaign.");
    }

    const currentCampaignsCount = await this.prisma.telegramUserCampaign.count({
      where: { sellerId: user.sellerId },
    });
    if (currentCampaignsCount >= license.maxCampaigns) {
      throw new BadRequestException(`Gói License ${license.licenseType} giới hạn tối đa ${license.maxCampaigns} chiến dịch.`);
    }

    if (dto.delaySeconds < license.minDelaySeconds) {
      throw new BadRequestException(`Độ trễ tối thiểu cho Gói ${license.licenseType} là ${license.minDelaySeconds} giây.`);
    }

    const session = await this.prisma.telegramUserSession.findFirst({
      where: { id: dto.sessionId, sellerId: user.sellerId },
    });
    if (!session) throw new NotFoundException("Telegram session not found.");

    const template = await this.prisma.telegramUserTemplate.findFirst({
      where: { id: dto.templateId, sellerId: user.sellerId },
    });
    if (!template) throw new NotFoundException("Template not found.");

    if (!dto.targetGroupIds || dto.targetGroupIds.length === 0) {
      throw new BadRequestException("Vui lòng chọn ít nhất một nhóm mục tiêu.");
    }

    if (dto.targetGroupIds.length > 100) {
      throw new BadRequestException("Tối đa chọn 100 nhóm mục tiêu mỗi chiến dịch.");
    }

    const targetGroupBigInts = dto.targetGroupIds.map((id) => BigInt(id));
    const validGroups = await this.prisma.telegramUserGroup.findMany({
      where: {
        sessionId: dto.sessionId,
        telegramChatId: { in: targetGroupBigInts },
      },
    });

    if (validGroups.length !== dto.targetGroupIds.length) {
      throw new BadRequestException("Một hoặc nhiều nhóm mục tiêu không hợp lệ hoặc không thuộc về tài khoản Telegram này.");
    }

    let scheduleTime: Date | null;
    try {
      scheduleTime = parseUserbotCampaignScheduleTime(dto.scheduleTime);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : "Scheduled time is invalid.",
      );
    }

    if (scheduleTime && scheduleTime.getTime() <= Date.now()) {
      throw new BadRequestException("Scheduled time must be in the future.");
    }

    const campaign = await this.prisma.telegramUserCampaign.create({
      data: {
        sellerId: user.sellerId,
        sessionId: dto.sessionId,
        templateId: dto.templateId,
        name: dto.name,
        targetGroupIds: dto.targetGroupIds,
        delaySeconds: dto.delaySeconds,
        scheduleTime,
        isRecurring: dto.isRecurring ?? false,
        repeatIntervalHours: dto.repeatIntervalHours || 24,
        status: scheduleTime ? "RUNNING" : "DRAFT",
        nextRunAt: scheduleTime,
        totalTarget: dto.targetGroupIds.length,
      },
    });

    if (scheduleTime) {
      const now = new Date();
      await this.queueService.addUserbotCampaignJob(
        campaign.id,
        Math.max(0, scheduleTime.getTime() - now.getTime()),
        getUserbotCampaignJobId(campaign.id, scheduleTime.getTime()),
        scheduleTime.toISOString(),
      ).catch(() => {
        this.logger.warn(`Campaign ${campaign.id} is saved; worker will retry scheduling.`);
      });
    }

    return campaign;
  }

  async startCampaign(user: AuthenticatedUser, campaignId: string) {
    if (!user.sellerId) throw new BadRequestException("Seller required.");

    const license = await this.getLicenseStatus(user);
    if (!license.isActive) {
      throw new BadRequestException("Bạn cần kích hoạt License Key để vận hành chiến dịch.");
    }

    const campaign = await this.prisma.telegramUserCampaign.findFirst({
      where: { id: campaignId, sellerId: user.sellerId },
    });

    if (!campaign) throw new NotFoundException("Campaign not found.");

    const startPlan = planUserbotCampaignStart(
      campaign.scheduleTime,
    );

    const updatedResult = await this.prisma.telegramUserCampaign.updateMany({
      where: {
        id: campaignId,
        sellerId: user.sellerId,
        status: { in: ["DRAFT", "PAUSED", "FAILED"] },
      },
      data: {
        status: "RUNNING",
        sentCount: 0,
        failedCount: 0,
        lastRunAt: null,
        nextRunAt: startPlan.nextRunAt,
      },
    });

    if (updatedResult.count === 0) {
      throw new BadRequestException("Chiến dịch đang chạy hoặc không ở trạng thái hợp lệ để bắt đầu.");
    }

    const updated = await this.prisma.telegramUserCampaign.findUnique({ where: { id: campaignId } });
    await this.queueService.addUserbotCampaignJob(
      campaign.id,
      startPlan.delayMs,
      getUserbotCampaignJobId(campaign.id, startPlan.jobRunAt.getTime()),
      startPlan.jobRunAt.toISOString(),
    ).catch(() => {
      this.logger.warn(`Campaign ${campaign.id} is saved; worker will retry scheduling.`);
    });

    return updated;
  }

  async pauseCampaign(user: AuthenticatedUser, campaignId: string) {
    const campaign = await this.prisma.telegramUserCampaign.findFirst({
      where: { id: campaignId, sellerId: user.sellerId! },
    });

    if (!campaign) throw new NotFoundException("Campaign not found.");

    return this.prisma.telegramUserCampaign.update({
      where: { id: campaignId },
      data: { status: "PAUSED", nextRunAt: null },
    });
  }

  async deleteCampaign(user: AuthenticatedUser, campaignId: string) {
    const campaign = await this.prisma.telegramUserCampaign.findFirst({
      where: { id: campaignId, sellerId: user.sellerId! },
    });

    if (!campaign) throw new NotFoundException("Campaign not found.");

    if (campaign.status === "RUNNING") {
      throw new BadRequestException("Không thể xóa chiến dịch đang ở trạng thái RUNNING. Vui lòng tạm dừng chiến dịch trước.");
    }

    await this.prisma.telegramUserCampaign.delete({
      where: { id: campaignId },
    });

    return { success: true };
  }

  async getCampaignLogs(user: AuthenticatedUser, campaignId: string) {
    const campaign = await this.prisma.telegramUserCampaign.findFirst({
      where: { id: campaignId, sellerId: user.sellerId! },
    });

    if (!campaign) throw new NotFoundException("Campaign not found.");

    const logs = await this.prisma.telegramUserCampaignLog.findMany({
      where: { campaignId },
      orderBy: { sentAt: "desc" },
      take: 100,
    });

    return logs.map((l) => ({
      id: l.id,
      campaignId: l.campaignId,
      groupTitle: l.groupTitle,
      groupChatId: l.groupChatId.toString(),
      status: l.status,
      errorDetail: l.errorDetail,
      sentAt: l.sentAt,
    }));
  }
}
