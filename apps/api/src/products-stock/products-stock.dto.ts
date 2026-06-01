import {
  ArrayMinSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";
import { Transform, Type } from "class-transformer";
import { StockEntryStatus, StockExtractMethod } from "@prisma/client";

/**
 * multipart/form-data sends every field as a string.
 * These helpers coerce "123" → 123 (or undefined when empty / NaN)
 * so class-validator's @IsNumber / @IsInt accept the values.
 */
const toNumberOrUndefined = ({ value }: { value: unknown }) => {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : value;
};

export class UploadStockDto {
  @IsOptional()
  @IsString()
  text?: string;
}

export class CreateBatchDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @Transform(toNumberOrUndefined)
  @IsNumber()
  @Min(0)
  costPerAcc?: number;

  @IsOptional()
  @Transform(toNumberOrUndefined)
  @IsNumber()
  @Min(0)
  totalCost?: number;

  @IsOptional()
  @Transform(toNumberOrUndefined)
  @IsInt()
  @Min(1)
  expiresInDays?: number;

  @IsOptional()
  @IsString()
  expiresAt?: string;
}

export class AppendToBatchDto {
  @IsString()
  text!: string;
}

export type ExtractStockMode =
  | "FAST"
  | "RANGE"
  | "MANUAL_BY_INDEX"
  | "MANUAL_BY_ID"
  | "BATCH";

export class ExtractStockDto {
  @IsIn(["FAST", "RANGE", "MANUAL_BY_INDEX", "MANUAL_BY_ID", "BATCH"])
  mode!: ExtractStockMode;

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

  // MANUAL_BY_INDEX (legacy index-based)
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  @Min(1, { each: true })
  selectedIndices?: number[];

  // MANUAL_BY_ID — new: pick entries by their id
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  entryIds?: string[];

  // BATCH — extract whole batch
  @IsOptional()
  @IsString()
  batchId?: string;
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

export class StockEntriesQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2000)
  limit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(StockEntryStatus)
  status?: StockEntryStatus;

  @IsOptional()
  @IsString()
  batchId?: string;
}
