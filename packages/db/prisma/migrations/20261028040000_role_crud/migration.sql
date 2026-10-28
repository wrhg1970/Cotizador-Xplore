-- AlterTable
ALTER TABLE "role_policies" ADD COLUMN     "can_create" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "can_delete" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "can_edit" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "can_view" BOOLEAN NOT NULL DEFAULT true;


-- Ver/Crear/Editar/Borrar per role (V2 criteria). Values reproduce the rules in force before:
-- advisors and coordinators create; requester, quoter and coordinator edit; only coordinators cancel.
UPDATE "role_policies" SET "can_create" = true WHERE "role" IN ('ADVISOR', 'OFFICE_ADMIN');
UPDATE "role_policies" SET "can_edit" = true WHERE "role" IN ('ADVISOR', 'QUOTER', 'OFFICE_ADMIN');
UPDATE "role_policies" SET "can_delete" = true WHERE "role" = 'OFFICE_ADMIN';
