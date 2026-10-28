-- Offices listed at estudiantesembajadores.com/oficinas (Will, 2026-10-28). "Nuevo León" is the
-- existing CORP office (Corporativo Nuevo León), so it is not added again. Re-runnable: codes or
-- names that already exist are skipped. Each insert is audited like POST /offices.
WITH data(code, name) AS (
  VALUES
    ('AGS', 'Aguascalientes'),
    ('CUN', 'Cancún'),
    ('CDMX-SJ', 'CDMX San Jerónimo'),
    ('CDMX-INT', 'CDMX Poniente Interlomas'),
    ('CDMX-COY', 'CDMX Sur Coyoacán'),
    ('CEL', 'Celaya'),
    ('CUU', 'Chihuahua'),
    ('COA', 'Coatzacoalcos'),
    ('CVA', 'Cuernavaca'),
    ('DGO', 'Durango'),
    ('GDL', 'Guadalajara'),
    ('HMO', 'Hermosillo'),
    ('LEON', 'León'),
    ('MID', 'Mérida'),
    ('MVA', 'Monclova'),
    ('MLM', 'Morelia'),
    ('PN', 'Piedras Negras'),
    ('PUE', 'Puebla'),
    ('QRO', 'Querétaro'),
    ('TPQ', 'Tepic'),
    ('TRC', 'Torreón'),
    ('VER', 'Veracruz'),
    ('ZAC', 'Zacatecas')
),
inserted AS (
  INSERT INTO "offices" ("id", "code", "name", "updated_at")
  SELECT gen_random_uuid(), d.code, d.name, now()
  FROM data d
  WHERE NOT EXISTS (SELECT 1 FROM "offices" o WHERE o.code = d.code OR lower(o.name) = lower(d.name))
  ON CONFLICT ("code") DO NOTHING
  RETURNING "id", "code", "name"
)
INSERT INTO "audit_logs" ("id", "actor_user_id", "action", "entity_type", "entity_id", "correlation_id", "diff")
SELECT gen_random_uuid(), NULL, 'office.created', 'Office', i.id, 'migration-20261028030000',
       jsonb_build_object('code', i.code, 'name', i.name)
FROM inserted i;
