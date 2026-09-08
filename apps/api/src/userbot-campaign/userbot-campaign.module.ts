import { Module } from "@nestjs/common";
import { UserbotCampaignController } from "./userbot-campaign.controller";
import { UserbotCampaignService } from "./userbot-campaign.service";
import { QueueService } from "../lib/queue.service";
import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../db/prisma.service";

@Module({
  controllers: [UserbotCampaignController],
  providers: [UserbotCampaignService, QueueService, AppConfigService, PrismaService],
  exports: [UserbotCampaignService],
})
export class UserbotCampaignModule {}

