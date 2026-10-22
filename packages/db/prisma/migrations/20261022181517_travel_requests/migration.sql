-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'QUOTING', 'SENT', 'WON', 'LOST', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BudgetBasis" AS ENUM ('TOTAL', 'PER_PARTICIPANT');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'NORMAL', 'HIGH');

-- CreateTable
CREATE TABLE "travel_requests" (
    "id" UUID NOT NULL,
    "folio" TEXT NOT NULL,
    "office_id" UUID NOT NULL,
    "requester_id" UUID NOT NULL,
    "assignee_id" UUID,
    "status" "RequestStatus" NOT NULL DEFAULT 'DRAFT',
    "group_name" TEXT NOT NULL,
    "client_name" TEXT,
    "program" TEXT,
    "city" TEXT NOT NULL,
    "country_code" CHAR(2) NOT NULL,
    "departure_date" DATE NOT NULL,
    "return_date" DATE NOT NULL,
    "participants" INTEGER NOT NULL,
    "chaperones" INTEGER NOT NULL DEFAULT 0,
    "staff" INTEGER NOT NULL DEFAULT 0,
    "budget_amount" DECIMAL(18,4),
    "budget_currency" CHAR(3),
    "budget_basis" "BudgetBasis",
    "requirements" TEXT,
    "priority" "Priority" NOT NULL DEFAULT 'NORMAL',
    "due_date" DATE,
    "cancel_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "travel_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_comments" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "travel_requests_folio_key" ON "travel_requests"("folio");

-- CreateIndex
CREATE INDEX "travel_requests_office_id_status_created_at_idx" ON "travel_requests"("office_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "travel_requests_assignee_id_status_idx" ON "travel_requests"("assignee_id", "status");

-- CreateIndex
CREATE INDEX "travel_requests_requester_id_idx" ON "travel_requests"("requester_id");

-- CreateIndex
CREATE INDEX "request_comments_request_id_created_at_idx" ON "request_comments"("request_id", "created_at");

-- AddForeignKey
ALTER TABLE "travel_requests" ADD CONSTRAINT "travel_requests_office_id_fkey" FOREIGN KEY ("office_id") REFERENCES "offices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_requests" ADD CONSTRAINT "travel_requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_requests" ADD CONSTRAINT "travel_requests_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_comments" ADD CONSTRAINT "request_comments_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "travel_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_comments" ADD CONSTRAINT "request_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Business invariants also enforced in the database (DATABASE.md: checks for quantities/prices).
ALTER TABLE "travel_requests"
  ADD CONSTRAINT "travel_requests_dates_chk" CHECK ("return_date" >= "departure_date"),
  ADD CONSTRAINT "travel_requests_participants_chk" CHECK ("participants" >= 1),
  ADD CONSTRAINT "travel_requests_companions_chk" CHECK ("chaperones" >= 0 AND "staff" >= 0),
  ADD CONSTRAINT "travel_requests_budget_chk" CHECK (
    ("budget_amount" IS NULL AND "budget_currency" IS NULL AND "budget_basis" IS NULL)
    OR ("budget_amount" IS NOT NULL AND "budget_amount" >= 0 AND "budget_currency" IS NOT NULL AND "budget_basis" IS NOT NULL)
  ),
  ADD CONSTRAINT "travel_requests_cancel_chk" CHECK ("status" <> 'CANCELLED' OR "cancel_reason" IS NOT NULL);
