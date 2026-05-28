import { BadRequestException, Body, Controller, Get, Headers, Put } from "@nestjs/common";
import { MiniAppService, BotCustomization } from "./mini-app.service";

@Controller("mini-app")
export class MiniAppController {
  constructor(private readonly miniAppService: MiniAppService) {}

  @Get("settings")
  getSettings(@Headers("x-twa-init-data") initData: string) {
    if (!initData) throw new BadRequestException("Missing x-twa-init-data header.");
    return this.miniAppService.getSettings(initData);
  }

  @Put("settings")
  saveSettings(
    @Headers("x-twa-init-data") initData: string,
    @Body() body: { customization: BotCustomization },
  ) {
    if (!initData) throw new BadRequestException("Missing x-twa-init-data header.");
    return this.miniAppService.saveSettings(initData, body.customization);
  }

  @Get("products")
  getProducts(@Headers("x-twa-init-data") initData: string) {
    if (!initData) throw new BadRequestException("Missing x-twa-init-data header.");
    return this.miniAppService.getProducts(initData);
  }

  @Get("global-default")
  getGlobalDefault(@Headers("x-twa-init-data") initData: string) {
    if (!initData) throw new BadRequestException("Missing x-twa-init-data header.");
    return this.miniAppService.getGlobalDefaultStatus(initData);
  }

  @Put("global-default")
  setGlobalDefault(
    @Headers("x-twa-init-data") initData: string,
    @Body() body: { enable: boolean },
  ) {
    if (!initData) throw new BadRequestException("Missing x-twa-init-data header.");
    return this.miniAppService.setGlobalDefault(initData, !!body.enable);
  }

  @Put("product-icons")
  saveProductIcons(
    @Headers("x-twa-init-data") initData: string,
    @Body() body: { productIcons: Record<string, { iconCustomEmojiId?: string; iconOutOfStockEmojiId?: string }> },
  ) {
    if (!initData) throw new BadRequestException("Missing x-twa-init-data header.");
    return this.miniAppService.saveProductIcons(initData, body.productIcons || {});
  }
}
