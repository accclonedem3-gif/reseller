-- Rename SellerTier enum values: PLUS→PRO, PRO→ULTRA
-- Must rename in two steps to avoid collision (PRO already existed)
ALTER TYPE "SellerTier" RENAME VALUE 'PRO' TO 'ULTRA';
ALTER TYPE "SellerTier" RENAME VALUE 'PLUS' TO 'PRO';

-- Update default value on Seller.tier column
ALTER TABLE "sellers" ALTER COLUMN "tier" SET DEFAULT 'PRO';
