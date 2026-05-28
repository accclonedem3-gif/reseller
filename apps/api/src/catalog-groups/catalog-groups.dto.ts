import { IsArray, IsInt, IsOptional, IsString, Min } from "class-validator";

export class CreateCatalogGroupDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsString()
  iconCustomEmojiId?: string;
}

export class UpdateCatalogGroupDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsString()
  iconCustomEmojiId?: string;
}

export class ReorderCatalogGroupsDto {
  @IsArray()
  @IsString({ each: true })
  orderedIds!: string[];
}

export class BulkAssignGroupDto {
  @IsArray()
  @IsString({ each: true })
  productIds!: string[];

  @IsOptional()
  @IsString()
  groupId?: string | null;
}
