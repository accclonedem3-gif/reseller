-- PRO opt-in: inherit the ULTRA source shop's categories, product layout + bot template.
ALTER TABLE "downstream_source_connections" ADD COLUMN "inherit_source_template" BOOLEAN NOT NULL DEFAULT false;
