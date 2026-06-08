import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateIf,
} from "class-validator";
import {
  SourceAccountType,
  SourceDeliveryMode,
  SourceDurationType,
  SourceProductFamily,
  SourceWarrantyPolicy,
} from "@prisma/client";

function trimString({ value }: { value: unknown }) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export class CreateSourceProductDto {
  @IsOptional()
  @Transform(trimString)
  @IsString()
  productIcon?: string;

  @Transform(trimString)
  @IsString()
  @MinLength(2)
  sourceName!: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  sourceRawName?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  sourceDescription?: string;

  @IsNumber()
  @Min(0)
  sourcePrice!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  available?: number;

  @IsString()
  productFamily!: string;

  @ValidateIf((o) => o.productFamily === "OTHER")
  @IsNotEmpty()
  @IsString()
  productFamilyOther?: string;

  @IsOptional()
  @IsString()
  productPackage?: string;

  @IsEnum(SourceAccountType)
  accountType!: SourceAccountType;

  @ValidateIf((o) => o.accountType === SourceAccountType.OTHER)
  @IsNotEmpty()
  @IsString()
  accountTypeOther?: string;

  @IsEnum(SourceDurationType)
  durationType!: SourceDurationType;

  @ValidateIf((o) => o.durationType === SourceDurationType.OTHER)
  @IsNotEmpty()
  @IsString()
  durationTypeOther?: string;

  @IsEnum(SourceDeliveryMode)
  sourceDeliveryMode!: SourceDeliveryMode;

  @IsEnum(SourceWarrantyPolicy)
  warrantyPolicy!: SourceWarrantyPolicy;

  @IsOptional()
  @IsNumber()
  @Min(0)
  salePrice?: number;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsBoolean()
  internalSourceEnabled?: boolean;

  @ValidateIf((o) => o.internalSourceEnabled === true)
  @IsNumber()
  @Min(0)
  internalSourcePrice?: number;
}

export class UpdateAlertSettingsDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  stockAlertThreshold?: number;

  @IsOptional()
  @IsBoolean()
  stockAlertEnabled?: boolean;
}

export class UpdateSourceProductDto {
  @IsOptional()
  @Transform(trimString)
  @IsString()
  productIcon?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MinLength(2)
  sourceName?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  sourceRawName?: string;

  @IsOptional()
  @Transform(trimString)
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
  productFamily?: string;

  @ValidateIf((o) => o.productFamily === "OTHER")
  @IsNotEmpty()
  @IsString()
  productFamilyOther?: string;

  @IsOptional()
  @IsString()
  productPackage?: string;

  @IsOptional()
  @IsEnum(SourceAccountType)
  accountType?: SourceAccountType;

  @ValidateIf((o) => o.accountType === SourceAccountType.OTHER)
  @IsNotEmpty()
  @IsString()
  accountTypeOther?: string;

  @IsOptional()
  @IsEnum(SourceDurationType)
  durationType?: SourceDurationType;

  @ValidateIf((o) => o.durationType === SourceDurationType.OTHER)
  @IsNotEmpty()
  @IsString()
  durationTypeOther?: string;

  @IsOptional()
  @IsEnum(SourceDeliveryMode)
  sourceDeliveryMode?: SourceDeliveryMode;

  @IsOptional()
  @IsEnum(SourceWarrantyPolicy)
  warrantyPolicy?: SourceWarrantyPolicy;

  @IsOptional()
  @IsNumber()
  @Min(0)
  salePrice?: number;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsBoolean()
  internalSourceEnabled?: boolean;

  @ValidateIf((o) => o.internalSourceEnabled === true)
  @IsNumber()
  @Min(0)
  internalSourcePrice?: number;
}
