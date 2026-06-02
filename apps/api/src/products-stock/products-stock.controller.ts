import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
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
  CreateBatchDto,
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

  // ----- Batches -----
  @Get(":id/stock/batches")
  listBatches(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return this.stockService.listBatches(user, id);
  }

  @Post(":id/stock/batches")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: 2 * 1024 * 1024 },
    }),
  )
  createBatch(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: CreateBatchDto,
  ) {
    let text = body.text;
    if (file?.buffer) {
      text = file.buffer.toString("utf8");
    }
    if (!text || !text.trim()) {
      throw new BadRequestException("Cần file .txt hoặc trường text.");
    }
    return this.stockService.createBatch(user, id, { ...body, text });
  }

  @Patch(":id/stock/batches/:batchId")
  updateBatch(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("batchId") batchId: string,
    @Body() body: { priority?: number | null; name?: string },
  ) {
    return this.stockService.updateBatch(user, id, batchId, body);
  }

  @Delete(":id/stock/batches/:batchId")
  deleteBatch(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("batchId") batchId: string,
  ) {
    return this.stockService.deleteBatch(user, id, batchId);
  }

  // ----- Legacy upload (kept for backwards compat) -----
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

  // ----- Extract -----
  @Post(":id/stock/extract")
  extractStock(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: ExtractStockDto,
  ) {
    return this.stockService.extractStock(user, id, body);
  }

  // ----- Entries list (group by batch / filter status) -----
  @Get(":id/stock/entries")
  listEntries(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Query() query: StockEntriesQueryDto,
  ) {
    return this.stockService.listEntries(user, id, query);
  }

  // ----- Operation history -----
  @Get(":id/stock/history")
  listHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Query() query: StockHistoryQueryDto,
  ) {
    return this.stockService.listHistory(user, id, query);
  }
}
