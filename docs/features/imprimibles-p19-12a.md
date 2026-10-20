# Imprimibles en A4 y ajustes de la 0.22.0 (P19.12a)

## 1. «Licencias y ausencias» con el mismo formato que el detalle de asistencia

- `LeavesAbsencesPerson` suma `roleLabels` y `signerLabel` (los arma
  `EmployeeDetailPage` con `printRoleLabels` y `personSignerLabel`).
- Los datos del encabezado son los mismos que los del detalle de asistencia
  (Nombre y Apellido, DNI, Legajo, Rol, Período) más los resúmenes de licencias
  y ausencias.
- Al final lleva `LEAVES_ABSENCES_CONSENT_TEXT` («Las partes prestan
  conformidad con el detalle de licencias e inasistencias consignado.») y
  `PrintSignatures` con «Responsable (administración)» y la persona.
- Ninguna de las dos hojas tiene numeración ni leyenda de pie: el pie es el
  bloque de conformidad y firmas.

## 2. Descargable de la pestaña Asistencia

- `buildAttendanceSheet` recibe `leaves` (las de `useEmployeeLeavesQuery`) y las
  intercala con los turnos, ordenadas por fecha. Una licencia va en su fecha de
  inicio (o en el primer día del período si empezó antes), antes de los turnos
  de ese día, con la observación «Licencia del dd/mm/aaaa al dd/mm/aaaa (o
  abierta) — motivo», sin horas.
- Las inasistencias avisadas dicen «Inasistencia — con certificado / sin
  certificado / certificado sin indicar — motivo». Las inasistencias sin aviso
  (franja terminada sin fichaje) siguen diciendo «Inasistencia: sin fichaje de
  inicio»: se conserva el criterio de AJ2-14.
- Licencias y ausencias no suman al total de horas. Los datos muestran
  «Inasistencias» (si hay) y «Licencias» (si hay).

## 3. Hoja A4 de ancho fijo

La diferencia de ancho entre hojas venía de `PrintSheet`: `w-full max-w-[210mm]`
achicaba la hoja con la ventana, el margen interno pasaba de 16 px a 15 mm en
640 px, los datos y las firmas cambiaban de 1 a 2 columnas con el ancho de la
ventana, y las tablas con muchas columnas (asistencia) ensanchaban el contenido
con texto sin cortar.

- La hoja mide siempre `w-[210mm]` con 15 mm de margen interno (`shrink-0`). En
  pantallas angostas el contenedor de la vista previa se desplaza en
  horizontal: la hoja no se reacomoda.
- Datos y firmas siempre en 2 columnas; las celdas parten el texto largo
  (`overflow-wrap:anywhere`), así que las tablas no desbordan.
- Al imprimir: `@page { size: A4 portrait; margin: 15mm }` y la hoja pasa a
  ancho automático (los mismos 180 mm útiles de la vista previa).

## 4. Toque perdido en «Registrar en nombre» (Asistencia, 390 px)

Causa: `AttendanceTodayList` armaba `columns` en cada render con funciones
`cell` nuevas. TanStack Table las renderiza como componentes (`flexRender`), así
que cada render (llegada de teléfonos, polling de 30 s) desmontaba y volvía a
montar todas las celdas; un toque entre `pointerdown` y `click` caía en un nodo
descartado. Ahora las columnas están memorizadas, y las acciones son el
componente estable `AttendanceRowActions`, que lee los teléfonos de un contexto.

## Segunda vuelta

- **Columnas cortas y largas (`PrintTable`)**: las columnas son cortas por defecto (`white-space: nowrap`: fecha, franja, inicio, fin, horas, días, validación, total) y solo parten texto las marcadas con `wrap: true` (cliente, sede, nombre, observaciones, motivo, «lo cargó»), por palabras (`overflow-wrap: break-word`, ya no `anywhere`). El texto de la tabla baja a 11 px. La validación es columna corta: un texto muy largo («Inicio: … · Fin: …») ensancharía la tabla.
- **Texto de conformidad del detalle de asistencia**: un único texto, con o sin licencias e inasistencias: «Las partes prestan conformidad con el detalle de horas, licencias e inasistencias consignado.».
- **Fila de licencia**: `PrintTable` acepta `spans` (por `key` de fila, `{ from, to }`) y une las celdas con `colSpan`. La licencia ocupa de Cliente a Observaciones con una sola celda (el texto vive en `client`).
- **Vista previa angosta**: si el ancho disponible es menor que la hoja se aplica `transform: scale()` (calculado con `ResizeObserver`, `computeSheetFit`); el diseño de 210 mm no se reacomoda. Al imprimir no se escala (`print.css`).
- **Páginas A4 completas**: la hoja mide siempre un múltiplo de 297 mm (`min-height`), con una línea fina en cada límite de página. El bloque de firmas (`data-print-signatures`, con `break-inside: avoid`) se empuja entero a la página siguiente si cruzaría el fondo útil (297 mm menos 2 × 15 mm). La paginación en pantalla es una aproximación (`computePageLayout`); los cortes reales los decide el navegador al imprimir. Las firmas quedan a continuación del contenido, no pegadas al pie.
