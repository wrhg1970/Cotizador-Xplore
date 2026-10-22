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
Caso de uso a validar: asociar propuesta aceptada a viaje/producto, sincronizar datos mínimos del grupo y, si la API lo permite, recuperar referencias de pago/estado. No guardar datos de tarjeta.
Si no hay API suficiente, proporcionar exportación/importación controlada y registrar manualmente el identificador externo.

## Wissify
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
