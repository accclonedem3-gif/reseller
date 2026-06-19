import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";
import { randomUUID } from "node:crypto";

import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { computeNextVnRunAt, parseVnWallClock } from "@reseller/shared/server";

import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../db/prisma.service";
import { QueueService } from "../lib/queue.service";
import { ShopsService } from "../shops/shops.service";
import type { AuthenticatedUser } from "../types";

import type { CreateBroadcastDto } from "./broadcasts.dto";

@Injectable()
export class BroadcastsService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(ShopsService)
    private readonly shopsService: ShopsService,
    @Inject(QueueService)
    private readonly queueService: QueueService,
    @Inject(AppConfigService)
    private readonly config: AppConfigService,
  ) {}

  async listBroadcasts(user: AuthenticatedUser) {
    const shop = await this.shopsService.getSellerShop(user.id);
    return this.prisma.broadcast.findMany({
      where: { shopId: shop.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  async createBroadcast(user: AuthenticatedUser, dto: CreateBroadcastDto) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const mode = dto.mode ?? "immediate";

    if (mode === "recurring") {
      if (!dto.sendTime) throw new BadRequestException("sendTime is required for recurring mode.");
      const freq = dto.frequency ?? "daily";
      const repeatDay = freq === "weekly" ? (dto.repeatDay ?? 1) : null;
      const nextRunAt = computeNextVnRunAt(dto.sendTime, freq, repeatDay);
      const schedule = await this.prisma.broadcastSchedule.create({
        data: {
          shopId: shop.id,
          sellerId: shop.sellerId,
          title: dto.title ?? null,
          message: dto.message,
          imageUrl: dto.imageUrl ?? null,
          sendTime: dto.sendTime,
          frequency: freq,
          repeatDay,
          isActive: true,
          nextRunAt,
        },
      });
      return { mode: "recurring", schedule };
    }

    const totalTargets = await this.prisma.customer.count({ where: { shopId: shop.id } });

    if (mode === "scheduled") {
      if (!dto.scheduledAt) throw new BadRequestException("scheduledAt is required for scheduled mode.");
      // datetime-local has no timezone → interpret as Vietnam wall-clock (server runs UTC).
      const scheduledAt = parseVnWallClock(dto.scheduledAt);
      if (!scheduledAt) throw new BadRequestException("Invalid scheduledAt.");
      const broadcast = await this.prisma.broadcast.create({
        data: {
          shopId: shop.id,
          sellerId: shop.sellerId,
          title: dto.title ?? null,
          message: dto.message,
          imageUrl: dto.imageUrl ?? null,
          status: "SCHEDULED",
          totalTargets,
          scheduledAt,
        },
      });
      return broadcast;
    }

    // immediate
    const broadcast = await this.prisma.broadcast.create({
      data: {
        shopId: shop.id,
        sellerId: shop.sellerId,
        title: dto.title ?? null,
        message: dto.message,
        imageUrl: dto.imageUrl ?? null,
        status: "QUEUED",
        totalTargets,
      },
    });
    await this.queueService.addBroadcastJob(broadcast.id);
    return broadcast;
  }

  async listSchedules(user: AuthenticatedUser) {
    const shop = await this.shopsService.getSellerShop(user.id);
    return this.prisma.broadcastSchedule.findMany({
      where: { shopId: shop.id },
      orderBy: { createdAt: "desc" },
    });
  }

  async toggleSchedule(user: AuthenticatedUser, scheduleId: string) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const schedule = await this.prisma.broadcastSchedule.findFirst({
      where: { id: scheduleId, shopId: shop.id },
    });
    if (!schedule) throw new BadRequestException("Schedule not found.");
    const updated = await this.prisma.broadcastSchedule.update({
      where: { id: scheduleId },
      data: {
        isActive: !schedule.isActive,
        nextRunAt: !schedule.isActive ? computeNextVnRunAt(schedule.sendTime, schedule.frequency, schedule.repeatDay) : null,
      },
    });
    return updated;
  }

  async deleteSchedule(user: AuthenticatedUser, scheduleId: string) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const schedule = await this.prisma.broadcastSchedule.findFirst({
      where: { id: scheduleId, shopId: shop.id },
    });
    if (!schedule) throw new BadRequestException("Schedule not found.");
    await this.prisma.broadcastSchedule.delete({ where: { id: scheduleId } });
    return { ok: true };
  }

  async getFailedRecipients(user: AuthenticatedUser, broadcastId: string) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const logs = await this.prisma.broadcastLog.findMany({
      where: { broadcastId, broadcast: { shopId: shop.id }, status: "FAILED" },
      include: {
        customer: {
          select: { telegramUsername: true, telegramChatId: true, firstName: true, lastName: true },
        },
      },
    });
    return logs.map((l) => ({
      customerId: l.customerId,
      telegramUsername: l.customer.telegramUsername,
      telegramChatId: l.customer.telegramChatId,
      name: [l.customer.firstName, l.customer.lastName].filter(Boolean).join(" ") || null,
      errorMessage: l.errorMessage,
    }));
  }

  async retryBroadcast(user: AuthenticatedUser, broadcastId: string) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const broadcast = await this.prisma.broadcast.findFirst({
      where: { id: broadcastId, shopId: shop.id },
    });
    if (!broadcast) throw new BadRequestException("Broadcast not found.");
    if (broadcast.status === "SENDING") throw new BadRequestException("Broadcast is already sending.");

    await this.prisma.broadcastLog.deleteMany({ where: { broadcastId, status: "FAILED" } });
    await this.prisma.broadcast.update({
      where: { id: broadcastId },
      data: { status: "QUEUED", failedCount: 0 },
    });
    await this.queueService.addBroadcastJob(broadcastId);
    return { ok: true };
  }

  async uploadBroadcastImage(_user: AuthenticatedUser, file: Express.Multer.File): Promise<{ url: string }> {
    if (!file) throw new BadRequestException("No file uploaded.");
    const ext = extname(file.originalname).toLowerCase() || ".jpg";
    const filename = `${randomUUID()}${ext}`;
    const dir = join(process.cwd(), "uploads", "broadcasts");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, filename), file.buffer);
    return { url: `${this.config.appPublicUrl}/uploads/broadcasts/${filename}` };
  }
}
