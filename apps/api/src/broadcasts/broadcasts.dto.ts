import { IsOptional, IsString, MinLength } from "class-validator";

export class CreateBroadcastDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsString()
  @MinLength(3)
  message!: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;
}
