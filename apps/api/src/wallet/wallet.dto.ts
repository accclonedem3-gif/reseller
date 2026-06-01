import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, Max, Min, MinLength } from "class-validator";

export class CreateDepositRequestDto {
  @IsNumber()
  @Min(100000)
  amount!: number;

  @IsOptional()
  @IsEnum(["PAYOS", "USDT_SOL", "BINANCE"])
  paymentMethod?: "PAYOS" | "USDT_SOL" | "BINANCE";

  @IsOptional()
  @IsString()
  note?: string;
}

export class CreateWithdrawRequestDto {
  @IsNumber()
  @Min(100000)
  amount!: number;

  @IsString()
  @MinLength(2)
  bankName!: string;

  @IsString()
  @MinLength(6)
  bankAccountNumber!: string;

  @IsString()
  @MinLength(2)
  bankAccountName!: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class AdjustCustomerWalletDto {
  @IsEnum(["topup", "deduct", "set"])
  action!: "topup" | "deduct" | "set";

  @IsNumber()
  @Min(0)
  amount!: number;

  @IsOptional()
  @IsEnum(["VND", "USDT"])
  currency?: "VND" | "USDT";
}

export class CreateWalletPromotionDto {
  @IsNumber()
  @Min(0.01)
  @Max(100)
  bonusPercent!: number;

  @IsDateString()
  startAt!: string;

  @IsDateString()
  endAt!: string;
}

export class ApproveWithdrawRequestDto {
  @IsOptional()
  @IsString()
  note?: string;
}

export class RejectWithdrawRequestDto {
  @IsString()
  @MinLength(3)
  reason!: string;
}
