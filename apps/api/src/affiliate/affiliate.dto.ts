import { IsBoolean, IsNumber, IsOptional, IsString, Max, Min } from "class-validator";

export class UpdateAffiliateConfigDto {
  @IsBoolean()
  enabled!: boolean;

  @IsNumber()
  @Min(0)
  @Max(100)
  commissionPct!: number;

  @IsOptional()
  @IsString()
  programText?: string;
}
