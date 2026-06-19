import { IsIn, IsInt, IsOptional, IsString, Max, Min, MinLength } from "class-validator";

export class CreateBroadcastDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsString()
  @MinLength(1)
  message!: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsIn(["immediate", "scheduled", "recurring"])
  mode?: "immediate" | "scheduled" | "recurring";

  @IsOptional()
  @IsString()
  scheduledAt?: string;

  @IsOptional()
  @IsString()
  sendTime?: string;

  @IsOptional()
  @IsIn(["daily", "weekly"])
  frequency?: "daily" | "weekly";

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  repeatDay?: number;
}

export class UpdateBroadcastScheduleDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  message?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  sendTime?: string;

  @IsOptional()
  @IsIn(["daily", "weekly"])
  frequency?: "daily" | "weekly";

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  repeatDay?: number;
}

export class UpdateScheduledBroadcastDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  message?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  scheduledAt?: string;
}
