import { IsBoolean, IsEnum, IsObject, IsOptional, IsString, MinLength } from "class-validator";
import { SourceProductFamily } from "@prisma/client";

export class UpdateTemplateCustomizationDto {
  @IsObject()
  customization!: Record<string, any>;
}

export class SetProductDefaultDto {
  @IsString()
  family!: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsString()
  customEmojiId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsObject()
  media?: {
    type?: "photo" | "video" | "animation";
    adminFileId?: string;
    url?: string;
    thumbnailLocal?: string;
    caption?: string;
  };
}

export class RemoveProductDefaultDto {
  @IsString()
  family!: string;
}

export class UploadMediaUrlDto {
  @IsString()
  family!: string;

  @IsString()
  url!: string;

  @IsEnum(["photo", "video", "animation"])
  type!: "photo" | "video" | "animation";

  @IsOptional()
  @IsString()
  caption?: string;
}

export class ResetShopCustomizationDto {
  @IsOptional()
  @IsBoolean()
  alsoResetProductOverrides?: boolean;
}

export class SetBotTokenDto {
  @IsString()
  token!: string;
}

export class UpdateInvoiceTemplateDto {
  @IsObject()
  template!: Record<string, any>;
}

export class TestInvoiceDto {
  @IsOptional()
  @IsString()
  telegramChatId?: string;

  @IsOptional()
  @IsString()
  mode?: "small" | "large";
}

export class UpdateRestockTemplateDto {
  @IsObject()
  template!: Record<string, any>;
}

export class TestRestockDto {
  @IsOptional()
  @IsString()
  telegramChatId?: string;
}
