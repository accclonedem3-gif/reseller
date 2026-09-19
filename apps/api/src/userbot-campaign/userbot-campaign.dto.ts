import { IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from "class-validator";

export class SendOtpDto {
  @IsString()
  @IsNotEmpty()
  phoneNumber!: string;

  @IsInt()
  @IsOptional()
  apiId?: number;

  @IsString()
  @IsOptional()
  apiHash?: string;

  @IsString()
  @IsOptional()
  proxyUrl?: string;
}

export class VerifyOtpDto {
  @IsString()
  @IsNotEmpty()
  phoneNumber!: string;

  @IsString()
  @IsOptional()
  tempSessionString?: string;

  @IsInt()
  @IsOptional()
  apiId?: number;

  @IsString()
  @IsOptional()
  apiHash?: string;

  @IsString()
  @IsNotEmpty()
  phoneCode!: string;

  @IsString()
  @IsNotEmpty()
  phoneCodeHash!: string;

  @IsString()
  @IsOptional()
  password?: string;

  @IsString()
  @IsOptional()
  proxyUrl?: string;
}

export class UpdateProxyDto {
  @IsString()
  @IsOptional()
  proxyUrl?: string;
}

export enum TemplateTypeDto {
  SPINTAX_TEXT = "SPINTAX_TEXT",
  FORWARD_SAVED_MESSAGE = "FORWARD_SAVED_MESSAGE",
}

export class CreateTemplateDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsEnum(TemplateTypeDto)
  type: TemplateTypeDto = TemplateTypeDto.SPINTAX_TEXT;

  @IsString()
  @IsOptional()
  content?: string;

  @IsString()
  @IsOptional()
  mediaUrl?: string;

  @IsString()
  @IsOptional()
  savedMessageId?: string;

  @IsString()
  @IsOptional()
  savedMessageText?: string;
}

export enum UserbotTargetModeDto {
  GROUP_ONLY = "GROUP_ONLY",
  MEMBERS_DM = "MEMBERS_DM",
  BOTH = "BOTH",
}

export class CreateUserbotCampaignDto {
  @IsString()
  @IsNotEmpty()
  sessionId!: string;

  @IsString()
  @IsNotEmpty()
  templateId!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsEnum(UserbotTargetModeDto)
  @IsOptional()
  targetMode?: UserbotTargetModeDto = UserbotTargetModeDto.GROUP_ONLY;

  @IsArray()
  @IsString({ each: true })
  targetGroupIds!: string[];

  @IsOptional()
  targetTopics?: Record<string, number>;

  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  maxMembersPerRun?: number = 30;

  @IsInt()
  @Min(10)
  @Max(600)
  delaySeconds: number = 60;

  @IsDateString()
  @IsOptional()
  scheduleTime?: string;

  @IsBoolean()
  @IsOptional()
  isRecurring?: boolean;

  @IsInt()
  @Min(1)
  @Max(168)
  @IsOptional()
  repeatIntervalHours?: number;
}

export class UpdateUserbotCampaignDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsEnum(UserbotTargetModeDto)
  @IsOptional()
  targetMode?: UserbotTargetModeDto;

  @IsString()
  @IsOptional()
  templateId?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  targetGroupIds?: string[];

  @IsOptional()
  targetTopics?: Record<string, number>;

  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  maxMembersPerRun?: number;

  @IsInt()
  @Min(10)
  @Max(600)
  @IsOptional()
  delaySeconds?: number;

  @IsDateString()
  @IsOptional()
  scheduleTime?: string;

  @IsBoolean()
  @IsOptional()
  isRecurring?: boolean;

  @IsInt()
  @Min(1)
  @Max(168)
  @IsOptional()
  repeatIntervalHours?: number;
}

export class ActivateLicenseDto {
  @IsString()
  @IsNotEmpty()
  code!: string;
}
