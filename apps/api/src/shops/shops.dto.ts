import { StorefrontMode } from "@prisma/client";
import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  MinLength,
} from "class-validator";

function emptyStringToUndefined({
  value,
}: {
  value: unknown;
}) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export class UpdateShopDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  tagline?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  supportTelegram?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  supportZalo?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUrl()
  logoUrl?: string;

  @IsOptional()
  @IsEnum(StorefrontMode)
  storefrontMode?: StorefrontMode;
}

export class UpdateBotConfigDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @MinLength(2)
  shopName?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  shopTagline?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  botToken?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUrl({
    require_tld: false,
    require_protocol: true,
  })
  providerBaseUrl?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  providerBuyerKey?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  supportTelegram?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  supportZalo?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUrl()
  logoUrl?: string;

  @IsOptional()
  @IsBoolean()
  sourceNotificationSyncEnabled?: boolean;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  payosClientId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  payosApiKey?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  payosChecksumKey?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  binanceUid?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  okxUid?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  usdtTrc20Address?: string;

  @IsOptional()
  @IsString()
  usdtVndRateOverride?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  binancePersonalApiKey?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  binancePersonalSecretKey?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  binancePayApiKey?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  binancePaySecretKey?: string;

  @IsOptional()
  @IsBoolean()
  binancePayEnabled?: boolean;

  @IsOptional()
  @IsEnum(StorefrontMode)
  storefrontMode?: StorefrontMode;
}
