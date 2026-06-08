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
import { UserRole } from "@prisma/client";

import { Roles } from "../common/decorators/roles.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";

import { CreateProductFamilyDto, UpdateProductFamilyDto } from "./product-family.dto";
import { ProductFamilyService } from "./product-family.service";

/** Read-only list of active families — used by product/source dropdowns. */
@Controller("product-families")
@UseGuards(JwtAuthGuard)
export class ProductFamilyController {
  constructor(
    @Inject(ProductFamilyService)
    private readonly service: ProductFamilyService,
  ) {}

  @Get()
  list() {
    return this.service.listActive();
  }
}

/** Admin management (super-admin only). */
@Controller("admin/product-families")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class AdminProductFamilyController {
  constructor(
    @Inject(ProductFamilyService)
    private readonly service: ProductFamilyService,
  ) {}

  @Get()
  listAll() {
    return this.service.listAll();
  }

  @Post()
  create(@Body() body: CreateProductFamilyDto) {
    return this.service.create(body);
  }

  @Put(":id")
  update(@Param("id") id: string, @Body() body: UpdateProductFamilyDto) {
    return this.service.update(id, body);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
