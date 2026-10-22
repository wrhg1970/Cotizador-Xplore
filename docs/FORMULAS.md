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
