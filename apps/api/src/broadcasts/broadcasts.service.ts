import { Inject, Injectable } from "@nestjs/common";

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
  ) {}

  async listBroadcasts(user: AuthenticatedUser) {
    const shop = await this.shopsService.getSellerShop(user.id);
    return this.prisma.broadcast.findMany({
      where: {
        shopId: shop.id,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 50,
    });
  }

  async createBroadcast(user: AuthenticatedUser, dto: CreateBroadcastDto) {
    const shop = await this.shopsService.getSellerShop(user.id);
    const totalTargets = await this.prisma.customer.count({
      where: {
        shopId: shop.id,
      },
    });

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
}
