-- School contacts for the "ficha por colegio"; requests link to a school by their client name.
CREATE TABLE "school_contacts" (
    "id" UUID NOT NULL,
    "office_id" UUID NOT NULL,
    "school_key" TEXT NOT NULL,
    "school_name" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "school_contacts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "school_contacts_office_id_school_key_idx" ON "school_contacts"("office_id", "school_key");

ALTER TABLE "school_contacts" ADD CONSTRAINT "school_contacts_office_id_fkey" FOREIGN KEY ("office_id") REFERENCES "offices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "school_contacts" ADD CONSTRAINT "school_contacts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
