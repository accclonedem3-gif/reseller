import { IsBoolean, IsNumber, IsOptional, IsString, Max, Min, MinLength } from "class-validator";

export class CreateDiscountCodeDto {
  @IsString()
  @MinLength(3)
  code!: string;

  @IsNumber()
  @Min(0.01)
  @Max(100)
  discountPercent!: number;

  @IsString()
  referrerSellerId!: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class ToggleDiscountCodeDto {
  @IsBoolean()
  active!: boolean;
}
