-- Admin-managed product families (replaces the hardcoded SourceProductFamily enum).
-- The SourceProductFamily enum type is intentionally KEPT (still declared in schema)
-- so existing code that imports it keeps compiling; only the column moves to TEXT.

-- 1. Catalog table
CREATE TABLE "product_families" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "emoji" TEXT,
    "custom_emoji_id" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_builtin" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "product_families_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "product_families_key_key" ON "product_families"("key");

-- 2. Move SourceProduct.product_family from enum -> TEXT (preserve existing values)
ALTER TABLE "source_products"
  ALTER COLUMN "product_family" TYPE TEXT USING "product_family"::TEXT;

-- 3. Seed the built-in families (key matches the old enum values, so existing rows stay valid)
INSERT INTO "product_families" ("id","key","label","sort_order","is_active","is_builtin","updated_at") VALUES
  (gen_random_uuid(), 'CHATGPT',    'ChatGPT',     1,  true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'CLAUDE',     'Claude',      2,  true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'GEMINI',     'Gemini',      3,  true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'GROK',       'Grok',        4,  true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'PERPLEXITY', 'Perplexity',  5,  true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'VEO3',       'Veo 3',       6,  true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'KLING',      'Kling AI',    7,  true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'HIGGSFIELD', 'Higgsfield',  8,  true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'CANVA',      'Canva',       9,  true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'CAPCUT',     'CapCut',      10, true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'ADOBE',      'Adobe',       11, true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'SUNO',       'Suno',        12, true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'ELEVENLABS', 'ElevenLabs',  13, true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'HEYGEN',     'HeyGen',      14, true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'GMAIL',      'Gmail',       15, true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'YOUTUBE',    'YouTube',     16, true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'TIKTOK',     'TikTok',      17, true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'ZOOM',       'Zoom',        18, true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'DUOLINGO',   'Duolingo',    19, true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'HMA',        'HMA',         20, true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'VPN',        'VPN',         21, true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'OTHER',      'Khác',        99, true, true, CURRENT_TIMESTAMP);
