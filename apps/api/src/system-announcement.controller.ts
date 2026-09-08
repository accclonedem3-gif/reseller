import { BadRequestException, Controller, Get, Inject, Post, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { UserRole } from "@prisma/client";
import { randomUUID } from "crypto";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { memoryStorage } from "multer";
import { join } from "path";

import { Roles } from "./common/decorators/roles.decorator";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { RolesGuard } from "./common/guards/roles.guard";
import { AppConfigService } from "./config/app-config.service";
import { PrismaService } from "./db/prisma.service";

const ANNOUNCEMENT_KEYS = [
  "system_announcement_enabled", "system_announcement_title", "system_announcement_message",
  "system_announcement_image_url", "system_announcement_effect",
] as const;

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif",
};

@Controller("system")
export class SystemAnnouncementController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  @Get("announcement")
  @UseGuards(JwtAuthGuard)
  async getAnnouncement() {
    const configs = await this.prisma.systemConfig.findMany({ where: { key: { in: [...ANNOUNCEMENT_KEYS] } } });
    const values = Object.fromEntries(configs.map((config) => [config.key, config.value]));
    const updatedAt = configs.reduce((latest, config) => config.updatedAt > latest ? config.updatedAt : latest, new Date(0));
    return {
      enabled: values.system_announcement_enabled === "true",
      title: values.system_announcement_title || "Thông báo hệ thống",
      message: values.system_announcement_message || "",
      imageUrl: values.system_announcement_image_url || null,
      effect: values.system_announcement_effect || "zoom",
      version: updatedAt.toISOString(),
    };
  }

  @Post("announcement/image")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @UseInterceptors(FileInterceptor("file", {
    storage: memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_request, file, callback) => {
      if (!IMAGE_EXTENSIONS[file.mimetype]) callback(new BadRequestException("Chỉ hỗ trợ JPG, PNG, WEBP hoặc GIF."), false);
      else callback(null, true);
    },
  }))
  uploadAnnouncementImage(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException("Chưa chọn ảnh tải lên.");
    const directory = join(process.cwd(), "uploads", "announcements");
    if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
    const filename = `${randomUUID()}${IMAGE_EXTENSIONS[file.mimetype]}`;
    writeFileSync(join(directory, filename), file.buffer);
    return { url: `${this.config.appPublicUrl}/uploads/announcements/${filename}` };
  }
}