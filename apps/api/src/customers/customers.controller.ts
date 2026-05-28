import { Body, Controller, Get, Inject, Param, Put, UseGuards } from "@nestjs/common";
import { IsBoolean, IsInt, Max, Min } from "class-validator";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import type { AuthenticatedUser } from "../types";

import { CustomersService } from "./customers.service";

class SetCtvDto {
  @IsBoolean()
  isCtv!: boolean;
}

class SetBlacklistDto {
  @IsBoolean()
  blacklisted!: boolean;
}

class SetDiscountPercentDto {
  @IsInt()
  @Min(0)
  @Max(100)
  discountPercent!: number;
}

@Controller("customers")
@UseGuards(JwtAuthGuard)
export class CustomersController {
  constructor(
    @Inject(CustomersService)
    private readonly customersService: CustomersService,
  ) {}

  @Get()
  listCustomers(@CurrentUser() user: AuthenticatedUser) {
    return this.customersService.listCustomers(user);
  }

  @Put(":id/ctv")
  setCtv(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: SetCtvDto,
  ) {
    return this.customersService.setCtv(user, id, body.isCtv);
  }

  @Put(":id/blacklist")
  setBlacklist(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: SetBlacklistDto,
  ) {
    return this.customersService.setBlacklist(user, id, body.blacklisted);
  }

  @Put(":id/discount")
  setDiscountPercent(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: SetDiscountPercentDto,
  ) {
    return this.customersService.setDiscountPercent(user, id, body.discountPercent);
  }
}
