import {
  IsEnum,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from "class-validator";
import {
  SourceAccountType,
  SourceDeliveryMode,
  SourceDurationType,
  SourceProductFamily,
  SourceWarrantyPolicy,
} from "@prisma/client";

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  salePrice?: number;

  @IsOptional()
  @IsBoolean()
  hidden?: boolean;

  @IsOptional()
  @IsBoolean()
  hiddenVi?: boolean;

  @IsOptional()
  @IsBoolean()
  hiddenEn?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  salePriceUsd?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  promoText?: string;

  @IsOptional()
  @IsString()
  sourceName?: string;

  @IsOptional()
  @IsString()
  sourceDescription?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  sourcePrice?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  available?: number;

  @IsOptional()
  @IsString()
  deliveryText?: string;

  @IsOptional()
  @IsBoolean()
  internalSourceEnabled?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  internalSourcePrice?: number;

  @IsOptional()
  @IsEnum(SourceProductFamily)
  productFamily?: SourceProductFamily;

  @ValidateIf((input: UpdateProductDto) => input.productFamily === SourceProductFamily.OTHER)
  @IsString()
  productFamilyOther?: string;

  @IsOptional()
  @IsEnum(SourceAccountType)
  accountType?: SourceAccountType;

  @ValidateIf((input: UpdateProductDto) => input.accountType === SourceAccountType.OTHER)
  @IsString()
  accountTypeOther?: string;

  @IsOptional()
  @IsEnum(SourceDurationType)
  durationType?: SourceDurationType;

  @ValidateIf((input: UpdateProductDto) => input.durationType === SourceDurationType.OTHER)
  @IsString()
  durationTypeOther?: string;

  @IsOptional()
  @IsEnum(SourceDeliveryMode)
  sourceDeliveryMode?: SourceDeliveryMode;

  @IsOptional()
  @IsEnum(SourceWarrantyPolicy)
  warrantyPolicy?: SourceWarrantyPolicy;
}

export class CreateManualProductDto {
  @IsString()
  displayName!: string;

  @IsOptional()
  @IsString()
  sourceName?: string;

  @IsOptional()
  @IsString()
  sourceDescription?: string;

  @IsNumber()
  @Min(0)
  salePrice!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  sourcePrice?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  available?: number;

  @IsOptional()
  @IsBoolean()
  hidden?: boolean;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  promoText?: string;

  @IsOptional()
  @IsString()
  deliveryText?: string;

  @IsOptional()
  @IsBoolean()
  internalSourceEnabled?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  internalSourcePrice?: number;

  @IsOptional()
  @IsEnum(SourceProductFamily)
  productFamily?: SourceProductFamily;

  @ValidateIf((input: CreateManualProductDto) => input.productFamily === SourceProductFamily.OTHER)
  @IsString()
  productFamilyOther?: string;

  @IsOptional()
  @IsEnum(SourceAccountType)
  accountType?: SourceAccountType;

  @ValidateIf((input: CreateManualProductDto) => input.accountType === SourceAccountType.OTHER)
  @IsString()
  accountTypeOther?: string;

  @IsOptional()
  @IsEnum(SourceDurationType)
  durationType?: SourceDurationType;

  @ValidateIf((input: CreateManualProductDto) => input.durationType === SourceDurationType.OTHER)
  @IsString()
  durationTypeOther?: string;

  @IsOptional()
  @IsEnum(SourceDeliveryMode)
  sourceDeliveryMode?: SourceDeliveryMode;

  @IsOptional()
  @IsEnum(SourceWarrantyPolicy)
  warrantyPolicy?: SourceWarrantyPolicy;
}

export class PurgeDeliveredInventoryDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  entryKeys?: string[];
}
