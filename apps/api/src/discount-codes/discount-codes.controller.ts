import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { UserRole } from "@prisma/client";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import type { AuthenticatedUser } from "../types";

import {
  CreateDiscountCodeDto,
  ToggleDiscountCodeDto,
} from "./discount-codes.dto";
import { DiscountCodesService } from "./discount-codes.service";

@Controller("admin/discount-codes")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class DiscountCodesController {
  constructor(
    @Inject(DiscountCodesService)
    private readonly service: DiscountCodesService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listDiscountCodes(user);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateDiscountCodeDto) {
    return this.service.createDiscountCode(user, body);
  }

  @Patch(":id/toggle")
  toggle(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: ToggleDiscountCodeDto,
  ) {
    return this.service.toggleActive(user, id, body.active);
  }
}
