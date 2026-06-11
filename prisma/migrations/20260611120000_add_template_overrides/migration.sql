-- PRO per-connection overrides on top of an inherited ULTRA template:
-- { groups: { [ultraGroupId]: { name?, position?, hidden? } }, products: { [proProductId]: { position? } } }
ALTER TABLE "downstream_source_connections" ADD COLUMN "template_overrides_json" JSONB;
