import { Body, Controller, Get, Inject, Post, UseGuards } from "@nestjs/common";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequireSellerCapabilities } from "../common/decorators/seller-capabilities.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { SellerCapabilitiesGuard } from "../common/guards/seller-capabilities.guard";
import type { AuthenticatedUser } from "../types";

import { CreateBroadcastDto } from "./broadcasts.dto";
import { BroadcastsService } from "./broadcasts.service";

@Controller("broadcasts")
@UseGuards(JwtAuthGuard)
export class BroadcastsController {
  constructor(
    @Inject(BroadcastsService)
    private readonly broadcastsService: BroadcastsService,
  ) {}

  @Get()
  listBroadcasts(@CurrentUser() user: AuthenticatedUser) {
    return this.broadcastsService.listBroadcasts(user);
  }

  @Post()
  @UseGuards(SellerCapabilitiesGuard)
  @RequireSellerCapabilities("broadcast_manage")
  createBroadcast(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateBroadcastDto,
  ) {
    return this.broadcastsService.createBroadcast(user, body);
  }
}
