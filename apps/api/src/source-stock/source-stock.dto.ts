import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { StockExtractMethod } from "@prisma/client";

export class UploadSourceStockDto {
  @IsOptional()
  @IsString()
  text?: string;
}

export class ExtractSourceStockDto {
  @IsInt()
  @Min(1)
  @Max(100000)
  quantity!: number;

  @IsEnum(StockExtractMethod)
  method!: StockExtractMethod;
}

export class SourceStockHistoryQueryDto {
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
