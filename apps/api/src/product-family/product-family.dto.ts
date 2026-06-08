import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";

export class CreateProductFamilyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  key!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  label!: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  emoji?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  customEmojiId?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdateProductFamilyDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  emoji?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  customEmojiId?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
