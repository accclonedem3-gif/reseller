import { StorefrontMode } from "@prisma/client";
import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  MinLength,
  ValidateIf,
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
  @ValidateIf((o) => o.tagline != null)
  @IsString()
  tagline?: string | null;

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
  @ValidateIf((o) => o.shopTagline != null)
  @IsString()
  shopTagline?: string | null;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  botToken?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  ownerTelegramUserId?: string;

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
  @Transform(({ value }) => {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  })
  @IsNumber()
  @Min(0)
  @Max(500)
  priceMarkupPercent?: number | null;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  paymentProvider?: string;

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
  pay2sPartnerCode?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  pay2sAccessKey?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  pay2sSecretKey?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  pay2sBankAccount?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  pay2sBankId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  web2mAccountNumber?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  web2mBankCode?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  web2mPassword?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  web2mToken?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  web2mAccessToken?: string;

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
  @Transform(emptyStringToUndefined)
  @IsString()
  usdtSolanaAddress?: string;

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
  @Transform(emptyStringToUndefined)
  @IsString()
  okxPersonalApiKey?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  okxPersonalSecretKey?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  okxPersonalPassphrase?: string;

  @IsOptional()
  @IsBoolean()
  okxPersonalApiEnabled?: boolean;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  usdtBep20Address?: string;

  @IsOptional()
  @IsEnum(StorefrontMode)
  storefrontMode?: StorefrontMode;

  @IsOptional()
  @IsBoolean()
  showOutOfStock?: boolean;
}
