import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiPropertyOptional,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from "@nestjs/swagger";
import {
  DownstreamSourceConnectionStatus,
  InternalSourceLedgerType,
  InternalSourceOrderStatus,
  Prisma,
} from "@prisma/client";
import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from "class-validator";
import type { Request } from "express";

import { PrismaService } from "../db/prisma.service";
import { InternalSourceService } from "../internal-source/internal-source.service";
import {
  decimalToNumber,
  generateSourceOrderCode,
  splitWalletDebit,
  toDecimal,
} from "../lib/utils";

class CreateInternalSourceOrderDto {
  @ApiProperty({ type: String, description: "ID of the source product from /catalog", example: "clxyz123" })
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @ApiProperty({ type: Number, description: "Number of units to purchase", example: 1, minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({ type: String, description: "Your internal order reference code", example: "ORDER-001" })
  @IsOptional()
  @IsString()
  clientOrderCode?: string;

  @ApiPropertyOptional({ type: String, description: "Customer email for digital delivery", example: "customer@example.com" })
  @IsOptional()
  @IsString()
  customerEmail?: string;
}

@ApiTags("Internal Source")
@ApiSecurity("source-api-key")
@Controller("internal-source/v1")
export class InternalSourceApiController {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(InternalSourceService)
    private readonly internalSourceService: InternalSourceService,
  ) {}

  @ApiOperation({ summary: "Get product catalog", description: "Returns all products enabled for internal source ordering. Also updates `lastCatalogSyncAt` on the connection." })
  @ApiResponse({ status: 200, description: "Product list" })
  @ApiResponse({ status: 401, description: "Missing or invalid X-Source-Api-Key" })
  @Get("catalog")
  async getCatalog(@Req() req: Request) {
    const { connection } = req.internalSourceContext!;

    await this.prisma.downstreamSourceConnection.update({
      where: { id: connection.id },
      data: { lastCatalogSyncAt: new Date() },
    });

    const products = await this.prisma.sourceProduct.findMany({
      where: {
        shopId: connection.upstreamShopId,
        internalSourceEnabled: true,
        OR: [
          { available: null },
          { available: { gt: 0 } },
        ],
      },
      orderBy: { createdAt: "asc" },
    });

    return {
      success: true,
      products: products.map((p) => ({
        id: p.id,
        name: p.sourceName,
        nameRaw: p.sourceRawName || null,
        description: p.sourceDescription || null,
        price: decimalToNumber(p.internalSourcePrice ?? p.sourcePrice),
        available: p.available,
        productFamily: p.productFamily?.toLowerCase() ?? null,
        productFamilyOther: p.productFamilyOther ?? null,
        accountType: p.accountType?.toLowerCase() ?? null,
        accountTypeOther: p.accountTypeOther ?? null,
        durationType: p.durationType?.toLowerCase() ?? null,
        durationTypeOther: p.durationTypeOther ?? null,
        deliveryMode: p.sourceDeliveryMode?.toLowerCase() ?? null,
        warrantyPolicy: p.warrantyPolicy?.toLowerCase() ?? null,
      })),
    };
  }

  @ApiOperation({ summary: "Get connection balance", description: "Returns the current wallet balance for this downstream connection." })
  @ApiResponse({ status: 200, description: "Balance info" })
  @ApiResponse({ status: 401, description: "Missing or invalid X-Source-Api-Key" })
  @Get("balance")
  async getBalance(@Req() req: Request) {
    const { connection } = req.internalSourceContext!;
    let balance = 0;
    if (connection.downstreamTelegramChatId) {
      const wallet = await this.prisma.customerWallet.findFirst({
        where: {
          customer: {
            shopId: connection.upstreamShopId,
            telegramChatId: connection.downstreamTelegramChatId,
          },
        },
        select: { balance: true },
      });
      if (wallet) balance = decimalToNumber(wallet.balance);
    }
    return {
      success: true,
      connectionId: connection.id,
      balance,
      currency: connection.currency,
      updatedAt: connection.updatedAt,
    };
  }

  @ApiOperation({ summary: "Create a source order", description: "Deducts balance from the connection and fulfills the order. Returns the fulfilled account credentials." })
  @ApiBody({ type: CreateInternalSourceOrderDto })
  @ApiResponse({ status: 201, description: "Order created and fulfilled" })
  @ApiResponse({ status: 400, description: "Insufficient balance, invalid quantity, or product unavailable" })
  @ApiResponse({ status: 401, description: "Missing or invalid X-Source-Api-Key" })
  @ApiResponse({ status: 404, description: "Product not found or not enabled for internal source" })
  @Post("orders")
  async createOrder(
    @Req() req: Request,
    @Body() dto: CreateInternalSourceOrderDto,
  ) {
    const { apiKey, connection } = req.internalSourceContext!;

    const product = await this.prisma.sourceProduct.findFirst({
      where: {
        id: dto.productId,
        shopId: connection.upstreamShopId,
        internalSourceEnabled: true,
      },
    });

    if (!product) {
      throw new NotFoundException("Source product not found or not available.");
    }

    const quantity = Number(dto.quantity);
    const unitPrice = decimalToNumber(product.internalSourcePrice ?? product.sourcePrice);
    const totalAmount = unitPrice * quantity;

    let orderId: string;

    try {
      const order = await this.prisma.$transaction(async (tx) => {
        if (!connection.downstreamTelegramChatId) {
          throw new BadRequestException("Connection has no linked customer wallet.");
        }

        const customer = await tx.customer.findFirst({
          where: { shopId: connection.upstreamShopId, telegramChatId: connection.downstreamTelegramChatId },
          include: { wallet: true },
        });

        if (!customer?.wallet) {
          throw new BadRequestException("Customer wallet not found.");
        }

        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM customer_wallets WHERE id = ${customer.wallet.id} FOR UPDATE`,
        );

        const currentConnection = await tx.downstreamSourceConnection.findUnique({
          where: { id: connection.id },
          select: { id: true, status: true },
        });

        if (!currentConnection) {
          throw new NotFoundException("Internal source connection not found.");
        }

        if (currentConnection.status !== DownstreamSourceConnectionStatus.ACTIVE) {
          throw new BadRequestException("Downstream connection is not active.");
        }

        const balanceBefore = decimalToNumber(customer.wallet.balance);
        const commissionBefore = decimalToNumber(customer.wallet.commissionBalance);

        if (balanceBefore + commissionBefore < totalAmount) {
          throw new BadRequestException(
            `Insufficient source balance. Required: ${totalAmount}, available: ${balanceBefore + commissionBefore}.`,
          );
        }

        const split = splitWalletDebit(commissionBefore, balanceBefore, totalAmount);
        const balanceAfter = split.balanceAfter;
        const commissionAfter = split.commissionAfter;
        const sourceOrderCode = generateSourceOrderCode();

        const created = await tx.internalSourceOrder.create({
          data: {
            connectionId: connection.id,
            apiKeyId: apiKey.id,
            upstreamSellerId: connection.upstreamSellerId,
            upstreamShopId: connection.upstreamShopId,
            downstreamSellerId: connection.downstreamSellerId,
            downstreamShopId: connection.downstreamShopId,
            sourceProductId: product.id,
            sourceOrderCode,
            downstreamOrderCode: dto.clientOrderCode || null,
            quantity,
            unitPrice: toDecimal(unitPrice),
            sourcePriceSnapshot: product.sourcePrice,
            totalAmount: toDecimal(totalAmount),
            status: InternalSourceOrderStatus.PENDING,
            metadataJson: {
              customerEmail: dto.customerEmail || null,
            } as Prisma.InputJsonValue,
          },
        });

        await tx.customerWallet.update({
          where: { id: customer.wallet.id },
          data: { balance: toDecimal(balanceAfter), commissionBalance: toDecimal(commissionAfter) },
        });

        await tx.customerWalletLedger.create({
          data: {
            customerId: customer.id,
            walletId: customer.wallet.id,
            type: "SPEND_ORDER",
            amount: toDecimal(totalAmount * -1),
            balanceBefore: toDecimal(balanceBefore),
            balanceAfter: toDecimal(balanceAfter),
            commissionBalanceBefore: toDecimal(commissionBefore),
            commissionBalanceAfter: toDecimal(commissionAfter),
            referenceType: "internal_source_order",
            referenceId: created.id,
            note: "Trừ số dư ví khi đặt hàng qua bot nguồn",
          },
        });

        await tx.downstreamSourceConnection.update({
          where: { id: connection.id },
          data: { lastOrderedAt: new Date() },
        });

        await tx.internalSourceLedger.create({
          data: {
            connectionId: connection.id,
            type: InternalSourceLedgerType.DEBIT_ORDER,
            amount: toDecimal(totalAmount * -1),
            balanceBefore: toDecimal(balanceBefore),
            balanceAfter: toDecimal(balanceAfter),
            referenceType: "internal_source_order",
            referenceId: created.id,
            note: "Debit downstream source balance for internal PRO order",
          },
        });

        await tx.internalSourceOrderEvent.create({
          data: {
            orderId: created.id,
            eventType: "order_created",
            payloadJson: {
              productId: product.id,
              quantity,
              totalAmount,
              clientOrderCode: dto.clientOrderCode || null,
            } as Prisma.InputJsonValue,
          },
        });

        return created;
      });

      orderId = order.id;
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new BadRequestException("Could not create source order.");
    }

    const result = await this.internalSourceService.fulfillInternalSourceOrder(orderId);
    return result.rawResponse;
  }

  @ApiOperation({ summary: "Get order by code", description: "Retrieve status and delivery details of a source order using its order code." })
  @ApiParam({ name: "code", description: "Source order code returned from POST /orders", example: "SRC-20260427-ABCD" })
  @ApiResponse({ status: 200, description: "Order details" })
  @ApiResponse({ status: 401, description: "Missing or invalid X-Source-Api-Key" })
  @ApiResponse({ status: 404, description: "Order not found or does not belong to this connection" })
  @Get("orders/:code")
  async getOrderByCode(@Req() req: Request, @Param("code") code: string) {
    const { connection } = req.internalSourceContext!;

    const order = await this.prisma.internalSourceOrder.findFirst({
      where: {
        sourceOrderCode: code,
        connectionId: connection.id,
      },
    });

    if (!order) {
      throw new NotFoundException("Source order not found.");
    }

    return {
      success: true,
      order: {
        id: order.id,
        orderCode: order.sourceOrderCode,
        downstreamOrderCode: order.downstreamOrderCode,
        status: order.status.toLowerCase(),
        quantity: order.quantity,
        unitPrice: decimalToNumber(order.unitPrice),
        totalAmount: decimalToNumber(order.totalAmount),
        deliveredText: order.deliveredAccountText,
        failureReason: order.failureReason,
        createdAt: order.createdAt,
        deliveredAt: order.deliveredAt,
      },
    };
  }
}
