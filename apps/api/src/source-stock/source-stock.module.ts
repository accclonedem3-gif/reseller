import { Module } from "@nestjs/common";

import { PrismaService } from "../db/prisma.service";

import { SourceStockController } from "./source-stock.controller";
import { SourceStockService } from "./source-stock.service";

@Module({
  controllers: [SourceStockController],
  providers: [PrismaService, SourceStockService],
  exports: [SourceStockService],
})
export class SourceStockModule {}
