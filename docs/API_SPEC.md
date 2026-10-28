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
- `GET /health` (vivo) y `GET /health/ready` (vivo y con base de datos; 503 si no responde), públicos, cuerpo `{ "status": "ok" }`.
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
- `GET /dashboard` — «Mi trabajo»: pendientes del usuario (`SUBMIT_REQUEST`, `ASSIGN`, `QUOTE`, `FIX_QUOTE`, `APPROVE`, `SEND`, `RECORD_OUTCOME`), conteo de solicitudes por oficina y estado, y `requests`: hasta 100 solicitudes abiertas de su alcance (más las ganadas que aún no salen) con etapa 1–4 (Solicitada, Cotizada, Aprobada, Enviada), rol del usuario (`REQUESTER`, `ASSIGNEE`, `SUPPORT`), número de escenarios y precio por alumno de la versión más avanzada (nunca costos). Sin borradores ajenos
- `GET /dashboard/executive?officeId&from&to` — Dashboard ejecutivo: solicitudes creadas en el periodo (por defecto, del 1 de enero a hoy; sin borradores) con totales, abiertas por etapa, conversión (ganadas ÷ ganadas + perdidas), monto ganado por moneda (precio al cliente, sin convertir tipos de cambio ni mostrar costos/margen), desglose por oficina y por mes, y salidas ganadas de los próximos 60 días. Solo coordinadores, auditores y administradores, dentro de sus oficinas (403 fuera de ellas; 400 si el rango es inválido).
- `GET /official-rates` — tipos de cambio oficiales vigentes (el más reciente por par), para cualquier usuario con sesión. `POST /official-rates` `{fromCurrency, toCurrency, rate, rateDate, source}` publica uno nuevo; solo administrador del sistema, auditado como `official_rate.published`. No se editan ni borran.
- `GET /role-policies`, `PUT /role-policies/{role}` — permisos por rol (`canView`, `canCreate`, `canEdit`, `canDelete`, `allOffices`, `viewInternalCosts`, `exportInternalXlsx`, `approvalLimitMxn`); solo administrador del sistema, con auditoría. `SYSTEM_ADMIN` no es editable. `GET /me` incluye `policies`
- `POST /offices` — alta de oficina (administrador del sistema)
- `GET /offices/all` — todas las oficinas, activas o no, con cuántas solicitudes, privilegios y plantillas tienen (administrador del sistema). `GET /offices` sigue devolviendo solo las activas
- `PATCH /offices/{id}` — `{code?, name?, active?}`: renombrar, cambiar código o desactivar/activar; 409 si el código ya existe. Auditado como `office.updated` con antes y después
- `DELETE /offices/{id}` — borra solo una oficina vacía (sin solicitudes, privilegios ni plantillas); si tiene historial responde 409 y hay que desactivarla. Auditado como `office.deleted`
- `PUT /users/{id}/offices` — `{officeIds}`: oficinas donde aplican los privilegios del usuario (todos salvo administrador del sistema); solo administrador del sistema, auditado como `user.offices_updated`. `GET /users` incluye `officeIds` solo para el administrador del sistema
- `GET /audit-logs?officeId&action&actorEmail&entityId&from&to&page&limit` — bitácora de solo lectura; coordinador de oficina y auditor ven sus oficinas, administrador del sistema todo (incluye inicios de sesión y cambios globales). `action` filtra por prefijo (`quote.`), fechas `YYYY-MM-DD` inclusivas, `limit` ≤ 100
- `GET /audit-logs/export.csv` — mismos filtros y alcance que la lista, sin paginar (máximo 10 000 filas), CSV UTF-8 con celdas tipo fórmula neutralizadas; la descarga queda auditada como `audit_log.exported`.

