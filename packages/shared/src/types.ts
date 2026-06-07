import { z } from "zod";

export const userRoleSchema = z.enum(["super_admin", "seller"]);
export type UserRole = z.infer<typeof userRoleSchema>;

export const sellerTierSchema = z.enum(["free", "pro", "ultra"]);
export type SellerTier = z.infer<typeof sellerTierSchema>;

export const sellerCapabilitySchema = z.enum([
  "shop_manage",
  "bot_manage",
  "products_manage",
  "orders_manage",
  "wallet_manage",
  "broadcast_manage",
  "source_external_use",
  "source_internal_use",
  "source_internal_manage",
  "source_key_manage",
  "warranty_manage",
]);
export type SellerCapability = z.infer<typeof sellerCapabilitySchema>;

export const orderStatusSchema = z.enum([
  "awaiting_payment",
  "paid",
  "processing_purchase",
  "delivered",
  "failed",
  "paid_waiting_stock",
  "refunded",
]);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

export const paymentStatusSchema = z.enum([
  "unpaid",
  "pending",
  "paid",
  "failed",
  "refunded",
]);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

export const walletLedgerTypeSchema = z.enum([
  "topup",
  "debit_purchase",
  "refund_purchase",
  "withdraw",
  "adjust",
  "withdraw_reject_refund",
  "sale_revenue",
  "affiliate_level_1",
  "affiliate_level_2",
  "affiliate_clawback",
  "subscription_payment",
]);
export type WalletLedgerType = z.infer<typeof walletLedgerTypeSchema>;

export const connectionStatusSchema = z.enum([
  "pending",
  "verified",
  "failed",
  "disabled",
]);
export type ConnectionStatus = z.infer<typeof connectionStatusSchema>;

export const webhookStatusSchema = z.enum([
  "disabled",
  "pending",
  "active",
  "failed",
  "polling",
]);
export type WebhookStatus = z.infer<typeof webhookStatusSchema>;

export const productViewSchema = z.object({
  id: z.string(),
  sourceProductId: z.string(),
  sourceName: z.string(),
  displayName: z.string(),
  description: z.string().nullable(),
  sourcePrice: z.number(),
  salePrice: z.number(),
  available: z.number().nullable(),
  soldCount: z.number(),
  totalCount: z.number(),
  enabled: z.boolean(),
  hidden: z.boolean(),
  promoText: z.string().nullable(),
  internalSourceEnabled: z.boolean().optional(),
  internalSourcePrice: z.number().nullable().optional(),
  productFamily: z.string().nullable().optional(),
  productFamilyOther: z.string().nullable().optional(),
  accountType: z.string().nullable().optional(),
  accountTypeOther: z.string().nullable().optional(),
  durationType: z.string().nullable().optional(),
  durationTypeOther: z.string().nullable().optional(),
  sourceDeliveryMode: z.string().nullable().optional(),
  warrantyPolicy: z.string().nullable().optional(),
  syncedAt: z.string().nullable(),
});
export type ProductView = z.infer<typeof productViewSchema>;

export const revenuePointSchema = z.object({
  label: z.string(),
  grossRevenue: z.number(),
  estimatedProfit: z.number(),
  deliveredOrders: z.number(),
});
export type RevenuePoint = z.infer<typeof revenuePointSchema>;

export const topBuyerSchema = z.object({
  customerId: z.string(),
  name: z.string(),
  telegramUsername: z.string().nullable(),
  totalOrders: z.number(),
  totalSpent: z.number(),
});
export type TopBuyer = z.infer<typeof topBuyerSchema>;

export const authResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: z.object({
    id: z.string(),
    email: z.string().email(),
    role: userRoleSchema,
    displayName: z.string().nullable(),
    recoveryEmail: z.string().email().nullable(),
    sellerId: z.string().nullable(),
    sellerTier: sellerTierSchema.nullable(),
    sellerStatus: z.string().nullable(),
    sellerCapabilities: z.array(sellerCapabilitySchema),
    sellerReadOnly: z.boolean(),
  }),
});
export type AuthResponse = z.infer<typeof authResponseSchema>;
