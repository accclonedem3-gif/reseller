import { IsDateString, IsEnum, IsOptional, IsString, IsInt, Min } from "class-validator";
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
