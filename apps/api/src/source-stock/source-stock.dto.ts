import {
  ArrayMinSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";
import { StockExtractMethod } from "@prisma/client";

export class UploadSourceStockDto {
  @IsOptional()
  @IsString()
  text?: string;
}

export type ExtractSourceStockMode = "FAST" | "RANGE" | "MANUAL";

export class ExtractSourceStockDto {
  @IsIn(["FAST", "RANGE", "MANUAL"])
  mode!: ExtractSourceStockMode;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  // FAST mode
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  quantity?: number;

  @IsOptional()
  @IsEnum(StockExtractMethod)
  method?: StockExtractMethod;

  // RANGE mode (1-indexed inclusive)
  @IsOptional()
  @IsInt()
  @Min(1)
  fromIndex?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  toIndex?: number;

  // MANUAL mode (1-indexed)
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  @Min(1, { each: true })
  selectedIndices?: number[];
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

export class SourceStockEntriesQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @IsString()
  search?: string;
}
