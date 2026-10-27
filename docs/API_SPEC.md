# API REST — especificación inicial

Base path: `/api/v1`. JSON UTF-8. OpenAPI debe ser fuente verificable de contratos. Todos los endpoints autenticados salvo callbacks/webhooks específicamente documentados.

## Convenciones
- IDs UUID; dinero como strings decimales en JSON.
- Paginación cursor o `page/limit` con límites.
- Errores: `{ "code": "VALIDATION_ERROR", "message": "...", "correlationId": "...", "details": [] }`; no filtrar stack traces.
- `Idempotency-Key` para operaciones repetibles que creen envíos/syncs.
- `If-Match` o `version` para evitar sobrescrituras.
- Filtrado por oficina aplicado en servidor.

## Endpoints propuestos
### Identidad / catálogos
- `GET /me`
- `GET /offices`
- `GET /catalogs/countries`
- `GET /catalogs/currencies`
- `GET /concept-templates` — catálogo de rubros de la hoja EE (activos; el administrador del sistema ve también los inactivos)
- `GET /offices/{officeId}/quote-templates` — plantillas de la oficina (lado cotizador)
- `POST /quotes/{quoteVersionId}/template` — guarda la versión como plantilla (cotizador o coordinador)
- `DELETE /quote-templates/{id}` — retira la plantilla (quien la creó o el coordinador)
- `POST /concept-templates`, `PATCH /concept-templates/{id}` — solo administrador del sistema, con auditoría
- `GET /users?officeId=...` (solo administradores autorizados)
- `GET /dashboard` — «Mi trabajo»: pendientes del usuario (`SUBMIT_REQUEST`, `ASSIGN`, `QUOTE`, `FIX_QUOTE`, `APPROVE`, `SEND`) y conteo de solicitudes por oficina y estado, dentro de su alcance (sin borradores ajenos)
- `GET /role-policies`, `PUT /role-policies/{role}` — permisos por rol (`allOffices`, `viewInternalCosts`, `exportInternalXlsx`, `approvalLimitMxn`); solo administrador del sistema, con auditoría. `SYSTEM_ADMIN` no es editable. `GET /me` incluye `policies`
- `POST /offices` — alta de oficina (administrador del sistema)
- `GET /audit-logs?officeId&action&actorEmail&entityId&from&to&page&limit` — bitácora de solo lectura; coordinador de oficina y auditor ven sus oficinas, administrador del sistema todo (incluye inicios de sesión y cambios globales). `action` filtra por prefijo (`quote.`), fechas `YYYY-MM-DD` inclusivas, `limit` ≤ 100

### Solicitudes
- `POST /requests`
- `GET /requests`
- `GET /requests/{requestId}`
- `PATCH /requests/{requestId}`
- `POST /requests/{requestId}/submit`
- `POST /requests/{requestId}/assign`
- `POST /requests/{requestId}/comments`
- `GET /requests/{requestId}/timeline`
- `POST /requests/{requestId}/attachments`

### Escenarios/versiones
- `POST /requests/{requestId}/scenarios`
- `POST /scenarios/{scenarioId}/duplicate`
- `GET /requests/{requestId}/scenarios`
- `POST /scenarios/{scenarioId}/versions`
- `GET /quotes/{quoteVersionId}`
- `PATCH /quotes/{quoteVersionId}` (solo borrador). Acepta `targetMarginRate` (% de comisión sobre el precio final) o `targetPricePerParticipant` (precio final entero; el servidor deriva el %), nunca ambos. Errores: `PRICE_BELOW_COST`, `PRICE_UNREACHABLE`, `FX_REQUIRED`. También acepta `paymentPlan` (inscripción en % o monto + 1 a 15 parcialidades mensuales/quincenales/semanales), `studentsPerFreePlace`/`freePlaceBenefit`, `itinerary` y `exclusions`; la respuesta trae `paymentSchedule` y `freePlaces` calculados. `POST /requests/{id}/scenarios` acepta `templateId`. La respuesta incluye `sheet` con los subtotales de la hoja EE (fuera del hash de aprobación).
- `POST /quotes/{quoteVersionId}/import` — lee una hoja de costos con Gemini (Vertex AI) y devuelve conceptos propuestos, % de comisión, itinerario y «no incluye» validados con las mismas reglas que una edición; **no guarda nada**. Cuerpo: `{fileName, fileBase64}` (.xlsx/.csv, 3 MB) o `{sheetUrl}` (Google Sheets público). Solo el cotizador asignado o el coordinador, con versión en borrador o devuelta. Errores: `SHEET_IMPORT` (400), 502 si la IA falla, 503 si no está configurado. Límite: 10 por minuto
- `GET /quotes/{quoteVersionId}/export.xlsx` — Excel interno; exige el permiso `exportInternalXlsx` del rol. Pestañas: «Cotización» (formato de la hoja oficial EE: conceptos por estudiante, SubTotal 1 y 2, comisión y precio final a la izquierda; gastos de chaperones y fondo de emergencia a la derecha), «Conceptos» (detalle de cada línea), «Plan de pagos» (con lugares liberados), «Itinerario» (con «No incluye»), «Tipos de cambio» y «Autorización y envío»
- `POST /quotes/{quoteVersionId}/calculate`
- `POST /quotes/{quoteVersionId}/submit-for-approval`
- `POST /quotes/{quoteVersionId}/approve`
- `POST /quotes/{quoteVersionId}/return`
- `POST /quotes/{quoteVersionId}/send`
- `POST /quotes/{quoteVersionId}/documents`
- `GET /quotes/{quoteVersionId}/documents`

### Resultado y reportes
- `POST /requests/{requestId}/outcome/accept`
- `POST /requests/{requestId}/outcome/reject`
- `POST /requests/{requestId}/outcome/expire`
- `GET /reports/pipeline`
- `GET /reports/conversion`
- `POST /exports`

### Integraciones
- `GET /integrations`
- `POST /integrations/{provider}/test`
- `POST /integrations/{provider}/sync`
- `GET /integrations/jobs/{jobId}`
- `POST /webhooks/{provider}` (validación de firma requerida)

## Contratos de referencia
### Crear solicitud
```json
{
  "groupName": "Verano Grupal UK 2027",
  "officeId": "uuid",
  "departureDate": "2027-07-01",
  "returnDate": "2027-07-21",
  "city": "Londres y Oxford",
  "countryCode": "GB",
  "participants": 20,
  "chaperones": 2,
  "staff": 0,
  "budget": { "amount": "5150.00", "currency": "GBP", "basis": "PER_PARTICIPANT" },
  "comments": "Sol Camps"
}
```

### Aprobar versión
```json
{
  "decision": "APPROVE",
  "comment": "Revisada conforme a política comercial",
  "expectedCalculationHash": "sha256:..."
}
```

### Enviar versión
```json
{
  "recipients": ["contact@example.com"],
  "channel": "EMAIL",
  "documentIds": ["uuid"]
}
```
El servidor verifica permiso, aprobación vigente, hash, destinatarios y documentos permitidos antes de aceptar.

## Integración futura XploreTogether
Evento/operación sugerida: `proposal.accepted` con `requestId`, `scenarioId`, `quoteVersionId`, folio, destino, fechas, cantidades, moneda, precio final aprobado y referencias documentales. Evitar transferir costes internos si el receptor no los necesita. Contrato versionado y consentimiento/permisos de datos requeridos.

## Seguridad de endpoints
- AuthN obligatoria; AuthZ por endpoint y recurso.
- Validación de entrada/salida.
- Rate limits, logs redactados y correlation IDs.
- No aceptar campos de rol, oficina autorizada o usuario creador desde el cliente sin validación.
