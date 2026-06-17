import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import type { AuthenticatedUser } from "../types";

import {
  RemoveProductDefaultDto,
  ResetShopCustomizationDto,
  SetBotTokenDto,
  SetProductDefaultDto,
  TestInvoiceDto,
  TestRestockDto,
  UpdateButtonsDto,
  UpdateInvoiceTemplateDto,
  UpdateRestockTemplateDto,
  UpdateTemplateCustomizationDto,
  UploadMediaUrlDto,
} from "./admin-template.dto";
import { AdminTemplateService } from "./admin-template.service";

@Controller("admin-template")
@UseGuards(JwtAuthGuard)
export class AdminTemplateController {
  constructor(
    @Inject(AdminTemplateService)
    private readonly service: AdminTemplateService,
  ) {}

  @Post("bootstrap")
  bootstrap(@CurrentUser() user: AuthenticatedUser) {
    return this.service.bootstrap(user);
  }

  @Get()
  getTemplate(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getTemplate(user);
  }

  @Put("customization")
  updateTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateTemplateCustomizationDto,
  ) {
    return this.service.updateTemplate(user, body);
  }

  @Put("bot-token")
  setBotToken(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: SetBotTokenDto,
  ) {
    return this.service.setBotToken(user, body.token);
  }

  @Post("product-defaults")
  setProductDefault(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: SetProductDefaultDto,
  ) {
    return this.service.setProductDefault(user, body);
  }

  @Delete("product-defaults")
  removeProductDefault(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RemoveProductDefaultDto,
  ) {
    return this.service.removeProductDefault(user, body);
  }

  @Post("product-media")
  setMediaUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UploadMediaUrlDto,
  ) {
    return this.service.setMediaUrl(user, body);
  }

  @Post("upload-media")
  @UseInterceptors(FileInterceptor("file", {
    storage: memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB Telegram Bot API limit
    fileFilter: (_req, file, cb) => {
      if (file.mimetype.startsWith("image/") || file.mimetype.startsWith("video/")) {
        cb(null, true);
      } else {
        cb(new BadRequestException("Only image/video files allowed."), false);
      }
    },
  }))
  uploadMediaFile(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.service.uploadMediaFile(user, file);
  }

  @Post("reset")
  resetShopCustomization(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ResetShopCustomizationDto,
  ) {
    return this.service.resetShopCustomization(user, body);
  }

  @Post("reset-product/:productId")
  resetProductIcon(
    @CurrentUser() user: AuthenticatedUser,
    @Param("productId") productId: string,
  ) {
    return this.service.resetProductIcon(user, productId);
  }

  @Post("backfill-icons")
  backfillIcons(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { force?: boolean } = {},
  ) {
    return this.service.backfillIcons(user, { force: body.force === true });
  }

  @Get("invoice-template")
  getInvoiceTemplate(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getInvoiceTemplate(user);
  }

  @Put("invoice-template")
  updateInvoiceTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateInvoiceTemplateDto,
  ) {
    return this.service.updateInvoiceTemplate(user, body);
  }

  @Post("invoice-template/test")
  testInvoice(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: TestInvoiceDto,
  ) {
    return this.service.testInvoice(user, body);
  }

  @Get("restock-template")
  getRestockTemplate(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getRestockTemplate(user);
  }

  @Put("restock-template")
  updateRestockTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateRestockTemplateDto,
  ) {
    return this.service.updateRestockTemplate(user, body);
  }

  @Post("restock-template/test")
  testRestock(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: TestRestockDto,
  ) {
    return this.service.testRestock(user, body);
  }

  @Get("buttons")
  getButtons(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getButtons(user);
  }

  @Put("buttons")
  updateButtons(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateButtonsDto,
  ) {
    return this.service.updateButtons(user, body);
  }
}
