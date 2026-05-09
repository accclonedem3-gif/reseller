import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { UserRole } from "@prisma/client";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import type { AuthenticatedUser } from "../types";

import {
  ChangePasswordDto,
  CreateSellerByAdminDto,
  ForgotPasswordDto,
  LoginDto,
  RefreshDto,
  RegisterSellerDto,
  ResetPasswordDto,
  UpdateSellerByAdminDto,
  UpdateRecoveryEmailDto,
} from "./auth.dto";
import { AuthService } from "./auth.service";

@Controller()
export class AuthController {
  constructor(
    @Inject(AuthService)
    private readonly authService: AuthService,
  ) {}

  @Post("auth/login")
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  login(@Body() body: LoginDto) {
    return this.authService.login(body.username, body.password);
  }

  @Post("auth/refresh")
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  refresh(@Body() body: RefreshDto) {
    return this.authService.refresh(body.refreshToken);
  }

  @Post("auth/forgot-password")
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 300000, limit: 3 } })
  forgotPassword(@Body() body: ForgotPasswordDto) {
    return this.authService.requestPasswordReset(body.email);
  }

  @Post("auth/reset-password")
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 300000, limit: 5 } })
  resetPassword(@Body() body: ResetPasswordDto) {
    return this.authService.resetPassword(body.token, body.newPassword);
  }

  @Post("auth/register")
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  register(@Body() body: RegisterSellerDto) {
    return this.authService.register(body.username, body.email, body.password, body.displayName);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.me(user);
  }

  @Post("auth/change-password")
  @UseGuards(JwtAuthGuard)
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ChangePasswordDto,
  ) {
    return this.authService.changePassword(user.id, body.currentPassword, body.newPassword);
  }

  @Put("auth/recovery-email")
  @UseGuards(JwtAuthGuard)
  updateRecoveryEmail(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateRecoveryEmailDto,
  ) {
    return this.authService.updateRecoveryEmail(user.id, body.recoveryEmail);
  }

  @Get("admin/ctv")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  listSellerAccounts() {
    return this.authService.listSellerAccountsForAdmin();
  }

  @Post("admin/ctv")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  createSellerAccountByAdmin(@Body() body: CreateSellerByAdminDto) {
    return this.authService.createSellerAccountByAdmin(body);
  }

  @Put("admin/ctv/:userId")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  updateSellerAccountByAdmin(
    @Param("userId") userId: string,
    @Body() body: UpdateSellerByAdminDto,
  ) {
    return this.authService.updateSellerAccountByAdmin(userId, body);
  }

  @Post("admin/ctv/:userId/lock")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  lockSellerAccountByAdmin(@Param("userId") userId: string) {
    return this.authService.setSellerAccountDisabledByAdmin(userId, true);
  }

  @Post("admin/ctv/:userId/unlock")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  unlockSellerAccountByAdmin(@Param("userId") userId: string) {
    return this.authService.setSellerAccountDisabledByAdmin(userId, false);
  }

  @Delete("admin/ctv/:userId")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  deleteSellerAccountByAdmin(
    @Param("userId") userId: string,
    @Query("force") force?: string,
  ) {
    return this.authService.deleteSellerAccountByAdmin(userId, force === "true");
  }
}
