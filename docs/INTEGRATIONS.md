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

Pendiente (no implementado): leer pagos/reservas (`/transactions`, `/orders`) y webhooks (Svix) para reflejar cobranza en el cotizador.

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
