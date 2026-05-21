import {
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequireSellerCapabilities } from "../common/decorators/seller-capabilities.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { SellerCapabilitiesGuard } from "../common/guards/seller-capabilities.guard";
import type { AuthenticatedUser } from "../types";

import { OrdersService } from "./orders.service";

@Controller("orders")
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(
    @Inject(OrdersService)
    private readonly ordersService: OrdersService,
  ) {}

  @Get()
  listOrders(
    @CurrentUser() user: AuthenticatedUser,
    @Query("status") status?: string,
  ) {
    return this.ordersService.listOrders(user, status);
  }

  @Get(":id")
  getOrder(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.ordersService.getOrder(user, id);
  }

  @Post(":id/manual-complete")
  @UseGuards(SellerCapabilitiesGuard)
  @RequireSellerCapabilities("orders_manage")
  completeManualOrder(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.ordersService.completePendingManualOrder(user, id);
  }

  @Post(":id/manual-cancel")
  @UseGuards(SellerCapabilitiesGuard)
  @RequireSellerCapabilities("orders_manage")
  cancelManualOrder(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.ordersService.cancelPendingManualOrder(user, id);
  }

  @Post(":id/manual-payment-confirm")
  @UseGuards(SellerCapabilitiesGuard)
  @RequireSellerCapabilities("orders_manage")
  confirmManualCryptoPayment(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.ordersService.confirmManualCryptoPayment(user, id);
  }
}
