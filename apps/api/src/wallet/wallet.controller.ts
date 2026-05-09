import { Body, Controller, Get, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { SellerTier } from "@prisma/client";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequireSellerCapabilities } from "../common/decorators/seller-capabilities.decorator";
import { RequireSellerTier } from "../common/decorators/seller-tier.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { SellerCapabilitiesGuard } from "../common/guards/seller-capabilities.guard";
import { SellerTierGuard } from "../common/guards/seller-tier.guard";
import type { AuthenticatedUser } from "../types";

import {
  CreateDepositRequestDto,
  CreateWithdrawRequestDto,
} from "./wallet.dto";
import { WalletService } from "./wallet.service";

@Controller("wallet")
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(
    @Inject(WalletService)
    private readonly walletService: WalletService,
  ) {}

  @Get()
  getWallet(@CurrentUser() user: AuthenticatedUser) {
    return this.walletService.getWallet(user);
  }

  @Get("source-balance")
  getSourceWallet(@CurrentUser() user: AuthenticatedUser) {
    return this.walletService.getSourceWallet(user);
  }

  @Get("customer-wallets")
  getCustomerWallets(@CurrentUser() user: AuthenticatedUser) {
    return this.walletService.getCustomerWallets(user);
  }

  @Get("customer-wallets/:customerId/topups")
  getCustomerTopupHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Param("customerId") customerId: string,
  ) {
    return this.walletService.getCustomerTopupHistory(user, customerId);
  }

  @Get("ledgers")
  getWalletLedgers(@CurrentUser() user: AuthenticatedUser) {
    return this.walletService.getWalletLedgers(user);
  }

  @Get("deposit-requests")
  listDepositRequests(@CurrentUser() user: AuthenticatedUser) {
    return this.walletService.listDepositRequests(user);
  }

  @Get("withdraw-requests")
  listWithdrawRequests(@CurrentUser() user: AuthenticatedUser) {
    return this.walletService.listWithdrawRequests(user);
  }

  @Post("deposit-requests")
  @UseGuards(SellerTierGuard, SellerCapabilitiesGuard)
  @RequireSellerTier(SellerTier.PRO, SellerTier.ULTRA)
  @RequireSellerCapabilities("wallet_manage")
  createDepositRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateDepositRequestDto,
  ) {
    return this.walletService.createDepositRequest(user, body);
  }

  @Post("withdraw-requests")
  @UseGuards(SellerTierGuard, SellerCapabilitiesGuard)
  @RequireSellerTier(SellerTier.PRO, SellerTier.ULTRA)
  @RequireSellerCapabilities("wallet_manage")
  createWithdrawRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateWithdrawRequestDto,
  ) {
    return this.walletService.createWithdrawRequest(user, body);
  }
}
