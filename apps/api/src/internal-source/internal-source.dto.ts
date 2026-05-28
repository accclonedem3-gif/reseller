import { Transform } from "class-transformer";
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from "class-validator";

function emptyStringToUndefined({ value }: { value: unknown }) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export class CreateInternalSourceApiKeyDto {
  @IsString()
  @MinLength(2)
  label!: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  note?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class ConnectInternalSourceDto {
  @Transform(emptyStringToUndefined)
  @IsString()
  apiKey!: string;
}

export class TopUpInternalSourceConnectionDto {
  @IsInt()
  @Min(1000)
  amount!: number;
}

export class InternalBuyerPurchaseDto {
  @Transform(emptyStringToUndefined)
  @IsString()
  key!: string;

  @Transform(emptyStringToUndefined)
  @IsString()
  product_id!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  customer_email?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  slot_months?: number;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  client_order_code?: string;
}

export class DeliverInternalSourceOrderDto {
  @Transform(emptyStringToUndefined)
  @IsString()
  @MinLength(3)
  deliveredAccountText!: string;
}

export class FailInternalSourceOrderDto {
  @Transform(emptyStringToUndefined)
  @IsString()
  @MinLength(3)
  reason!: string;
}

export class AdjustConnectionBalanceDto {
  @IsIn(["topup", "deduct", "set"])
  action!: "topup" | "deduct" | "set";

  @IsNumber()
  @Min(0)
  amount!: number;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  note?: string;
}

