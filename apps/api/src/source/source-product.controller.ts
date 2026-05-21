import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { SellerTier } from "@prisma/client";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequireSellerTier } from "../common/decorators/seller-tier.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { SellerTierGuard } from "../common/guards/seller-tier.guard";
import type { AuthenticatedUser } from "../types";

import { CreateSourceProductDto, UpdateAlertSettingsDto, UpdateSourceProductDto } from "./source-product.dto";
import { SourceProductService } from "./source-product.service";

@Controller("pro/source-products")
@UseGuards(JwtAuthGuard, SellerTierGuard)
@RequireSellerTier(SellerTier.ULTRA)
export class SourceProductController {
  constructor(
    @Inject(SourceProductService)
    private readonly sourceProductService: SourceProductService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.sourceProductService.list(user);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSourceProductDto,
  ) {
    return this.sourceProductService.create(user, dto);
  }

  @Put(":id")
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: UpdateSourceProductDto,
  ) {
    return this.sourceProductService.update(user, id, dto);
  }

  @Put(":id/alert-settings")
  updateAlertSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: UpdateAlertSettingsDto,
  ) {
    return this.sourceProductService.updateAlertSettings(user, id, dto);
  }

  @Delete(":id")
  remove(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.sourceProductService.remove(user, id);
  }
}
