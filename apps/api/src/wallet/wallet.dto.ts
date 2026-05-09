import { IsNumber, IsOptional, IsString, Min, MinLength } from "class-validator";

export class CreateDepositRequestDto {
  @IsNumber()
  @Min(1000)
  amount!: number;

  @IsOptional()
  @IsString()
  note?: string;
}

export class CreateWithdrawRequestDto {
  @IsNumber()
  @Min(1000)
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
