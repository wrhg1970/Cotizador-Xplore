# Registro de decisiones y preguntas abiertas

## Decisiones confirmadas
- Usuarios: asesores y equipo cotizador.
- Toda cotización requiere aprobación antes de envío.
- Documentos: PDF comercial y XLSX interno.
- Integraciones WeTravel y Wissify desde la primera versión, si API y permisos lo permiten.
- XploreTogether se integra después mediante contrato API/evento versionado.
- Login con credenciales corporativas Google.
- Arquitectura independiente e integrable.

## No asumir sin confirmación
1. Fórmula de comisión y su base.
2. Markup o margen objetivo.
3. Distribución de gastos de chaperones.
4. Tratamiento de fondo de emergencia, seguros, kits, promociones e impuestos.
5. Fuentes de tipo de cambio y política de redondeo.
6. Dominio(s) Google permitidos y matriz de roles por oficina.
7. Proveedor de correo y si el envío será automático en MVP.
8. Proveedor de almacenamiento de documentos.
9. APIs exactas y permisos disponibles de WeTravel y Wissify.
10. Campos y evento de destino de XploreTogether.
11. Plantilla de PDF, vigencia, términos comerciales y datos de contacto.
12. Retención de datos y requisitos legales aplicables.

## Riesgos principales
- Diferencias entre Excel actual y fórmula programada.
- APIs externas insuficientes o sin acceso aprobado.
- Exposición de costes internos en documento cliente.
- Aprobación accidental de versión distinta a la enviada.
- Ambigüedad entre presupuesto total y presupuesto por estudiante.

## Decisiones técnicas de Sprint 0 (2026-10-22)
- Lanzamiento como piloto de alcance mínimo; integraciones WeTravel/Wissify fuera del piloto (ID externo manual).
- Monorepo pnpm workspaces + Turborepo; Node 22; TypeScript 5.9 `strict` (TS 7 pospuesto hasta validar compatibilidad con decoradores de NestJS).
- NestJS 12 (ESM) con Vitest + SWC como único runner de pruebas.
- Zod en `packages/contracts` como fuente única de validación.
- Prisma 7.10 (estable) con `@prisma/adapter-pg`; la etiqueta `latest` de npm apunta a una RC de Prisma 8 y no se usa.
- Dinero con `decimal.js` en el motor y strings decimales en JSON.
- `audit_logs` append-only reforzado con trigger en PostgreSQL.
- Pendiente: alojamiento, almacenamiento de documentos, librería PDF, dominios Google, fórmulas de Finanzas.

## Sprint A — hoja EE desde el prototipo V2 (2026-10-26)
- Will eligió llevar las funciones del prototipo V2 (XploreCotizador-V2, AI Studio/Firebase) a esta app en lugar de usar el prototipo como base: aquí ya están la autorización en servidor, la auditoría y el despliegue.
- Comisión sobre precio final y bloque de chaperones × cantidad (confirmado por Will). El motor no cambió de fórmula.
- Catálogo de rubros global, mantenido por el administrador del sistema. Los subtotales de la hoja (`sheet`) quedan fuera del hash de aprobación para no invalidar autorizaciones ya dadas.

## Sprint B — plan de pagos, lugares liberados, itinerario y plantillas (2026-10-27)
- Plan de pagos por versión, calculado por el motor (no guardado); si deja de cuadrar con el precio, la versión no puede enviarse a autorización.
- Lugares liberados solo informativos: no bajan el precio (confirmado por Will, 2026-10-27).
- Plantillas por oficina (contienen costos internos: solo el lado cotizador las ve). No copian tipos de cambio ni fechas de pago.

## Sprint C — tablero, permisos por rol e importador con IA (2026-10-27)
- Tablero «Mi trabajo» como página de inicio: pendientes calculados en el servidor con las mismas reglas de autorización (por ejemplo, nadie ve para autorizar lo que preparó).
- Permisos configurables por rol, no por usuario: los pasos del flujo (crear, cotizar, autorizar, enviar) siguen fijos y probados; lo configurable es alcance nacional, ver costos internos, descargar el Excel interno y tope de autorización en MXN. Valores iniciales = reglas anteriores, así que nada cambia hasta que el administrador lo decida.
- Importador: Will eligió Gemini en Vertex AI (mismo proyecto de Google Cloud, cuenta de servicio, sin claves). Dependencia `@google/genai` 2.28.0 (Google, Apache-2.0). A diferencia de la V2, no crea solicitudes ni infiere tipos de cambio: solo propone conceptos para una versión en borrador, que el cotizador revisa y guarda.
- La subida va como JSON base64 con límite de 4.5 MB solo en esa ruta (resto: 100 kB), para no usar multer (vulnerabilidad abierta en la versión que trae NestJS).
- Resultado con el cliente (ganada/perdida): ver «Ganada/perdida» abajo.

