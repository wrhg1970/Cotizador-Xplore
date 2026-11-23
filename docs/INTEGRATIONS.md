# Integraciones: WeTravel, Wissify y XploreTogether

## Regla de honestidad técnica
La disponibilidad, alcance, autenticación, cuotas y permisos de cada API deben confirmarse con documentación vigente y credenciales de sandbox/producción. Este paquete define contratos internos, no garantiza que un proveedor exponga todos los endpoints deseados.

## Diseño
Interfaz común:
```ts
interface IntegrationAdapter {
  provider: "WETRAVEL" | "WISSIFY" | "XPLORETOGETHER";
  testConnection(): Promise<ConnectionTestResult>;
  syncEntity(input: SyncCommand): Promise<SyncResult>;
  handleWebhook?(request: WebhookRequest): Promise<WebhookResult>;
}
```
Los tipos reales deben modelarse por proveedor, no asumir que todos implementan las mismas operaciones.

## Fase 0 — descubrimiento
Por proveedor, documentar:
- Documentación oficial y versión.
- Método de auth y permisos.
- Entidades y operaciones soportadas.
- Webhooks y firma.
- Límites, paginación y cuotas.
- Sandbox, datos de prueba y proceso de aprobación.
- Datos personales y condiciones de uso.
- Dueño interno de credenciales.

