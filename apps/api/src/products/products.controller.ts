import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, Post, Put, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequireSellerCapabilities } from "../common/decorators/seller-capabilities.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { SellerCapabilitiesGuard } from "../common/guards/seller-capabilities.guard";
import type { AuthenticatedUser } from "../types";

import {
  CreateManualProductDto,
  PurgeDeliveredInventoryDto,
  UpdateProductDto,
} from "./products.dto";
import { ProductsService } from "./products.service";

@Controller("products")
@UseGuards(JwtAuthGuard)
export class ProductsController {
  constructor(
    @Inject(ProductsService)
    private readonly productsService: ProductsService,
  ) {}

  @Get()
  listProducts(@CurrentUser() user: AuthenticatedUser) {
    return this.productsService.listProducts(user);
  }

  @Get(":id/inventory")
  getProductInventory(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.productsService.getProductInventory(user, id);
  }

  @Get(":id")
  getProduct(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.productsService.getProduct(user, id);
  }

  @Post(":id/inventory/purge-delivered")
  @UseGuards(SellerCapabilitiesGuard)
  @RequireSellerCapabilities("products_manage")
  purgeDeliveredInventory(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: PurgeDeliveredInventoryDto,
  ) {
    return this.productsService.purgeDeliveredInventory(user, id, body);
  }

  @Post(":id/duplicate")
  @UseGuards(SellerCapabilitiesGuard)
  @RequireSellerCapabilities("products_manage")
  duplicateProduct(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.productsService.duplicateProduct(user, id);
  }

  @Post("upload-image")
  @UseGuards(SellerCapabilitiesGuard)
  @RequireSellerCapabilities("products_manage")
  @UseInterceptors(FileInterceptor("file", {
    storage: memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const isImage = file.mimetype.startsWith("image/");
      const isVideo = file.mimetype === "video/mp4" || file.mimetype === "video/quicktime" || file.mimetype === "video/webm";
      if (!isImage && !isVideo) {
        cb(new BadRequestException("Only image or video files (mp4/mov/webm) are allowed"), false);
      } else {
        cb(null, true);
      }
    },
  }))
  uploadImage(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.productsService.uploadProductImage(user, file);
  }

  @Post("manual")
  @UseGuards(SellerCapabilitiesGuard)
  @RequireSellerCapabilities("products_manage")
  createManualProduct(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateManualProductDto,
  ) {
    return this.productsService.createManualProduct(user, body);
  }

  @Put(":id")
  @UseGuards(SellerCapabilitiesGuard)
  @RequireSellerCapabilities("products_manage")
  updateProduct(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: UpdateProductDto,
  ) {
    return this.productsService.updateProduct(user, id, body);
  }

  @Delete(":id")
  @UseGuards(SellerCapabilitiesGuard)
  @RequireSellerCapabilities("products_manage")
  deleteProduct(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.productsService.deleteProduct(user, id);
  }

  @Post("reorder")
  @UseGuards(SellerCapabilitiesGuard)
  @RequireSellerCapabilities("products_manage")
  reorderProducts(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { items: { id: string; position: number }[] },
  ) {
    return this.productsService.reorderProducts(user, body.items || []);
  }
}
