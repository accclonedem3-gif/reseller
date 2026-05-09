import { Transform } from "class-transformer";
import { IsNotEmpty, IsOptional, IsString, MinLength } from "class-validator";

function emptyStringToUndefined({ value }: { value: unknown }) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export class ResolveWarrantyClaimDto {
  @Transform(emptyStringToUndefined)
  @IsString()
  @MinLength(3)
  deliveredAccountText!: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  resolutionNote?: string;
}

export class RejectWarrantyClaimDto {
  @Transform(emptyStringToUndefined)
  @IsString()
  @MinLength(3)
  reason!: string;
}

export class OpenWarrantyClaimDto {
  @IsString()
  @IsNotEmpty()
  orderCode!: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  customerMessage?: string;
}

export class PublicWarrantySearchDto {
  @IsString()
  @IsNotEmpty()
  shopSlug!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  accountText!: string;

  @IsString()
  @IsNotEmpty()
  contactInfo!: string;
}

export class PublicWarrantyClaimDto {
  @IsString()
  @IsNotEmpty()
  orderId!: string;

  @IsString()
  @IsNotEmpty()
  shopSlug!: string;

  @IsString()
  @IsNotEmpty()
  contactInfo!: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  customerMessage?: string;
}
