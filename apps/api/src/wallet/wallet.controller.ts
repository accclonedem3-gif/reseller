import { Body, Controller, Delete, Get, Inject, Param, Post, Put, UseGuards } from "@nestjs/common";
import { SellerTier } from "@prisma/client";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequireSellerCapabilities } from "../common/decorators/seller-capabilities.decorator";
import { RequireSellerTier } from "../common/decorators/seller-tier.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { SellerCapabilitiesGuard } from "../common/guards/seller-capabilities.guard";
import { SellerTierGuard } from "../common/guards/seller-tier.guard";
import type { AuthenticatedUser } from "../types";

import {
  AdjustCustomerWalletDto,
  CreateDepositRequestDto,
  CreateWithdrawRequestDto,
  CreateWalletPromotionDto,
} from "./wallet.dto";
import { WalletService } from "./wallet.service";
import { WalletPromotionService } from "./wallet-promotion.service";

@Controller("wallet")
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(
    @Inject(WalletService)
    private readonly walletService: WalletService,
    @Inject(WalletPromotionService)
    private readonly promotionService: WalletPromotionService,
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

  @Put("customer-wallets/:customerId/adjust")
  @UseGuards(SellerTierGuard)
  @RequireSellerTier(SellerTier.PRO, SellerTier.ULTRA)
  adjustCustomerWallet(
    @CurrentUser() user: AuthenticatedUser,
    @Param("customerId") customerId: string,
    @Body() body: AdjustCustomerWalletDto,
  ) {
    return this.walletService.adjustCustomerWallet(user, customerId, body);
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
  createDepositRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateDepositRequestDto,
  ) {
    return this.walletService.createDepositRequest(user, body);
  }

  @Delete("deposit-requests/:id")
  cancelDepositRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return this.walletService.cancelDepositRequest(user, id);
  }

  @Delete("withdraw-requests/:id")
  cancelWithdrawRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return this.walletService.cancelWithdrawRequest(user, id);
  }

  @Post("withdraw-requests")
  createWithdrawRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateWithdrawRequestDto,
  ) {
    return this.walletService.createWithdrawRequest(user, body);
  }

  @Get("promotions")
  listPromotions(@CurrentUser() user: AuthenticatedUser) {
    return this.promotionService.listPromotions(user);
  }

  @Post("promotions")
  @UseGuards(SellerTierGuard)
  @RequireSellerTier(SellerTier.PRO, SellerTier.ULTRA)
  createPromotion(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateWalletPromotionDto,
  ) {
    return this.promotionService.createPromotion(user, body);
  }

  @Delete("promotions/:id")
  @UseGuards(SellerTierGuard)
  @RequireSellerTier(SellerTier.PRO, SellerTier.ULTRA)
  deletePromotion(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return this.promotionService.deletePromotion(user, id);
  }
}
