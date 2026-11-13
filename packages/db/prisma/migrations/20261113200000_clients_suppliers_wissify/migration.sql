-- Clientes y Proveedores con ficha y campos para Wissify (additive; nothing is moved or deleted).
CREATE TABLE "clients" (
    "id" UUID NOT NULL,
    "office_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT,
    "legal_name" TEXT,
    "tax_id" TEXT,
    "levels" TEXT,
    "website" TEXT,
    "address" TEXT,
    "postal_code" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "wissify_id" TEXT,
    "wissify_synced_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "clients_office_id_key_key" ON "clients"("office_id", "key");
ALTER TABLE "clients" ADD CONSTRAINT "clients_office_id_fkey" FOREIGN KEY ("office_id") REFERENCES "offices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "suppliers" ADD COLUMN "legal_name" TEXT,
ADD COLUMN "tax_id" TEXT,
ADD COLUMN "website" TEXT,
ADD COLUMN "wissify_id" TEXT,
ADD COLUMN "wissify_synced_at" TIMESTAMPTZ(3);

CREATE TABLE "supplier_contacts" (
    "id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "supplier_contacts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "supplier_contacts_supplier_id_idx" ON "supplier_contacts"("supplier_id");
ALTER TABLE "supplier_contacts" ADD CONSTRAINT "supplier_contacts_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
