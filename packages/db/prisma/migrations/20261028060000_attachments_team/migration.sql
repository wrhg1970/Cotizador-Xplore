-- CreateEnum
CREATE TYPE "MemberKind" AS ENUM ('COMMERCIAL', 'SUPPORT');

-- CreateTable
CREATE TABLE "request_attachments" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "content" BYTEA NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_members" (
    "request_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "MemberKind" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_members_pkey" PRIMARY KEY ("request_id","user_id")
);

-- CreateIndex
CREATE INDEX "request_attachments_request_id_created_at_idx" ON "request_attachments"("request_id", "created_at");

-- CreateIndex
CREATE INDEX "request_members_user_id_idx" ON "request_members"("user_id");

-- AddForeignKey
ALTER TABLE "request_attachments" ADD CONSTRAINT "request_attachments_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "travel_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_attachments" ADD CONSTRAINT "request_attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_members" ADD CONSTRAINT "request_members_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "travel_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_members" ADD CONSTRAINT "request_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- One commercial executive per request; files are bounded.
CREATE UNIQUE INDEX "request_members_one_commercial" ON "request_members"("request_id") WHERE "kind" = 'COMMERCIAL';
ALTER TABLE "request_attachments"
  ADD CONSTRAINT "request_attachments_size_chk" CHECK ("size" > 0 AND "size" <= 3145728 AND "size" = octet_length("content"));
