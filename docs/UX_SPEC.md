# UX / UI Specification

## Principios
- Español por defecto; arquitectura preparada para internacionalización.
- Escritorio primero para cotizadores, usable en móvil para asesores.
- La mayoría de acciones frecuentes en 1–3 interacciones.
- Lenguaje de negocio, no técnico.
- No usar tablas financieras densas sin filtros, encabezados fijos y totales claros.
- Guardado de borrador y mensajes claros de validación.
- Accesibilidad WCAG 2.2 AA como objetivo.

## Navegación
1. Inicio
2. Solicitudes
3. Mis tareas
4. Cotizaciones
5. Consolidado
6. Reportes
7. Catálogos y fórmulas (solo autorizados)
8. Integraciones (admin)
9. Administración

## Pantallas
- Dashboard: contadores, tareas pendientes, propuestas por estado y tiempos.
- Bandeja: folio, grupo, oficina, destino, salida, solicitante, responsable, estado, última actividad.
- Solicitud: resumen, datos, comentarios, adjuntos, timeline y escenarios.
- Editor de cotización: tabs Datos / Costos / Chaperones y staff / Precio / Revisión.
- Comparador: escenarios en columnas; costes internos ocultos por defecto a perfiles no autorizados.
- Revisión: lista de alertas, margen, presupuesto, cambios desde versión anterior, aprobar/devolver.
- Documentos: vista previa, generar PDF comercial, generar XLSX interno, descarga autorizada.
- Envío: destinatarios, vigencia, versión y confirmación explícita.
- Resultado: aceptar/rechazar/expirar con motivo y evidencia opcional.
- Integraciones: estado, última sincronización, errores accionables, botón probar conexión.
- Fórmulas: constructor limitado y versionado; no editor de código arbitrario.

## Mensajes de confirmación
- Antes de enviar: “Vas a enviar la versión X, aprobada por Y el [fecha]. Esta versión no podrá editarse. ¿Continuar?”
- Si cambió el cálculo: “La cotización cambió después de su aprobación. Solicita una nueva aprobación.”
- Si falta información: indicar campos exactos y cómo resolver.
- En error de integración: mantener la operación local y ofrecer reintento.

## Documentos
PDF cliente: logo/nombre EE, grupo, destino, fechas, participantes, inclusiones/exclusiones, precio, moneda, vigencia, condiciones y contacto. Sin desglose de coste interno por defecto.
XLSX interno: resumen, líneas, unidades, cantidades, moneda original, tasa FX, coste convertido, comisiones, precio, margen y supuestos. Proteger con permisos de descarga; la protección de hoja no sustituye autorización.

## App instalable (PWA) y avisos en el dispositivo (2026-10-28)
- "Mi trabajo" se puede instalar desde el navegador (Chrome/Edge: icono de instalar; iPhone: Compartir → Agregar a inicio). Abre en `/inicio`.
- El botón "Activar avisos" pide permiso de notificaciones. Con permiso, cada 5 minutos, mientras la app o una pestaña esté abierta, se avisa de tareas y atrasos nuevos; tocar el aviso abre la solicitud o cotización.
- Con la app cerrada no llegan avisos al dispositivo (eso requiere Web Push); los correos siguen cubriendo ese caso.
- El service worker no guarda páginas ni datos en el dispositivo.
