import { Transform } from "class-transformer";
import { ArrayMaxSize, IsArray, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

function emptyStringToUndefined({ value }: { value: unknown }) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export class ResolveWarrantyClaimDto {
  @Transform(emptyStringToUndefined)
  @IsString()
  @MinLength(3)
  deliveredAccountText!: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @MaxLength(2000)
  resolutionNote?: string;
}

export class RejectWarrantyClaimDto {
  @Transform(emptyStringToUndefined)
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  reason!: string;
}

export class OpenWarrantyClaimDto {
  @IsString()
  @IsNotEmpty()
  orderCode!: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @MaxLength(2000)
  customerMessage?: string;
}

export class PublicWarrantySearchDto {
  @IsString()
  @IsNotEmpty()
  shopSlug!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  accountText!: string;

  @IsString()
  @IsNotEmpty()
  contactInfo!: string;
}

export class PublicWarrantyClaimDto {
  @IsString()
  @IsNotEmpty()
  orderId!: string;

  @IsString()
  @IsNotEmpty()
  shopSlug!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(200)
  contactInfo!: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @MaxLength(2000)
  customerMessage?: string;

  // If customer changed the account password after delivery, they pass the new one here
  // so the auto-check tool can log in successfully. Stored only in the job payload, not in DB.
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @MaxLength(200)
  currentPassword?: string;

  // Specific usernames to warranty (subset of delivered accounts). Used for prorated refund/replacement.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  targetUsernames?: string[];

  // Per-account password override map. Key = username (email full hoặc local-part trước @).
  // Value = mật khẩu mới khách đã đổi cho riêng account đó. Account không có key → giữ pwd gốc.
  // Ưu tiên hơn `currentPassword` (single global). Chỉ stored trong BullMQ job payload, không vô DB.
  @IsOptional()
  @IsObject()
  passwordOverrides?: Record<string, string>;

  // Client-generated UUID (sinh ra khi user vào step "confirm", giữ stable qua retry).
  // Server cache response 10 phút → submit lần 2 với cùng key → trả lại response cũ thay
  // vì tạo claim mới. Chống double-click / network retry / browser back+resubmit.
  // Bỏ qua → không có protection (backward-compat cho client cũ).
  @IsOptional()
  @IsString()
  @MaxLength(64)
  idempotencyKey?: string;
}