### Solicitudes
- `POST /requests`
- `GET /requests`
- `GET /requests/{requestId}`
- `PATCH /requests/{requestId}` — incluye `specifications` (objeto `TripSpecs` con 7 bloques de texto opcionales, o `null` para borrarlas), igual que `POST /requests`
- `GET|POST /requests/{requestId}/attachments`, `GET|DELETE /requests/{requestId}/attachments/{attachmentId}` — archivos de la solicitud. Subir: `{fileName, fileBase64}` (3 MB, máximo 20 por solicitud), quien vea la solicitud y tenga «Editar» en su oficina; el tipo se detecta por los bytes contra una lista permitida (PDF, PNG, JPG, XLSX, DOCX, PPTX, CSV, TXT) y se descarga siempre como adjunto con `nosniff`. Borrar: quien lo subió o un rol con «Borrar». Auditoría `request.attachment_added|removed` con nombre y tamaño, nunca el contenido.
- `GET|PUT /requests/{requestId}/team`, `GET /requests/{requestId}/team/candidates` — ejecutivo comercial (uno) y personas de apoyo (hasta 20), solo de la oficina de la solicitud. Lo arma el solicitante o el coordinador mientras la solicitud esté abierta; auditado como `request.team_updated`. El ejecutivo comercial cuenta como titular en «Mi trabajo».
- `POST /requests/{requestId}/submit`
- `POST /requests/{requestId}/assign`
- `POST /requests/{requestId}/outcome` — respuesta del cliente a una solicitud enviada (`SENT`): `{outcome:"WON", versionId, version}` (la versión debe estar enviada y ser de esa solicitud) o `{outcome:"LOST", reason, version}`. Solo el cotizador asignado o el coordinador; la solicitud queda cerrada y se audita (`request.won` / `request.lost`). `GET /requests/{id}/proposals` incluye `sent`
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
- `POST /requests/import` — lee una hoja (mismo cuerpo y límites que el anterior) y devuelve `{draft, warnings}`: los datos de la solicitud que encontró (grupo, cliente, programa, ciudad, país, fechas, participantes, chaperones, staff, requerimientos), cada uno validado con las mismas reglas que el formulario; lo inválido se descarta con aviso. **No guarda nada**: el formulario se llena y el usuario elige oficina y guarda. Requiere poder crear solicitudes en alguna oficina (403). Audita `request.import_previewed` solo con los nombres de campo, nunca los valores.
- `GET /quotes/{quoteVersionId}/export.xlsx` — Excel interno; exige el permiso `exportInternalXlsx` del rol. Pestañas: «Cotización» (formato de la hoja oficial EE: conceptos por estudiante, SubTotal 1 y 2, comisión y precio final a la izquierda; gastos de chaperones y fondo de emergencia a la derecha), «Conceptos» (detalle de cada línea), «Plan de pagos» (con lugares liberados), «Itinerario» (con «No incluye»), «Tipos de cambio» y «Autorización y envío»
- `POST /quotes/{quoteVersionId}/calculate`
- `POST /quotes/{quoteVersionId}/submit-for-approval`
- `POST /quotes/{quoteVersionId}/approve`
- `POST /quotes/{quoteVersionId}/return`
- `POST /quotes/{quoteVersionId}/send`
- `POST /quotes/{quoteVersionId}/wetravel` — crea en WeTravel la liga de pago de la propuesta ganadora (solicitud `WON` y esta versión como ganadora). Solo el cotizador asignado o el coordinador. Responde `{wetravelUrl}`; `GET /requests/{id}` trae `wetravelUrl`. Errores: 403 si no es la ganadora, 409 `WETRAVEL_EXISTS` si ya hay liga, 400 si la cotización tiene avisos, 502 si WeTravel falla, 503 sin `WETRAVEL_API_KEY`
- `GET|POST /quotes/{quoteVersionId}/shares`, `DELETE /quotes/{quoteVersionId}/shares/{shareId}` — liga para el colegio. Crear: `{days}` (1 a 90, por omisión 30), solo el cotizador asignado o el coordinador, con la versión autorizada o enviada y la solicitud en cotización, enviada o ganada. Responde `{id, token, expiresAt}`: el token se muestra **una sola vez** (se guarda solo su SHA-256). Listar no devuelve tokens; trae vistas y última vista. Revocar es inmediato. Auditoría `proposal.share_created|share_revoked` sin el token
- `GET /public/proposals/{token}` — **público** (sin sesión), 30 por minuto por IP. Devuelve la misma propuesta sin costos que la vista de impresión, sin ids internos, más `expiresAt`. Cualquier falla (token mal formado, desconocido, caducado, revocado, versión ya no autorizada o solicitud cerrada) es el mismo 404
- `POST /quotes/{quoteVersionId}/documents`
- `GET /quotes/{quoteVersionId}/documents`

