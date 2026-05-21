-- AlterEnum: SourceProductFamily — add new families
ALTER TYPE "SourceProductFamily" ADD VALUE 'GROK';
ALTER TYPE "SourceProductFamily" ADD VALUE 'KLING';
ALTER TYPE "SourceProductFamily" ADD VALUE 'ADOBE';
ALTER TYPE "SourceProductFamily" ADD VALUE 'SUNO';
ALTER TYPE "SourceProductFamily" ADD VALUE 'HEYGEN';
ALTER TYPE "SourceProductFamily" ADD VALUE 'PERPLEXITY';

-- AlterEnum: SourceWarrantyPolicy — add BHF, BH3M
ALTER TYPE "SourceWarrantyPolicy" ADD VALUE 'BH3M';
ALTER TYPE "SourceWarrantyPolicy" ADD VALUE 'BHF';

-- AlterTable
ALTER TABLE "source_products" ADD COLUMN "product_package" TEXT;
