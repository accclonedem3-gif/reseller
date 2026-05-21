import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, Post, Put, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";

import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";

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

  @Get("schedules")
  listSchedules(@CurrentUser() user: AuthenticatedUser) {
    return this.broadcastsService.listSchedules(user);
  }

  @Put("schedules/:id/toggle")
  @UseGuards(SellerCapabilitiesGuard)
  @RequireSellerCapabilities("broadcast_manage")
  toggleSchedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return this.broadcastsService.toggleSchedule(user, id);
  }

  @Delete("schedules/:id")
  @UseGuards(SellerCapabilitiesGuard)
  @RequireSellerCapabilities("broadcast_manage")
  deleteSchedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return this.broadcastsService.deleteSchedule(user, id);
  }

  @Get(":id/failed")
  getFailedRecipients(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return this.broadcastsService.getFailedRecipients(user, id);
  }

  @Post(":id/retry")
  @UseGuards(SellerCapabilitiesGuard)
  @RequireSellerCapabilities("broadcast_manage")
  retryBroadcast(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return this.broadcastsService.retryBroadcast(user, id);
  }

  @Post("upload-image")
  @UseGuards(SellerCapabilitiesGuard)
  @RequireSellerCapabilities("broadcast_manage")
  @UseInterceptors(FileInterceptor("file", {
    storage: memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (!file.mimetype.startsWith("image/")) {
        cb(new BadRequestException("Only image files are allowed"), false);
      } else {
        cb(null, true);
      }
    },
  }))
  uploadImage(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.broadcastsService.uploadBroadcastImage(user, file);
  }
}
