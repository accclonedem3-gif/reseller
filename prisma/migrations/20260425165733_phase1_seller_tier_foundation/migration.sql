-- CreateEnum
CREATE TYPE "SellerTier" AS ENUM ('FREE', 'PLUS', 'PRO');

-- AlterTable
ALTER TABLE "sellers" ADD COLUMN     "tier" "SellerTier" NOT NULL DEFAULT 'PLUS';
