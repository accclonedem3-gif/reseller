import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { StockExtractMethod } from "@prisma/client";

export class UploadStockDto {
  @IsOptional()
  @IsString()
  text?: string;
}

export class ExtractStockDto {
  @IsInt()
  @Min(1)
  @Max(100000)
  quantity!: number;

  @IsEnum(StockExtractMethod)
  method!: StockExtractMethod;
}

export class StockHistoryQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number;
}
