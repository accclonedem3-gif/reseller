import {
  IsEnum,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
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
  isShared?: boolean;

  @IsOptional()
  @IsString()
  sharedContent?: string;

  @IsOptional()
  @IsString()
  deliveryFormatHint?: string;

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
  @IsString()
  productPackage?: string;

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

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  productIcon?: string;

  @IsOptional()
  @IsString()
  iconCustomEmojiId?: string;

  @IsOptional()
  @IsString()
  usageInstructions?: string;

  @IsOptional()
  @IsString()
  promoType?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  promoBuyN?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  promoGetM?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  promoBulkMinQty?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  promoBulkDiscountPct?: number;

  @IsOptional()
  @IsString()
  promoStartAt?: string;

  @IsOptional()
  @IsString()
  promoEndAt?: string;

  @IsOptional()
  @IsString()
  promoBannerUrl?: string;

  @IsOptional()
  @IsBoolean()
  resetToSource?: boolean;
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
  isShared?: boolean;

  @IsOptional()
  @IsString()
  sharedContent?: string;

  @IsOptional()
  @IsString()
  deliveryFormatHint?: string;

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
  @IsString()
  productPackage?: string;

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

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  productIcon?: string;

  @IsOptional()
  @IsString()
  iconCustomEmojiId?: string;

  @IsOptional()
  @IsString()
  usageInstructions?: string;
}

export class PurgeDeliveredInventoryDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  entryKeys?: string[];
}