## Excel interno con formato de la hoja EE (2026-10-27)
- La pestaña «Cotización» replica la hoja oficial de Finanzas, con las mismas cifras que la pantalla (mismo cálculo del servidor). El detalle de líneas pasa a la pestaña «Conceptos». Plan de pagos e itinerario van en pestañas propias. Las cifras se exportan como valores, no como fórmulas: el cálculo oficial es el del motor versionado.

## Panel de bitácora (2026-10-27)
- Pantalla «Bitácora» de solo lectura para coordinador, auditor y administrador del sistema, con filtros por oficina, tipo de acción, persona, registro y fechas.
- La oficina de cada evento la asigna un trigger de la base de datos, para no tocar cada llamada a `audit()`; los eventos anteriores se rellenaron en la migración. Los eventos globales (inicios de sesión, permisos, catálogo) solo los ve el administrador del sistema.

## Ganada/perdida (2026-10-27)
- El resultado se guarda en la propia solicitud (`won_version_id` único, `lost_reason`, `closed_at`) en lugar de una tabla `ProposalOutcome` aparte: una columna única garantiza en la base de datos que haya una sola ganadora por solicitud y que una versión no gane dos veces. CHECKs: `WON` ⇔ hay versión ganadora; `LOST` exige motivo.
- La ganadora debe ser una versión enviada de esa misma solicitud. Lo registra quien envía propuestas (cotizador asignado o coordinador).
- Una vez registrada, la solicitud queda cerrada. Corregir un resultado (la «decisión administrativa auditada» del PRD) queda fuera de este alcance.
- Conversión en el tablero = ganadas ÷ (ganadas + perdidas) por oficina. Nuevo pendiente «Registrar respuesta del cliente» para solicitudes enviadas.

## Avisos por correo (2026-10-27)
- Will eligió una cuenta dedicada de Google Workspace por SMTP (contraseña de aplicación en Secret Manager), en lugar de Gmail API con delegación de dominio o un proveedor externo: sin datos fuera de Google y con configuración mínima.
- Cuatro avisos: solicitud asignada (al cotizador), cotización por autorizar (a los autorizadores de la oficina, nunca a quien la preparó), cotización devuelta y cotización autorizada (al autor y al cotizador asignado). Nadie recibe aviso de su propia acción ni los usuarios deshabilitados.
- Contenido mínimo: folio, grupo y liga. Envío después de la transacción, sin cola ni reintentos.
- Dependencia `nodemailer` 10.1.7 (MIT-0, sin dependencias, mantenida). Se usa 10.1.7 porque las versiones anteriores tienen avisos de seguridad en el analizador de direcciones.

## Oficinas de EE (2026-10-28)
- Will pidió dar de alta todas las oficinas de estudiantesembajadores.com/oficinas. Se cargan con la migración `20261028030000_ee_offices` (23 oficinas, códigos cortos por ciudad). «Nuevo León» ya existe como `CORP` (Corporativo Nuevo León) y no se duplica. La página dice 25 oficinas, pero solo lista 24.
- La migración salta códigos o nombres que ya existan y registra cada alta en la bitácora (`office.created`, sin actor).

## Permisos Ver / Crear / Editar / Borrar y oficinas por usuario (2026-10-28)
- Will pidió el criterio de la V2 y eligió agregarlo a los roles actuales (no rehacer roles). En «Administración», cada rol tiene Ver, Crear, Editar y Borrar, además de lo que ya existía.
- Ver: sin él, las oficinas de ese rol desaparecen para la persona (404). Crear: abrir solicitudes. Editar: modificar solicitudes y cotizaciones en las que participa (solicitante, cotizador asignado o coordinador). Borrar: cancelar solicitudes y retirar plantillas de otros; nada se elimina físicamente.
- Los pasos del flujo siguen fijos: asignar es del coordinador, autorizar del autorizador y nadie autoriza lo que preparó.
- Valores iniciales = reglas anteriores (asesor y coordinador crean; asesor, cotizador y coordinador editan; solo el coordinador borra), así que nada cambia hasta que el administrador lo decida.
- Oficinas por usuario (V2 «oficinas con acceso»): el administrador del sistema marca las oficinas en Usuarios y los privilegios de la persona aplican en todas las marcadas. Si alguien tenía privilegios distintos por oficina, al marcar oficinas se unifican.

## Importar una solicitud desde una hoja (2026-10-28)
- «Nueva solicitud» puede llenarse desde un .xlsx/.csv o una liga de Google Sheets con el mismo lector de Gemini (Vertex AI) que el importador de costos, con otro esquema e instrucciones.
- Solo propone: no guarda ni elige oficina; el usuario revisa y pulsa «Guardar borrador», que pasa por la validación y autorización normales.
- La bitácora guarda qué campos se llenaron, no sus valores (pueden traer nombres del colegio u otros datos del cliente).