### Resultado y reportes
- `GET /reports/versions?status=IN_REVIEW|SENT` — pantallas «Aprobaciones» y «Propuestas enviadas»: versiones de las oficinas que el usuario puede ver (hasta 200, las más recientes), con precio por estudiante al cliente (nunca costos), quién preparó, fecha y medio del último envío, estado de la solicitud y `canApprove` (misma regla que autorizar: «Autorizar viaje» y no haberla preparado ni ser el cotizador)
- `GET /reports/financial.xlsx?officeId&from&to` — reporte financiero interno: viajes ganados por fecha de salida (por omisión el año en curso) con precio, venta, costo, comisión y % por viaje, más totales por moneda (no se convierten). Solo oficinas donde el rol tiene «Descarga Excel interno»; 403 fuera de ellas. Auditado como `report.financial_exported` con el periodo y el número de filas
- `GET /integrations` — solo administrador del sistema: qué conectores están configurados (Google, correo, IA de hojas, WeTravel, Wissify), nunca las llaves
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

### Tareas programadas
- `POST /official-rates/banxico` (administrador del sistema): publica los tipos de Banxico del día.
- `POST /cron/daily` (sin sesión; header `X-Cron-Secret`): Banxico y correo diario de pendientes atrasados (uno por persona, una vez al día). 404 si no hay `CRON_SECRET`.
- `GET|PUT /settings/alerts`: umbrales en días (sin cotizar, autorización pendiente, enviada sin respuesta, anticipación de pagos); escribir solo administrador del sistema, auditado. `GET /dashboard` incluye `alerts` del usuario.

### Propuesta y colegio (2026-10-28)
- `GET /quotes/{id}/proposal/cover`, `GET /public/proposals/{token}/cover`: foto del destino (imagen adjunta elegida en la cotización).
- `POST /public/proposals/{token}/accept` (sin sesión, 5/min): `{signerName, signerRole, accepted: true}`. Solo versión enviada con solicitud en "Enviada"; registra nombre, cargo, fecha, IP y navegador (append-only), marca la solicitud ganada y avisa al equipo. 409 si ya tiene respuesta.
- `GET /requests/{id}/wetravel/payments`: lo pagado por el grupo en WeTravel (en vivo).
- `GET /quotes/{id}/compare`: cambios contra la versión anterior del mismo escenario.
- `GET /schools`, `GET /schools/detail?officeId&key`, `POST /schools/contacts`, `DELETE /schools/contacts/{id}`: ficha por colegio (agrupa por nombre del cliente normalizado, por oficina).
- `GET /suppliers` (roles que ven costos internos), `POST /suppliers`, `PATCH /suppliers/{id}`, `POST /suppliers/{id}/rates`, `PATCH /supplier-rates/{id}` (solo administrador del sistema, auditado): catálogo de proveedores/DMC y tarifas; el editor copia la tarifa al concepto (`costSource` = proveedor).
- `GET /settings/goals/{año}` y `PUT /settings/goals/{año}` (solo administrador del sistema, auditado): meta anual de venta en MXN por oficina, `{ "<officeId>": "5500000" }`. `GET /dashboard/executive` agrega `goals: { year, offices: [{ id, code, name, goalMxn, wonMxn, progress, withoutRate }] }` del año de `to`, solo oficinas del alcance con meta; `wonMxn` suma ganadas por fecha de cierre con su precio en MXN, y `withoutRate` cuenta las ganadas en otra moneda sin tipo de cambio a MXN (no se infiere).

