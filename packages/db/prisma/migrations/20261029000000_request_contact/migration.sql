-- Nueva solicitud en 3 pasos: contacto de la escuela y notas comerciales. Additive; no data touched.
ALTER TABLE "travel_requests" ADD COLUMN "contact_name" TEXT;
ALTER TABLE "travel_requests" ADD COLUMN "contact_email" TEXT;
ALTER TABLE "travel_requests" ADD COLUMN "commercial_notes" TEXT;
