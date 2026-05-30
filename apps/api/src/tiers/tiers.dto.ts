import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Min } from "class-validator";

export class PurchaseTierDto {
  @IsEnum(["pro", "ultra"])
  tier!: "pro" | "ultra";

  @IsEnum(["monthly", "quarterly", "semi_annual", "annual"])
  plan!: "monthly" | "quarterly" | "semi_annual" | "annual";

  @IsOptional()
  @IsString()
  referralCode?: string;

  @IsEnum(["PAYOS", "WALLET_BALANCE"])
  paymentMethod!: "PAYOS" | "WALLET_BALANCE";
}

export class SetAutoRenewDto {
  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsEnum(["monthly", "quarterly", "semi_annual", "annual"])
  plan?: "monthly" | "quarterly" | "semi_annual" | "annual";

  @IsOptional()
  @IsBoolean()
  useWallet?: boolean;
}

export class GrantUltraDto {
  @IsString()
  sellerId!: string;

  @IsInt()
  @Min(1)
  days!: number;

  @IsOptional()
  @IsString()
  note?: string;
}

export class RefundTierSubscriptionDto {
  @IsOptional()
  @IsString()
  note?: string;
}