### Agencia y marca (2026-10-28)
- `GET /agency/brand`: marca de la agencia del usuario (`AgencyBrand`: nombre, nombre visible, colores, pie de propuesta, remitente, dominio propio, `logoUrl`).
- `PUT /agency/brand` (administrador del sistema): `AgencyBrandingInput`; `null` = valor por defecto de Xplore Together. Dominio repetido → 409. Auditado `agency.brand_updated`.
- `PUT /agency/logo` (administrador del sistema): `{ fileName, fileBase64 }`, PNG o JPG comprobado por bytes, máx. 512 KB. `DELETE /agency/logo` lo quita. Auditados.
- `GET /agencies/{id}/logo` (público): la imagen, con `nosniff` y caché de un día; la URL cambia al cambiar el logo.
- `GET /branding` (público): marca del dominio desde el que se abre la página (`X-Forwarded-Host`), EE si ningún dominio coincide; sin pie ni remitente.
- `GET /agencies`, `POST /agencies` (`CreateAgency`: agencia, dominios de Google, primera oficina y su administrador del sistema; copia el catálogo de rubros de EE) y `PATCH /agencies/{id}` (`UpdateAgency`: nombre, dominios, activa). Solo administradores del sistema de EE (`/me` → `platformAdmin`). Desactivar cierra las sesiones de la agencia; EE no se puede desactivar.
- `GET /auth/google/login` abierto desde el dominio propio de una agencia usa `https://{dominio}/api/v1/auth/google/callback` y regresa a ese dominio.
- La propuesta (`/quotes/{id}/proposal` y la liga pública) incluye `brand` (nombre, logo, pie, colores) de la agencia de la solicitud.

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
  "contactName": "Mtra. Claudia Morales",
  "contactEmail": "cmorales@colegio.example",
  "commercialNotes": "Cliente recurrente (interno)",
  "specifications": { "accommodation": "Residencia", "included": "Seguro\nKit EE", "notIncluded": "Visas", "extra": "Rango de edad: 14 a 18 años" }
}
```
`contactName`, `contactEmail` y `commercialNotes` son opcionales; la auditoría solo anota que cambiaron. En `specifications`, `included` y `notIncluded` llevan un servicio por línea y `extra` un "Nombre: valor" por línea.

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

## Histórico (2026-10-28, solo administrador del sistema)
- `POST /history/preview` `{fileName, fileBase64}`: lee un Excel de cotización EE (pestañas "Consolidado" y "Opción N") por sus etiquetas, sin IA; devuelve grupo, cliente, destino, fechas, staff, opciones (moneda, TC a MXN, participantes, % comisión, precio final) y la oficina que coincide por nombre. No guarda nada.
- `POST /history` (`ImportHistory`): crea la solicitud cerrada (WON/LOST/SENT) con una versión enviada por opción. 409 `HISTORY_DUPLICATE` si ya existe (misma oficina, grupo, cliente y fecha de salida). Audita `request.history_imported`.

## Correos al colegio (2026-10-28)
- `POST /quotes/{id}/send` acepta `emailClient: true` y `message`: con canal EMAIL y `recipients` como lista de correos, crea una liga para el colegio de 30 días y manda el correo con plantilla de marca dentro de la misma transacción (502 si falla el SMTP y no se registra nada). Audita `quote.emailed` (solo conteo).
- `POST /requests/{id}/payment-reminder`: solicitud ganada; manda al colegio el siguiente pago del plan. Vendedor, cotizador asignado o coordinador. Audita `request.payment_reminder_sent`.
- `POST /cron/daily` además manda un recordatorio por pago que vence dentro de "Recordatorio de pagos" (días, en Administración), una sola vez por pago, a los correos del último envío por correo de la propuesta ganadora.

## Seguridad de endpoints
- AuthN obligatoria; AuthZ por endpoint y recurso.
- Validación de entrada/salida.
- Rate limits, logs redactados y correlation IDs.
- No aceptar campos de rol, oficina autorizada o usuario creador desde el cliente sin validación.
