import { IsDateString, IsEnum, IsOptional, IsString, IsInt, IsNumber, Min, Max, MaxLength } from "class-validator";
import { Type } from "class-transformer";
import { SellerTier } from "@prisma/client";

export class ListSellersQueryDto {
  @IsOptional()
  @IsEnum(SellerTier)
  tier?: SellerTier;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  search?: string;
}

export class UpdateSellerAffiliateCommissionDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  affiliateCommissionPercent?: number | null;
}
export class UpdateSellerTierDto {
  @IsEnum(SellerTier)
  tier!: SellerTier;
}

export class UpdateSellerTierDatesDto {
  @IsOptional()
  @IsDateString()
  tierStartedAt?: string | null;

  @IsOptional()
  @IsDateString()
  tierExpiresAt?: string | null;
}

export class ListAdminOrdersQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  search?: string;
}

export class RefundAdminOrderDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class UpdateSystemConfigDto {
  @IsString()
  key!: string;

  @IsString()
  value!: string;
}

export class BulkUpdateSystemConfigDto {
  @IsOptional()
  configs!: Record<string, string>;
}

export class SyncBotCommandsDto {
  @IsOptional()
  @IsString()
  shopId?: string;
}

export class GenerateUserbotLicenseKeyDto {
  @IsEnum(["PLUS", "PRO", "UNLIMITED"])
  type!: "PLUS" | "PRO" | "UNLIMITED";

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  durationDays!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  count!: number;
}
