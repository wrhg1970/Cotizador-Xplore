-- Block 10: supplier / DMC catalog and rates (additive).
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT,
    "country" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "suppliers_name_key" ON "suppliers"("name");

CREATE TABLE "supplier_rates" (
    "id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "category" "LineCategory" NOT NULL,
    "unit_cost" DECIMAL(18,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "valid_until" DATE,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "supplier_rates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "supplier_rates_unit_cost_check" CHECK ("unit_cost" >= 0)
);
CREATE INDEX "supplier_rates_supplier_id_idx" ON "supplier_rates"("supplier_id");
ALTER TABLE "supplier_rates" ADD CONSTRAINT "supplier_rates_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