## WeTravel
API verificada 2026-10-27: Partner API v3 (https://developer.wetravel.com/v3), disponible en el plan **Pro**. La llave se genera en WeTravel → Business Settings → Branding & Pro Settings → Partner API Integration (solo la cuenta principal) y es un *refresh token*: `POST {base}/auth/tokens/access` con `Authorization: Bearer <llave>` devuelve un `access_token` de 1 hora.

Implementado: **liga de pago desde la propuesta ganadora** (`POST /quotes/{id}/wetravel`, `POST {base}/payment_links`). Envía título (grupo + folio), `external_id` = folio, fechas de salida/regreso, moneda, precio por participante en centavos y el plan de pagos (inscripción = `deposit`, parcialidades con `days_before_departure`). `participant_fees: none` para que el padre pague exactamente el precio de la propuesta. Guarda `uuid` y `checkout_url` en la solicitud; una liga por solicitud; auditado como `request.wetravel_link`. No se envían costes, márgenes ni datos de estudiantes.

Configuración: `WETRAVEL_API_KEY` (Secret Manager `cotizador-wetravel-api-key`) y `WETRAVEL_API_URL` (producción `https://api.wetravel.com/v3`, sandbox `https://api.demo.wetravel.to/v3`). Sin llave, el botón responde 503.

Implementado 2026-11-23 (sustituye "Ver pagos en WeTravel" de 2026-10-28): **precio y saldo por estudiante** (`GET /requests/{id}/wetravel/balances`, botón "Ver saldos" en la solicitud vendida). Will: "de WeTravel solo quiero el saldo del estudiante". Bookings y Transactions siguen en la Partner API **v2** (la v3 no los migró), así que se llaman en `{origen}/v2` sea cual sea `WETRAVEL_API_URL`. Viaje: el ligado a la propuesta vendida (`wetravelTrip.uuid`) o, si no hay, el de la liga de pago (`GET {base}/payment_links/{uuid}` → `trip.uuid`). Lee `GET /v2/bookings/trips/{trip}/bookings` (paginado, comprador por orden) y por comprador `GET /v2/bookings/trips/{trip}/bookings/{buyer_id}` (órdenes con `options[].participants[]`, `currency`, `total_amount`, `already_paid`/`paid_amount`), 5 en paralelo. Una fila por orden: estudiantes activos, quién paga, precio = `total_amount`, pagado = `already_paid` (o `paid_amount`), saldo = precio − pagado (mínimo 0). WeTravel lleva el saldo por orden, no por persona: hermanos en una misma compra salen en una fila. Nada se guarda ni se registra en logs. Ya no se usa `POST /v2/transactions` (posible origen del 400 de producción, no confirmado). **No probado contra WeTravel real**.

Implementado 2026-11-13: **itinerario de WeTravel en la propuesta**. En Cotización → Propuesta → Itinerario, «Ver viajes de WeTravel» lee `GET {base}/trips` (no archivados, por fecha de salida; `query` busca por título) y «Traer itinerario» lee `GET {base}/trips/{uuid}/itinerary`: cada sección `general` visible se vuelve un día (su título) y los títulos de sus elementos visibles el detalle; el HTML se quita. Los días quedan editables y el viaje queda ligado (`quote_versions.wetravel_trip`: uuid, título y `url`, solo `https://*.wetravel.com`). También se puede pegar la liga sin usar la API. La propuesta muestra «Ver itinerario completo en WeTravel» (en el PDF, la liga escrita). Solo la agencia EE (la llave es de su cuenta). **No probado contra WeTravel real**: si responde otra forma o un error, el editor muestra el motivo y queda la opción de pegar la liga.

No implementado a propósito: webhooks. La lectura en vivo ya da el dato al abrir la solicitud, y la forma de los eventos (`payment.created`, `transaction.created`) solo está en el catálogo privado de WeTravel; se puede agregar cuando EE tenga acceso a ese catálogo.

## Pixabay (fotos de la propuesta)
Implementado 2026-11-13. Primero se diseñó con Pexels, pero Pexels pausó la emisión de llaves nuevas (noviembre 2026); se usa Pixabay (https://pixabay.com/api/docs/): `GET https://pixabay.com/api/?q=…&lang=es&image_type=photo&orientation=horizontal&safesearch=true&per_page=12` y `?id=…` para la foto elegida. La llave es gratuita (cuenta en pixabay.com; aparece en la página de docs con sesión iniciada; 100 peticiones por minuto) y va en `PIXABAY_API_KEY` (Secret Manager `cotizador-pixabay-api-key`, deploy con `PIXABAY=1` la primera vez). Reglas de Pixabay que se cumplen: respuestas en caché 24 h (memoria del servidor), sin hotlink permanente (la foto elegida, `largeImageURL` hasta 1280 px, JPG/PNG, máx. 3 MB, solo de hosts `*.pixabay.com`, se copia a los archivos de la solicitud con su crédito «Nombre / Pixabay») y se muestra la fuente (el buscador y la propuesta dicen «Pixabay»). Sin llave, el buscador responde 503 y se pueden subir fotos propias.

## Banxico (tipo de cambio)
API SIE pública (`GET /SieAPIRest/service/v1/series/SF43718,SF46410/datos/oportuno`, header `Bmx-Token`). Se guarda cada valor como tipo de cambio oficial con fecha, fuente (`Banxico FIX (SIE SF43718)`) y autor (administrador o "Proceso automático"). Cada cotización sigue congelando su propia copia al usar "Usar tipos de cambio oficiales".

## Wissify
2026-10-27: no se encontró API ni documentación pública (empresa en México; sin portal de desarrolladores). Nada implementado hasta que EE consiga documentación y credenciales del proveedor.
Caso de uso a validar: identificar el producto/cuenta Wissify exacto, API y esquema de datos; mapear grupos, programa y datos necesarios. “Wissify” debe confirmarse como sistema/servicio y no se deben inventar endpoints.
No sincronizar datos de estudiantes hasta revisar base legal, permisos y minimización de datos.

## XploreTogether
Preparar API/evento de transferencia cuando la propuesta se marque aceptada:
- Folio EE y UUIDs internos.
- Destino y fechas.
- Cantidades de participantes/chaperones/staff.
- Programa y precio aprobado con moneda.
- Contacto autorizado y documentos referenciados.
- Versiones de esquema y correlation ID.
No transferir costes internos/márgenes salvo necesidad autorizada.

## Operación fiable
- Outbox tras transacción de aceptación.
- Jobs con backoff exponencial y máximo de intentos configurable.
- Idempotency key y deduplicación.
- Estados `PENDING`, `RUNNING`, `SUCCEEDED`, `RETRYING`, `FAILED`, `NEEDS_ATTENTION`.
- Panel de errores con payload redactado y opción reintentar.
- Registro de ID local ↔ ID externo.
- Interruptor para pausar una integración.
- Secretos separados por ambiente.
