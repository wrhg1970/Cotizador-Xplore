# Modelo de datos (PostgreSQL / Prisma)

## Entidades principales
- `User`: identidad Google, nombre, email, estado.
- `Office`: oficina y configuración.
- `UserOfficeRole`: usuario, oficina, rol y permisos.
- `TravelRequest`: grupo, destino, fechas, cantidades, presupuesto, moneda, estado, solicitante y responsable.
- `RequestComment`, `Attachment`, `ActivityEvent`.
- `QuoteScenario`: escenario de una solicitud y descripción.
- `QuoteVersion`: snapshot/versionado de datos y cálculo, moneda, FX, estado, totales, creador, hash.
- `ConceptTemplate`: catálogo de rubros de la hoja EE (nombre, bloque/categoría, base, interno, cantidad = días del viaje, orden, activo). Los escenarios nuevos copian los rubros base con costo cero; cambiar el catálogo no toca cotizaciones existentes.
- `QuoteVersion` (Sprint B): `payment_plan` (JSON validado), `students_per_free_place`, `free_place_benefit`, `itinerary` (JSON), `exclusions`. El calendario de pagos se calcula, no se guarda.
- `QuoteTemplate`: plantilla por oficina con conceptos (JSON), % de comisión, itinerario, «no incluye» y condiciones; sin tipos de cambio ni fechas de pago.
- `RolePolicy` (Sprint C): permisos configurables por rol (`all_offices`, `view_internal_costs`, `export_internal_xlsx`, `approval_limit_mxn`). Valores iniciales = reglas fijas anteriores; `SYSTEM_ADMIN` no tiene fila (siempre global); el Excel interno exige ver costos (constraint).
- `QuoteLine`: concepto, cantidad, unidad, coste unitario, moneda, regla de reparto, flags de visibilidad.
- `FormulaSet`, `FormulaRule`: reglas versionadas, vigencia y definición validada.
- `Approval`: decisión, aprobador, fecha, comentarios y hash de versión aprobada.
- `Document`: tipo, storage key, checksum, versión y metadatos.
- `ProposalDelivery`: versión enviada, destinatarios, canal, fecha, resultado.
- Resultado con el cliente: columnas de `TravelRequest` (`won_version_id` único, `lost_reason`, `closed_at`), con CHECKs `WON` ⇔ versión ganadora y `LOST` ⇒ motivo. Sustituye a la tabla `ProposalOutcome` prevista.
- `OfficialRate` (tabla `official_rates`, 2026-10-28): tipos de cambio oficiales EE (de, a, tasa, fecha, fuente, quién publicó). Append-only por trigger; el vigente por par es el más reciente. Las cotizaciones copian el valor a `quote_fx_rates`, así que publicar uno nuevo no cambia nada existente.
- `TravelRequest.specifications` (JSON, 2026-10-28): especificaciones del viaje validadas con `TripSpecs` (alojamiento, escuela receptora, cursos, traslados y alimentación, vuelos y excursiones, seguro y accesibilidad, no incluidos).
- `IntegrationConnection`, `IntegrationJob`, `WebhookEvent`, `ExternalReference`.
- `AuditLog`: actor, acción, entidad, entityId, timestamp, correlationId, diff redactado y `office_id`. `office_id` lo llena un trigger `BEFORE INSERT` a partir de la entidad (solicitud, versión, plantilla, oficina, rol de usuario); nulo = evento global (inicio de sesión, permisos, catálogo). La tabla es append-only (trigger que impide UPDATE/DELETE).

## Reglas de almacenamiento
- IDs UUID.
- Importes en `Decimal`/`NUMERIC`, no float.
- Fechas almacenadas en UTC; mostrar zona horaria configurada.
- Guardar snapshot JSON validado de inputs, líneas, reglas y resultado, además de tablas normalizadas.
- Índices en folio, oficina, estado, fecha, grupo, país y relaciones de integración.
- Restricciones de FK y checks para cantidades/precios.
- Soft delete solo donde tenga sentido; auditoría no se borra por UI.
- Los documentos viven en object storage privado; en DB se guarda key, checksum y permisos/metadatos, no binario.
- `QuoteVersion` es inmutable una vez enviada; cambios posteriores crean nueva versión.

## Esquema conceptual de relaciones
```text
Office 1---* UserOfficeRole *---1 User
Office 1---* TravelRequest *---1 User (requester)
TravelRequest 1---* QuoteScenario 1---* QuoteVersion
QuoteVersion 1---* QuoteLine
QuoteVersion 1---* Approval
QuoteVersion 1---* Document
QuoteVersion 1---* ProposalDelivery
TravelRequest 0..1---0..1 QuoteVersion (won_version_id, ganadora)
TravelRequest 1---* ActivityEvent / AuditLog
IntegrationConnection 1---* IntegrationJob
```

## Índices/constraints sugeridos
- `TravelRequest.folio` UNIQUE.
- `(office_id, status, created_at)` para bandejas.
- `(scenario_id, version_number)` UNIQUE.
- `Approval` debe referir hash exacto de `QuoteVersion`.
- Unicidad de propuesta ganadora por request mediante transacción y constraint apropiada.
- `ExternalReference(provider, external_id, entity_type)` UNIQUE.
- `WebhookEvent(provider, event_id)` UNIQUE.
