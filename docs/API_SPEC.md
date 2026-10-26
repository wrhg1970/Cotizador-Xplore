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
- `POST /concept-templates`, `PATCH /concept-templates/{id}` — solo administrador del sistema, con auditoría
- `GET /users?officeId=...` (solo administradores autorizados)

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
- `PATCH /quotes/{quoteVersionId}` (solo borrador). Acepta `targetMarginRate` (% de comisión sobre el precio final) o `targetPricePerParticipant` (precio final entero; el servidor deriva el %), nunca ambos. Errores: `PRICE_BELOW_COST`, `PRICE_UNREACHABLE`, `FX_REQUIRED`. La respuesta incluye `sheet` con los subtotales de la hoja EE (fuera del hash de aprobación).
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
