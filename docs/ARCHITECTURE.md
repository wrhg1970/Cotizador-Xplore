# Arquitectura técnica

## Principios
- Modular monolith inicial, API REST versionada; evitar microservicios prematuros.
- Separar dominio, persistencia, presentación e integraciones.
- Motor de cotización como paquete puro: entradas explícitas → resultados reproducibles.
- PostgreSQL como fuente de verdad.
- Procesos asíncronos para generación de documentos, webhooks y sincronización.
- Integraciones opcionales para que un fallo externo no detenga la operación.

## Monorepo
```text
apps/web                 Next.js UI
apps/api                 NestJS REST API
apps/worker              jobs asíncronos
packages/db              Prisma schema, migrations, seed
packages/contracts       DTOs, schemas, OpenAPI types
packages/quote-engine    reglas, decimal math, cálculos
packages/documents       PDF/XLSX templates
packages/integrations    interfaces + adaptadores
packages/ui              componentes accesibles
infra                    Docker, CI/CD, observabilidad
docs                     PRD y documentación
```

## Módulos de dominio
1. Identity & Access
2. Offices & Catalogs
3. Travel Requests
4. Quote Scenarios & Versions
5. Formula Rules
6. Approval Workflow
7. Documents & Delivery
8. Follow-up / Outcome
9. Audit Log
10. Integrations & Sync Jobs
11. Reporting

## Capas
- Controller: HTTP, autenticación, DTO, status codes.
- Application: casos de uso y transacciones.
- Domain: reglas de negocio, estados y motor de cálculo.
- Infrastructure: Prisma, almacenamiento, proveedores externos, correo.
- Worker: generación de PDF/XLSX, webhook processing, retries.

## Concurrencia e idempotencia
- Actualización optimista con `version` o `updatedAt`.
- Transacciones para aprobar/enviar y aceptar propuesta.
- `Idempotency-Key` en operaciones de integración/reintento.
- Restricción única parcial o transacción serializable para una propuesta ganadora por solicitud.
- Outbox pattern para publicar eventos tras commit.

## Eventos internos
`request.submitted`, `request.assigned`, `quote.version.created`, `quote.submitted_for_approval`, `quote.approved`, `quote.rejected_for_changes`, `quote.sent`, `quote.accepted`, `quote.rejected`, `document.generated`, `integration.sync_requested`, `integration.sync_failed`.

## Observabilidad
Logs JSON sin datos sensibles; métricas de latencia/errores, jobs pendientes, intentos de integración y auditoría. IDs de correlación en peticiones y sincronizaciones.

## Entornos
Local, test, staging y producción separados. Datos y secretos separados. Migraciones ejecutadas por pipeline controlado. Feature flags para integraciones.
