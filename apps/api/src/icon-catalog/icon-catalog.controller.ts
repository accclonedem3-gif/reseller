import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import type { AuthenticatedUser } from "../types";

import { IconCatalogService, UpsertIconDto } from "./icon-catalog.service";

@Controller("icon-catalog")
@UseGuards(JwtAuthGuard)
export class IconCatalogController {
  constructor(
    @Inject(IconCatalogService)
    private readonly iconCatalogService: IconCatalogService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.iconCatalogService.listIcons(user);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: UpsertIconDto) {
    return this.iconCatalogService.createIcon(user, body);
  }

  @Put(":id")
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: UpsertIconDto,
  ) {
    return this.iconCatalogService.updateIcon(user, id, body);
  }

  @Delete(":id")
  delete(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.iconCatalogService.deleteIcon(user, id);
  }
}
