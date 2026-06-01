import { Module } from "@nestjs/common";

import { PrismaService } from "../db/prisma.service";

import { ProductsStockController } from "./products-stock.controller";
import { ProductsStockService } from "./products-stock.service";

@Module({
  controllers: [ProductsStockController],
  providers: [PrismaService, ProductsStockService],
  exports: [ProductsStockService],
})
export class ProductsStockModule {}
