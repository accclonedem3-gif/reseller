import {
  inferWarrantyPolicy,
  inferDeliveryMode,
  calculateWarrantyExpiry,
} from "@reseller/shared/server";
import { prisma } from "./infra/prisma";

export async function snapshotWarrantyForDeliveredOrder(
  orderId: string,
  tx: any = prisma,
) {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: {
      sourceProduct: true,
    },
  });
  if (!order?.deliveredAt || order.status !== "DELIVERED") {
    return null;
  }
  if (order.warrantyStartedAt && order.warrantyDeliveryModeSnapshot) {
    return {
      warrantyPolicySnapshot: order.warrantyPolicySnapshot,
      warrantyDeliveryModeSnapshot: order.warrantyDeliveryModeSnapshot,
      warrantyStartedAt: order.warrantyStartedAt,
      warrantyExpiresAt: order.warrantyExpiresAt,
    };
  }
  const sourceMetadata =
    order.sourceProduct?.metadataJson &&
    typeof order.sourceProduct.metadataJson === "object" &&
    !Array.isArray(order.sourceProduct.metadataJson)
      ? order.sourceProduct.metadataJson
      : {};
  const warrantyPolicySnapshot = inferWarrantyPolicy({
    productName: order.productNameSnapshot,
    sourceDescription: order.sourceProduct?.sourceDescription,
    warrantyPolicy: order.sourceProduct?.warrantyPolicy,
    sourceDeliveryMode: order.sourceProduct?.sourceDeliveryMode,
    providerName: order.sourceProduct?.providerName,
    metadata: sourceMetadata,
  });
  const warrantyDeliveryModeSnapshot = inferDeliveryMode({
    productName: order.productNameSnapshot,
    sourceDescription: order.sourceProduct?.sourceDescription,
    warrantyPolicy: order.sourceProduct?.warrantyPolicy,
    sourceDeliveryMode: order.sourceProduct?.sourceDeliveryMode,
    providerName: order.sourceProduct?.providerName,
    metadata: sourceMetadata,
  });
  const warrantyExpiresAt = calculateWarrantyExpiry(
    warrantyPolicySnapshot,
    order.deliveredAt,
  );
  await tx.order.update({
    where: { id: order.id },
    data: {
      warrantyPolicySnapshot: warrantyPolicySnapshot || null,
      warrantyDeliveryModeSnapshot: warrantyDeliveryModeSnapshot || null,
      warrantyStartedAt: order.deliveredAt,
      warrantyExpiresAt,
    },
  });
  return {
    warrantyPolicySnapshot,
    warrantyDeliveryModeSnapshot,
    warrantyStartedAt: order.deliveredAt,
    warrantyExpiresAt,
  };
}
