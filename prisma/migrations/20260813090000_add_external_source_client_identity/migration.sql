ALTER TABLE "downstream_source_connections"
ADD COLUMN "client_name" TEXT,
ADD COLUMN "client_bot_username" TEXT,
ADD COLUMN "client_connected_at" TIMESTAMP(3);
