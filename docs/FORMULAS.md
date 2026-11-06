# Motor de cotización y fórmulas configurables

## Principios
El motor es una librería pura, determinista y versionada. No ejecuta código arbitrario introducido por usuarios. Las fórmulas se construyen con un catálogo limitado de variables, operadores y funciones validadas.

## Variables de entrada
- `participants`, `chaperones`, `staff`, `days`, `nights`
- `line.quantity`, `line.unitCost`, `line.currency`, `line.allocationMethod`
- `exchangeRate(base, quote, effectiveDate)`
- `fixedGroupCosts`, `perPersonCosts`, `perDayCosts`
- `discountRate`, `commissionRate`, `markupRate`, `targetMarginRate`
- impuestos solo después de aprobación fiscal
- `roundingMode`, `decimalPlaces`

## Categorías de línea
- Per participant
- Per chaperone
- Per staff
- Per group / fixed
- Per day per person
- Per room/night
- Shared / allocated
- Contingency / emergency fund
- Commission / discount
- Other (con unidad y método de reparto explícitos)

## Fórmulas de referencia
Definir fórmulas exactas con Finanzas antes de producción. La implementación debe soportar como mínimo:

1. `lineTotal = quantity × unitCost`
2. `groupCost = sum(convertedLineTotals)`
3. `perParticipantShare = allocatableSharedCosts / allocationParticipantCount`
4. `costPerStudent = studentSpecificCosts + perParticipantShare`
5. `costPerChaperone = chaperoneSpecificCosts + allocatedChaperoneShare`
6. `subtotal = sum(costComponents)`
7. Comisión sobre coste: `commission = commissionBase × commissionRate`
8. Markup sobre coste: `salePrice = cost × (1 + markupRate)`
9. Precio con margen bruto objetivo: `salePrice = cost / (1 - targetMarginRate)` para `targetMarginRate < 1`
10. Descuento: `discountedPrice = listPrice × (1 - discountRate)`
11. Conversión: `convertedAmount = amount × recordedExchangeRate`
12. Precio por persona y total de grupo calculados por separado.

## Diferencia importante
`markupRate` y `targetMarginRate` no son equivalentes. Un markup de 20% sobre coste produce margen bruto de 16.67% sobre venta. La interfaz debe nombrarlos claramente.

## Chaperones
- Costes de chaperones se calculan en bloque separado.
- La política decide si se absorben en el precio del estudiante, se cobran por separado o se combinan.
- No inferir esta política; debe estar definida en el `FormulaSet`.
- “Fondo de emergencia” puede ser importe fijo, por persona o por día; requiere selector de base.

## Moneda y redondeo
- Cada línea incluye moneda.
- La conversión usa tasa almacenada con fuente y fecha.
- Mantener precisión decimal interna; redondear solo en puntos definidos.
- Configurar modo de redondeo y decimales por moneda.
- Documentar tratamiento de diferencias de conversión.

## Hoja EE (implementado, Sprint A, 2026-10-26)
Layout tomado del prototipo V2 y validado con Finanzas (Will, 2026-10-26):
- **Conceptos por estudiante** → SubTotal 1.
- **Gastos del líder** = (chaperones de la escuela + chaperones EE + fondo de emergencia) ÷ estudiantes. Los rubros de chaperón son por chaperón y **se multiplican por el número de chaperones**.
- **Fijos del grupo** ÷ estudiantes (se muestra aparte si existe).
- SubTotal 2 = coste por estudiante.
- **% Comisión sobre el precio final**: precio = SubTotal 2 ÷ (1 − %), redondeado hacia arriba al entero. (El prototipo V2 lo calculaba sobre el coste; se descartó.)
- **Precio final capturado**: % = 1 − coste ÷ precio, truncado a 6 decimales; el servidor verifica que el redondeo devuelva exactamente ese precio.

## Plan de pagos y lugares liberados (Sprint B, 2026-10-27)
- Por estudiante, sobre el precio final ya redondeado. Inscripción opcional: % del precio (truncado a centavos) o monto fijo menor que el precio.
- Parcialidades iguales truncadas a centavos; la última absorbe el residuo, así la suma da exactamente el precio. Fechas: mensual (mismo día, ajustado al fin de mes), quincenal (+14 días) o semanal (+7).
- Gratuidades por ratio (antes «lugares liberados») = ⌊estudiantes ÷ N⌋. Hasta 2026-11-06 eran solo informativas; ver la sección siguiente.
- Los campos nuevos entran al hash de aprobación solo cuando tienen valor, para no invalidar autorizaciones previas.

## Chaperones y gratuidades por ratio (Will, 2026-11-06)
- Los rubros **Seguro, Kit y Transfer** de los bloques de chaperones (EE y escuela) copian cantidad, costo unitario y moneda del rubro del estudiante cuya primera palabra coincide («Seguro MSI», «Kit EE», «Transfer»; «Costo envío de kits» no cuenta). Se ven bloqueados en el editor y el servidor los vuelve a copiar al guardar (`syncChaperoneLines`).
- Cada gratuidad descuenta **solo el «Costo chaperón»** (curso/programa; se reconoce por nombre: «Costo chaperón…», «curso» o «programa»). Seguro, kit, transfer y gastos se cobran a todos. Ejemplo: 1 gratuidad y 3 chaperones → 2 cursos y 3 seguros, kits y transfers.
- Las gratuidades se asignan primero a los chaperones EE y luego a los de la escuela (mismo orden que la matriz por volumen), nunca más que los chaperones que viajan. Con destino «Beca para estudiante» siguen siendo informativas.
- Aplica en la hoja, matriz por volumen, simulador, comparador, Excel interno y PDF (todo sale del mismo motor).
- Versiones ya en autorización, aprobadas, enviadas o reemplazadas al momento del cambio conservan la regla anterior (`freeCourseByRatio = false`), así su precio y su hash de aprobación no cambian. Al editar una versión (p. ej. devuelta) pasa a la regla nueva.

## Versionado
Cada versión guarda `formulaSetId`, `formulaSetVersion`, inputs, FX, líneas, resultados y `calculationHash`. Los cambios de fórmula no recalculan cotizaciones ya enviadas.

## Validaciones
- Denominadores > 0.
- Porcentajes en rangos permitidos.
- No dividir entre cero.
- Detectar coste negativo no autorizado.
- Alertar margen negativo o presupuesto excedido.
- Rechazar fórmula no reconocida o variable no permitida.
- Pruebas de regresión con hojas Excel aprobadas por Finanzas.

## Tabla de precio por volumen (2026-10-28)
`volumePrices` en cada cotización: precio por estudiante si el grupo fuera de 15, 20, 25, 30 o 35 estudiantes. Se recalcula con el mismo motor y los mismos conceptos, chaperones, staff, tipos de cambio y comisión; solo cambia el número de estudiantes, así que bajan los gastos de chaperones y fijos del grupo por estudiante. Ejemplo aprobado (Opción 1, 18%): a 20 estudiantes, (4020 + 1850 ÷ 20) ÷ 0.82 = 5015.24 → 5016 EUR. Es un dato derivado: no entra en el hash de aprobación y no se muestra al colegio.
