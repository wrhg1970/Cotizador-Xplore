-- "Ver como": a system admin's session can show the app as another user (read only). Additive.
ALTER TABLE "sessions" ADD COLUMN "view_as_user_id" UUID;
