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

const toNumberOrUndefined = ({ value }: { value: unknown }) => {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : value;
};

export class UploadSourceStockDto {
  @IsOptional()
  @IsString()
  text?: string;
}

export class CreateSourceBatchDto {
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

export type ExtractSourceStockMode =
  | "FAST"
  | "RANGE"
  | "MANUAL_BY_INDEX"
  | "MANUAL_BY_ID"
  | "BATCH";

export class ExtractSourceStockDto {
  @IsIn(["FAST", "RANGE", "MANUAL_BY_INDEX", "MANUAL_BY_ID", "BATCH"])
  mode!: ExtractSourceStockMode;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  quantity?: number;

  @IsOptional()
  @IsEnum(StockExtractMethod)
  method?: StockExtractMethod;

  @IsOptional()
  @IsInt()
  @Min(1)
  fromIndex?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  toIndex?: number;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  @Min(1, { each: true })
  selectedIndices?: number[];

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  entryIds?: string[];

  @IsOptional()
  @IsString()
  batchId?: string;
}

export class SourceStockHistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class SourceStockEntriesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2000)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
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
