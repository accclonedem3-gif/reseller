import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { SellerTier } from "@prisma/client";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequireSellerTier } from "../common/decorators/seller-tier.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { SellerTierGuard } from "../common/guards/seller-tier.guard";
import type { AuthenticatedUser } from "../types";

import {
  ExtractSourceStockDto,
  SourceStockEntriesQueryDto,
  SourceStockHistoryQueryDto,
  UploadSourceStockDto,
} from "./source-stock.dto";
import { SourceStockService } from "./source-stock.service";

@Controller("source/products")
@UseGuards(JwtAuthGuard, SellerTierGuard)
@RequireSellerTier(SellerTier.ULTRA)
export class SourceStockController {
  constructor(
    @Inject(SourceStockService)
    private readonly stockService: SourceStockService,
  ) {}

  @Post(":id/stock/upload")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: 1 * 1024 * 1024 },
    }),
  )
  uploadStock(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: UploadSourceStockDto,
  ) {
    let text: string | null = null;
    if (file?.buffer) {
      text = file.buffer.toString("utf8");
    } else if (typeof body?.text === "string" && body.text.length > 0) {
      text = body.text;
    }

    if (text == null || text.length === 0) {
      throw new BadRequestException("Vui lòng gửi file kho hoặc trường 'text' trong body.");
    }

    return this.stockService.uploadStock(user, id, text);
  }

  @Post(":id/stock/extract")
  extractStock(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: ExtractSourceStockDto,
  ) {
    return this.stockService.extractStock(user, id, body);
  }

  @Get(":id/stock/history")
  listHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Query() query: SourceStockHistoryQueryDto,
  ) {
    return this.stockService.listHistory(user, id, query);
  }

  @Get(":id/stock/entries")
  listEntries(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Query() query: SourceStockEntriesQueryDto,
  ) {
    return this.stockService.listEntries(user, id, query);
  }
}
