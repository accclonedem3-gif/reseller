import { Body, Controller, Delete, Get, Inject, Param, Post, Put, UseGuards } from "@nestjs/common";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import type { AuthenticatedUser } from "../types";

import {
  BulkAssignGroupDto,
  CreateCatalogGroupDto,
  ReorderCatalogGroupsDto,
  UpdateCatalogGroupDto,
} from "./catalog-groups.dto";
import { CatalogGroupsService } from "./catalog-groups.service";

@Controller("catalog-groups")
@UseGuards(JwtAuthGuard)
export class CatalogGroupsController {
  constructor(
    @Inject(CatalogGroupsService)
    private readonly catalogGroupsService: CatalogGroupsService,
  ) {}

  @Get()
  listGroups(@CurrentUser() user: AuthenticatedUser) {
    return this.catalogGroupsService.listGroups(user);
  }

  @Post()
  createGroup(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateCatalogGroupDto) {
    return this.catalogGroupsService.createGroup(user, body);
  }

  @Put("reorder")
  reorderGroups(@CurrentUser() user: AuthenticatedUser, @Body() body: ReorderCatalogGroupsDto) {
    return this.catalogGroupsService.reorderGroups(user, body);
  }

  @Post("bulk-assign")
  bulkAssign(@CurrentUser() user: AuthenticatedUser, @Body() body: BulkAssignGroupDto) {
    return this.catalogGroupsService.bulkAssign(user, body);
  }

  @Put(":id")
  updateGroup(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: UpdateCatalogGroupDto,
  ) {
    return this.catalogGroupsService.updateGroup(user, id, body);
  }

  @Delete(":id")
  deleteGroup(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.catalogGroupsService.deleteGroup(user, id);
  }
}
