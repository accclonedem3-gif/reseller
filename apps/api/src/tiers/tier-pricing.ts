import { SellerTier, TierPlan } from "@prisma/client";

export type PlanKey = "monthly" | "quarterly" | "semi_annual" | "annual";
export type TierKey = "pro" | "ultra";

export const TIER_PRICES: Record<TierKey, Record<PlanKey, number>> = {
  pro: {
    monthly: 199_000,
    quarterly: 540_000,
    semi_annual: 1_019_000,
    annual: 1_819_000,
  },
  ultra: {
    monthly: 299_000,
    quarterly: 830_000,
    semi_annual: 1_569_000,
    annual: 2_819_000,
  },
};

export const PLAN_DURATION_DAYS: Record<PlanKey, number> = {
  monthly: 30,
  quarterly: 90,
  semi_annual: 180,
  annual: 365,
};

export const PLAN_LABELS: Record<PlanKey, string> = {
  monthly: "1 tháng",
  quarterly: "3 tháng",
  semi_annual: "6 tháng",
  annual: "12 tháng",
};

export const TIER_LABELS: Record<TierKey, string> = {
  pro: "PRO",
  ultra: "ULTRA",
};

// Affiliate rate by level + tier
export const LEVEL_1_RATES = {
  TIER_1: 0.10, // Bậc 1 (default)
  TIER_2: 0.15, // Bậc 2 (unlock 10M, maintain 1M/90d)
  TIER_3: 0.20, // Bậc 3 (unlock 30M, maintain 3M/90d)
} as const;

export const LEVEL_2_RATE = 0.02; // Flat 2% for downline

// Tier unlock thresholds (all-time cumulative commission)
export const TIER_UNLOCK_THRESHOLDS = {
  TIER_2: 10_000_000, // 10tr
  TIER_3: 30_000_000, // 30tr
} as const;

// Tier maintenance thresholds (last 90 days commission)
export const TIER_MAINTAIN_THRESHOLDS = {
  TIER_2: 1_000_000, // 1tr in 90d
  TIER_3: 3_000_000, // 3tr in 90d
} as const;

export const REFUND_CLAWBACK_DAYS = 7;
export const PAYMENT_EXPIRY_MINUTES = 30;

export function planKeyToEnum(plan: PlanKey): TierPlan {
  if (plan === "monthly") return TierPlan.MONTHLY;
  if (plan === "quarterly") return TierPlan.QUARTERLY;
  if (plan === "semi_annual") return TierPlan.SEMI_ANNUAL;
  return TierPlan.ANNUAL;
}

export function planEnumToKey(plan: TierPlan): PlanKey {
  if (plan === TierPlan.MONTHLY) return "monthly";
  if (plan === TierPlan.QUARTERLY) return "quarterly";
  if (plan === TierPlan.SEMI_ANNUAL) return "semi_annual";
  return "annual";
}

export function tierKeyToEnum(tier: TierKey): SellerTier {
  return tier === "pro" ? SellerTier.PRO : SellerTier.ULTRA;
}

export function tierEnumToKey(tier: SellerTier): TierKey | null {
  if (tier === SellerTier.PRO) return "pro";
  if (tier === SellerTier.ULTRA) return "ultra";
  return null;
}

export function getPrice(tier: TierKey, plan: PlanKey): number {
  return TIER_PRICES[tier][plan];
}

export function getDurationMs(plan: PlanKey): number {
  return PLAN_DURATION_DAYS[plan] * 24 * 60 * 60 * 1000;
}

/**
 * Determine effective Level 1 commission rate based on affiliate's tier and activity.
 * - unlockedTier: highest tier ever unlocked (1, 2, 3)
 * - activity90dVnd: total commission received in last 90 days (VND)
 */
export function calcLevel1Rate(unlockedTier: number, activity90dVnd: number): number {
  if (unlockedTier >= 3 && activity90dVnd >= TIER_MAINTAIN_THRESHOLDS.TIER_3) {
    return LEVEL_1_RATES.TIER_3;
  }
  if (unlockedTier >= 2 && activity90dVnd >= TIER_MAINTAIN_THRESHOLDS.TIER_2) {
    return LEVEL_1_RATES.TIER_2;
  }
  return LEVEL_1_RATES.TIER_1;
}

/**
 * Determine which tiers should be unlocked given new all-time cumulative.
 * Returns the highest tier reached (1, 2, or 3).
 */
export function tierFromCumulative(allTimeCumulativeVnd: number): number {
  if (allTimeCumulativeVnd >= TIER_UNLOCK_THRESHOLDS.TIER_3) return 3;
  if (allTimeCumulativeVnd >= TIER_UNLOCK_THRESHOLDS.TIER_2) return 2;
  return 1;
}
