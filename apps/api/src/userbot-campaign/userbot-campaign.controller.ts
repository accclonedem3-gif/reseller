import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Query, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequireSellerCapabilities } from "../common/decorators/seller-capabilities.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { SellerCapabilitiesGuard } from "../common/guards/seller-capabilities.guard";
import type { AuthenticatedUser } from "../types";
import { ActivateLicenseDto, CreateTemplateDto, CreateUserbotCampaignDto, SendOtpDto, UpdateProxyDto, VerifyOtpDto } from "./userbot-campaign.dto";
import { UserbotCampaignService } from "./userbot-campaign.service";

@Controller("userbot-campaign")
@UseGuards(JwtAuthGuard)
export class UserbotCampaignController {
  constructor(
    @Inject(UserbotCampaignService)
    private readonly userbotService: UserbotCampaignService,
  ) {}

  // --- 0. LICENSE ---

  @Get("license/status")
  getLicenseStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.userbotService.getLicenseStatus(user);
  }

  @Post("license/activate")
  @UseGuards(SellerCapabilitiesGuard)
  @RequireSellerCapabilities("userbot_campaign_manage")
  activateLicense(@CurrentUser() user: AuthenticatedUser, @Body() body: ActivateLicenseDto) {
    return this.userbotService.activateLicenseKey(user, body.code);
  }

  // --- 1. SESSIONS & AUTH ---

  @Post("auth/send-otp")
  @UseGuards(SellerCapabilitiesGuard)
  @RequireSellerCapabilities("userbot_campaign_manage")
  sendOtp(@CurrentUser() user: AuthenticatedUser, @Body() body: SendOtpDto) {
    return this.userbotService.sendOtp(user, body);
  }

  @Post("auth/verify-otp")
  @UseGuards(SellerCapabilitiesGuard)
  @RequireSellerCapabilities("userbot_campaign_manage")
  verifyOtp(@CurrentUser() user: AuthenticatedUser, @Body() body: VerifyOtpDto) {
    return this.userbotService.verifyOtp(user, body);
  }

  @Get("sessions")
  listSessions(@CurrentUser() user: AuthenticatedUser) {
    return this.userbotService.listSessions(user);
  }

  @Put("sessions/:id/proxy")
  @UseGuards(SellerCapabilitiesGuard)
  @RequireSellerCapabilities("userbot_campaign_manage")
  updateProxy(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: UpdateProxyDto,
  ) {
    return this.userbotService.updateProxy(user, id, body);
  }

  @Delete("sessions/:id")
  @UseGuards(SellerCapabilitiesGuard)
  @RequireSellerCapabilities("userbot_campaign_manage")
  deleteSession(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.userbotService.deleteSession(user, id);
  }

  // --- 2. GROUPS & SAVED MESSAGES ---

  @Post("sessions/:id/sync-groups")
  @UseGuards(SellerCapabilitiesGuard)
  @RequireSellerCapabilities("userbot_campaign_manage")
  syncGroups(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.userbotService.syncGroups(user, id);
  }

  @Get("groups")
  listGroups(
    @CurrentUser() user: AuthenticatedUser,
    @Query("sessionId") sessionId?: string,
  ) {
    return this.userbotService.listGroups(user, sessionId);
  }

  @Get("sessions/:id/saved-messages")
  getSavedMessages(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.userbotService.getSavedMessages(user, id);
  }

  // --- 3. TEMPLATES ---

  @Get("templates")
  listTemplates(@CurrentUser() user: AuthenticatedUser) {
    return this.userbotService.listTemplates(user);
  }

  @Post("templates")
  @UseGuards(SellerCapabilitiesGuard)
  @RequireSellerCapabilities("userbot_campaign_manage")
  createTemplate(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateTemplateDto) {
    return this.userbotService.createTemplate(user, body);
  }

  @Delete("templates")
  @UseGuards(SellerCapabilitiesGuard)
  @RequireSellerCapabilities("userbot_campaign_manage")
  deleteAllTemplates(@CurrentUser() user: AuthenticatedUser) {
    return this.userbotService.deleteAllTemplates(user);
  }

  @Delete("templates/:id")
  @UseGuards(SellerCapabilitiesGuard)
  @RequireSellerCapabilities("userbot_campaign_manage")
  deleteTemplate(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.userbotService.deleteTemplate(user, id);
  }

  // --- 4. CAMPAIGNS ---

  @Get("campaigns")
  listCampaigns(@CurrentUser() user: AuthenticatedUser) {
    return this.userbotService.listCampaigns(user);
  }

  @Post("campaigns")
  @UseGuards(SellerCapabilitiesGuard)
  @RequireSellerCapabilities("userbot_campaign_manage")
  createCampaign(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateUserbotCampaignDto) {
    return this.userbotService.createCampaign(user, body);
  }

  @Post("campaigns/:id/start")
  @UseGuards(SellerCapabilitiesGuard)
  @RequireSellerCapabilities("userbot_campaign_manage")
  startCampaign(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.userbotService.startCampaign(user, id);
  }

  @Post("campaigns/:id/pause")
  @UseGuards(SellerCapabilitiesGuard)
  @RequireSellerCapabilities("userbot_campaign_manage")
  pauseCampaign(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.userbotService.pauseCampaign(user, id);
  }

  @Delete("campaigns/:id")
  @UseGuards(SellerCapabilitiesGuard)
  @RequireSellerCapabilities("userbot_campaign_manage")
  deleteCampaign(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.userbotService.deleteCampaign(user, id);
  }

  @Get("campaigns/:id/logs")
  getCampaignLogs(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.userbotService.getCampaignLogs(user, id);
  }
}
