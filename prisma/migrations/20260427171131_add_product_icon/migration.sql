-- AlterTable
ALTER TABLE "source_products" ADD COLUMN     "product_icon" TEXT;

-- RenameIndex
ALTER INDEX "downstream_source_connections_downstream_seller_id_status_creat" RENAME TO "downstream_source_connections_downstream_seller_id_status_c_idx";

-- RenameIndex
ALTER INDEX "downstream_source_connections_upstream_seller_id_status_created" RENAME TO "downstream_source_connections_upstream_seller_id_status_cre_idx";

-- RenameIndex
ALTER INDEX "downstream_source_connections_upstream_shop_id_downstream_shop_" RENAME TO "downstream_source_connections_upstream_shop_id_downstream_s_key";
