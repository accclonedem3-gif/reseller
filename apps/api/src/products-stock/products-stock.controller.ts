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

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import type { AuthenticatedUser } from "../types";

import {
  ExtractStockDto,
  StockEntriesQueryDto,
  StockHistoryQueryDto,
  UploadStockDto,
} from "./products-stock.dto";
import { ProductsStockService } from "./products-stock.service";

@Controller("products/source-products")
@UseGuards(JwtAuthGuard)
export class ProductsStockController {
  constructor(
    @Inject(ProductsStockService)
    private readonly stockService: ProductsStockService,
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
    @Body() body: UploadStockDto,
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
    @Body() body: ExtractStockDto,
  ) {
    return this.stockService.extractStock(user, id, body);
  }

  @Get(":id/stock/history")
  listHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Query() query: StockHistoryQueryDto,
  ) {
    return this.stockService.listHistory(user, id, query);
  }

  @Get(":id/stock/entries")
  listEntries(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Query() query: StockEntriesQueryDto,
  ) {
    return this.stockService.listEntries(user, id, query);
  }
}
