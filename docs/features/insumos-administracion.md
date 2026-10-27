# Insumos y control de stock en administración (módulo E, P25.2 y P25.3)

Sección «Insumos» (`/admin/insumos`). P25.2 trajo Stock, ficha, ingreso, ajuste y categorías; P25.3 suma Movimientos, Faltantes, Consumo por cliente, Controles, la anulación, el retiro en nombre de, «Cargar control», la planilla imprimible, la pestaña «Retiros» de las fichas y las tarjetas del Resumen. Especificación: `Docs/Plan_Maestro/modulos/E_insumos_y_stock.md` (IS-01 a IS-34). Contrato de la base: [`database.md`](../database.md), «Insumos y control de stock». Lo del celular (P25.4) no está acá. La guía de uso paso a paso, para la oficina, es [`guia-insumos.md`](../guia-insumos.md) (P25.6).

## Quién ve qué (IS-19, IS-21)

| Quién                               | Ve                                                                                                                                              | Puede                                                                                                                                                                                                                                                             |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dueña                               | Todo                                                                                                                                            | Todo (la capacidad `manage_stock` la tiene implícita)                                                                                                                                                                                                             |
| Administrador con «Gestionar stock» | Todo                                                                                                                                            | Todo                                                                                                                                                                                                                                                              |
| Administrador sin «Gestionar stock» | Todo: stock, precios, fichas, historial de precios, movimientos, consumo, controles, faltantes, categorías y la pestaña «Retiros» de las fichas | **Resolver avisos de faltante.** Nada que mueva stock ni edite el catálogo: sin «Ingreso», «Retiro en nombre de», «Imprimir planilla», «Cargar control», «Anular», «Nuevo artículo», «Ajustar», «Editar», «Cambiar precios», «Desactivar» ni cambios de categoría |
| Empleado y coordinador              | Nada de esta sección (tienen su pestaña de celular, P25.4)                                                                                      | —                                                                                                                                                                                                                                                                 |

La decisión es `canManageStock(actor)` (`src/features/stock/permissions.ts`), con el mismo criterio que `canManageAttendance`: dueño, o administrador con la capacidad. El servidor vuelve a verificar en cada RPC (`FORBIDDEN`). Quien entra por la URL a «Nuevo artículo», «Editar», «Ingreso», «Retiro en nombre de» o «Cargar control» sin la capacidad ve un mensaje que lo explica. La pestaña «Retiros» de las fichas y «Resolver» un faltante no piden la capacidad (son una consulta y un trámite abierto a la administración, IS-21): `canViewPersonWithdrawals` solo mira que sea dueño o administrador.

La capacidad se otorga en ADM-27 (solo el dueño), donde ya figura como «Gestionar stock» (P25.1).

## Rutas

| Ruta                                                                                       | Pantalla                                                     | Pantalla (id) |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------ | ------------- |
| `/admin/insumos`                                                                           | Seis pestañas; entra por Stock                               | `ADM-IS-01`   |
| `/admin/insumos?pestana=movimientos` (o `faltantes`, `consumo`, `controles`, `categorias`) | Esa pestaña                                                  | `ADM-IS-01`   |
| `/admin/insumos?filtro=aviso`                                                              | Stock con «Solo con aviso» puesto                            | `ADM-IS-01`   |
| `/admin/insumos/retiro`                                                                    | Retiro en nombre de                                          | `ADM-IS-05`   |
| `/admin/insumos/control`                                                                   | Cargar control                                               | `ADM-IS-06`   |
| `/admin/empleados/:id?pestana=retiros`                                                     | Pestaña «Retiros» de la ficha del empleado o del coordinador | `ADM-17`      |
| `/admin/insumos/nuevo`                                                                     | Nuevo artículo                                               | `ADM-IS-03`   |
| `/admin/insumos/:id`                                                                       | Ficha del artículo                                           | `ADM-IS-02`   |
| `/admin/insumos/:id/editar`                                                                | Editar artículo                                              | `ADM-IS-03`   |
| `/admin/insumos/ingreso`                                                                   | Ingreso o devolución                                         | `ADM-IS-04`   |

«Insumos» está en la barra lateral y en el menú «Más» del celular, después de «Tareas» (`src/app/shells/adminNav.ts`). Lleva el **número de avisos de faltante abiertos** (`get_stock_summary`, campo `open_reports`; `NavBadge`). El número no aparece en cero, mientras carga ni si el contador falla. Se actualiza cada 60 s y al resolver un aviso.

### Pestañas

`src/features/stock/tabs.ts` define la lista completa en el orden de IS-33: Stock, Movimientos, Faltantes, Consumo por cliente, Controles y Categorías. Con P25.3 las seis tienen pantalla. Una pestaña sin `component` no se muestra ni se puede abrir por la URL (`?pestana=` desconocido cae en Stock). `StockScreen` arma las pestañas y la URL a partir de esa lista.

## Stock (IS-05, IS-24, IS-25)

- **Columnas:** imagen chica, código, artículo y presentación, categoría, stock, mínimo, costo, venta y valor a costo. Al pie, la cantidad de artículos y el **valor del stock a costo** de lo que se ve (con los filtros puestos suma solo lo filtrado).
- **Colores de fila:** amarillo (`bg-warning-bg`) si hay mínimo y el stock es igual o menor; rojo (`bg-danger-bg`) si el stock es cero, aunque no tenga mínimo. Siempre con una etiqueta de texto («Bajo mínimo», «Sin stock»), para no depender del color. La fuente es `status` de `v_stock_admin` (`ok`, `low`, `empty`).
- **Un artículo inactivo no marca aviso:** solo se desactiva con stock cero y ese cero no es un faltante (el Resumen tampoco lo cuenta). Se ve con la etiqueta «Inactivo» y sin color.
- **Filtros:** texto (código, nombre o presentación, sin distinguir mayúsculas ni tildes), categoría, «Solo con aviso» (amarillos y rojos) e «Incluir inactivos». Se aplican en pantalla sobre la lista completa que trae `fetchStockItems`.
- **Orden por defecto:** categoría (en el orden de la pestaña Categorías) y nombre; las columnas se pueden reordenar con el encabezado.
- **`?filtro=aviso`:** abre la pestaña Stock con «Solo con aviso» puesto. Es el enlace de la tarjeta «Stock bajo» del Resumen (IS-30).
- **Botones** (con «Gestionar stock»): «Ingreso», «Retiro en nombre de», «Imprimir planilla», «Cargar control» y «Nuevo artículo» arriba; «Ajustar» y «Ficha» en cada fila.
- **Celular:** `DataTable` pasa a tarjetas (`RowCard`): artículo con su imagen y código en el título, stock y etiqueta a la derecha, mínimo, costo, venta y valor como datos, y los botones al pie. El color de la fila se conserva.
- Polling de 60 s con «Actualizado hace n s».

## Nuevo y editar artículo (IS-01 a IS-07)

Campos: código interno, categoría, artículo, presentación (opcional), stock mínimo (opcional), notas (opcional), imagen (opcional) y, **solo en el alta**, precio de costo y de venta. En la edición los precios no se muestran: se cambian con «Cambiar precios» en la ficha, que deja historial (`upsert_supply` los ignora después del alta).

- El mínimo vacío es «sin aviso» (`null`); cero es un mínimo válido y distinto.
- El código es único sin distinguir mayúsculas ni espacios de los extremos: si ya existe, el error `CODE_ALREADY_EXISTS` se marca en el campo y se muestra su mensaje.
- Categorías: solo las activas (en una edición, también la que el artículo ya tiene, aunque esté desactivada).

### Imagen (IS-04, IS-32)

`compressSupplyImage` (`src/features/stock/image.ts`) achica en el navegador: lado mayor de 1200 px, sin agrandar, fondo blanco, **WebP** (JPEG si el navegador no sabe generar WebP: el bucket admite los dos) y por debajo de 1,9 MB (baja la calidad por pasos). Redibujar descarta los metadatos. Acepta JPG, PNG y WEBP de hasta 15 MB.

Orden de alta con imagen (`saveSupply` en `src/api/stock.ts`):

1. el cliente genera el `id` del artículo (`crypto.randomUUID`);
2. sube la imagen a `supply-images/{id}/{uuid}.webp` (la política de Storage solo exige `manage_stock`);
3. llama a `upsert_supply` con ese `p_id` y `p_image_path`;
4. si el paso 3 falla, borra la imagen que acaba de subir.

En una edición, `upsert_supply` reemplaza **todos** los campos, así que siempre se manda la ruta vigente (o `null` si se quitó). La imagen anterior se borra recién cuando el servidor confirmó el cambio; si Storage falla al borrar, queda un archivo suelto que no afecta a nadie. Las imágenes se leen con URL firmadas en lote (`createSupplyImageUrls`, 30 min); el bucket es privado.

## Ficha del artículo (IS-18, IS-22, IS-26)

Datos e imagen; «Editar»; «Cambiar precios» (diálogo con costo y venta; si no cambió nada no llama al servidor); **historial de precios** (cuándo, quién, de cuánto a cuánto de costo y de venta, y el origen: alta, cambio de precios o costo de un ingreso); «Ajustar»; «Desactivar» o «Activar»; y los **movimientos** del artículo con filtro de fechas (desde y hasta, días de Argentina): fecha y hora, tipo, cantidad con signo, stock resultante, persona, turno o sede, observación y la marca «Anulado» (con quién y por qué). La anulación se hace en Movimientos: acá solo se muestra. En el historial de precios, si un valor no cambió entre dos revisiones se muestra solo ese valor y «sin cambio» (por ejemplo, «$ 850,00 · sin cambio»), en lugar de «de $ 850,00 a $ 850,00».

**Desactivar (IS-26):** si el stock no es cero, el diálogo dice «Primero ajustá el stock a cero» y ofrece «Ajustar stock»; con stock cero pide confirmación. No se borra nunca (P-014). «Activar» es directo; si la categoría está desactivada, el servidor responde `CATEGORY_INACTIVE` y se muestra su mensaje.

## Ingreso o devolución (IS-08, IS-09, IS-23)

- Tipo: «Ingreso» o «Devolución» (`register_stock_entry` con `p_kind`).
- Buscador de artículos activos (código o nombre); cada línea con cantidad (entero mayor a cero) y costo unitario opcional. Muestra el stock y el costo actuales de cada artículo.
- Proveedor, remito o factura y observación: opcionales.
- **Regla de `update_cost` (IS-23):** de las líneas con costo cargado, las que difieren del costo vigente generan, antes de confirmar, la pregunta «¿Actualizar el precio de costo de X a $ N?». Hay que contestar cada una («Sí, actualizar» manda `update_cost: true`; «No, dejar el actual» registra el costo en el movimiento y deja el precio vigente). Sin costo cargado, o igual al vigente, no se pregunta. El precio de venta solo se cambia desde la ficha.
- Al confirmar muestra el resumen: artículo, cantidad, costo unitario y **stock resultante**.

## Ajustar (IS-10)

Diálogo con «Sumar (+)» o «Restar (−)», cantidad entera, motivo obligatorio (Control de stock, Rotura, Vencimiento, Error de carga, Otro) y observación, obligatoria con «Otro». Antes de confirmar dice cómo va a quedar el stock; no deja restar más de lo que hay (el servidor igual lo corta con `INSUFFICIENT_STOCK`). Un ajuste no se anula: se corrige con otro ajuste.

## Categorías (IS-03)

Alta, edición del nombre, orden (subir y bajar; se renumeran 0, 1, 2…) y baja. La baja es una **desactivación** y se puede revertir con «Activar»; desactivar una categoría con artículos activos da `CATEGORY_IN_USE` con su mensaje. El nombre es único sin distinguir mayúsculas (`CATEGORY_NAME_EXISTS`).

## Movimientos (IS-18, IS-27)

Pestaña «Movimientos». Lee `v_stock_movements_admin` (una fila por línea) y agrupa por movimiento (`groupMovements`, `src/features/stock/movements.ts`).

- **Filtros** (los aplica el servidor): fechas desde y hasta (días de Argentina), tipo, persona (empleados y coordinadores, también los dados de baja), artículo, cliente y sede (acotada al cliente elegido). «Limpiar filtros» los vuelve a «todos».
- **Cada movimiento** muestra tipo, fecha y hora, quién lo registró, la persona que retira (con enlace a la pestaña «Retiros» de su ficha), el turno o la sede, proveedor, comprobante, motivo del ajuste y observación, y una lista de líneas: artículo (con enlace a su ficha), cantidad con signo, **costo y venta unitarios guardados** (IS-22) y el stock resultante. Al pie, el costo y la venta totales del movimiento.
- **«Anulado»:** etiqueta tachada, con «Anulado por X: motivo» (IS-27). El contramovimiento aparece como un movimiento «Anulación» con la marca «Anula otro movimiento».
- **«Anular»:** solo con «Gestionar stock» y solo en ingresos, devoluciones y retiros que no estén anulados (`canVoidMovement`). Diálogo con **motivo obligatorio** que explica el efecto (un retiro: las cantidades vuelven al stock; un ingreso o una devolución: se descuentan, y si ya se usaron el servidor responde `VOID_INSUFFICIENT_STOCK`). Los errores del servidor se muestran con su mensaje y el diálogo queda abierto. Los ajustes, los controles y las anulaciones no se anulan.
- **«Exportar a Excel»:** baja **todo lo filtrado**, no solo las 500 líneas que se ven (`fetchAllStockMovements`, de a páginas de 1000). Una fila por línea con fecha, tipo, estado y motivo de la anulación, persona, quién registró, cliente, sede, turno, proveedor, comprobante, motivo del ajuste, observación, código, artículo, presentación, cantidad, costo y venta unitarios y totales, y stock resultante. Los pesos van como número con formato de moneda. Archivo: `movimientos-insumos-AAAA-MM-DD.xlsx`.
- Tope de 500 líneas en pantalla, con un aviso para acotar los filtros. Polling de 60 s.

## Excel (IS-18, IS-24)

`src/features/stock/excel.ts` arma el libro con **ExcelJS** y lo baja con un enlace temporal. ExcelJS (~950 kB) se carga con `import()` recién al tocar el botón: queda en su propio chunk (`vendor-excel`, `vite.config.ts`) y **fuera del precache de la PWA** (`globIgnores`), igual que `vendor-media`, para que no viaje a los celulares. Pasó de `devDependencies` a `dependencies` en `package.json` porque ahora lo usa la app. Las columnas de cada Excel están en `exportSheets.ts`.

## Retiro en nombre de (IS-11, IS-12, IS-13)

`/admin/insumos/retiro`, con «Gestionar stock». El formulario del celular con selector de persona:

- **Quién retira:** empleados y coordinadores activos (con su rol al lado).
- **Para qué:** «Un turno» o «Una sede». Con sede la **observación es obligatoria** («por ejemplo, reposición de la semana»).
- **Opciones (IS-35, P25.5):** esta pantalla lee las vistas de administración, que no dependen de los roles de quien carga: `v_withdrawal_shift_options_admin` (todos los turnos de -30 a +7 días, con su estado, los empleados asignados y los coordinadores) y `v_withdrawal_site_options_admin` (sedes activas de clientes activos). Sin «Gestionar stock» las vistas devuelven cero filas.
- **Turnos de la persona primero:** al elegir quién retira, los turnos donde está asignada (empleado) o que coordina (coordinador) pasan arriba, con «es su turno» al final del rótulo, y el resto sigue disponible: no se oculta ninguno. Los cancelados se rotulan «cancelado» (el servidor los rechaza con `SHIFT_NOT_AVAILABLE`). La lógica está en `orderShiftsForPerson` (`withdrawal.ts`).
- **Errores del servidor:** un turno fuera de la ventana (`SHIFT_NOT_ALLOWED`), una sede no elegible (`SITE_NOT_ALLOWED`) y los demás códigos del retiro se muestran con el texto del servidor; si llegara vacío, con el mensaje de `STOCK_ERROR_MESSAGES`.
- **Artículos y cantidades:** solo artículos activos con stock. Antes de mandar avisa si una cantidad supera el stock («No alcanza el stock: hay N»); el servidor igual lo corta con `INSUFFICIENT_STOCK` y bloquea las filas, así dos retiros simultáneos no dejan stock negativo.
- Llama a `register_withdrawal` con `p_person_id`. El retiro queda a nombre de la persona, con quien lo cargó como «registró». El stock se descuenta en el momento (no hay aprobación).
- **Resumen** al terminar: quién retiró, cuándo, para qué y los artículos con sus cantidades (el servidor no devuelve precios ni stock resultante en un retiro).

## Faltantes (IS-29, IS-30)

Pestaña «Faltantes». Lee `supply_shortage_reports` (con quién avisó, el artículo, el turno y la sede). **Abiertos primero**, y en cada estado el más reciente arriba. Cada aviso muestra quién avisó y cuándo, el artículo (con enlace a su ficha) o la descripción libre con la etiqueta «No está en el catálogo», el turno o la sede y el comentario. «Resolver» pide una **nota obligatoria** (`resolve_supply_shortage`) y lo puede hacer cualquier dueño o administrador, **aunque no tenga «Gestionar stock»**. Los resueltos muestran quién, cuándo y la nota. Polling de 60 s.

## Consumo por cliente (IS-24)

Pestaña «Consumo por cliente». Período (por defecto el mes en curso, del 1 hasta hoy; atajos «Este mes» y «Mes anterior»), cliente y sede. Lee `v_supply_consumption_by_client`, que ya descuenta los retiros anulados y usa los precios guardados en cada línea. Muestra el total del período y, por cliente y por sede, las unidades y los totales **a costo y a venta**; cada sede lleva un chevron (que gira al abrirse, con `aria-expanded`) y tocarla despliega el **detalle por artículo** (`buildConsumptionReport`, suma en centavos). «Exportar a Excel» baja las filas del período (una por día, sede y artículo). Las fechas «Desde» y «Hasta» miden lo necesario para mostrar «26 de octubre de 2026» entero (a todo el ancho en el celular).

## Planilla imprimible de control (IS-15, IS-17)

«Imprimir planilla» en Stock (solo con «Gestionar stock»). Un diálogo pregunta la **categoría** (opcional; arranca con la que ya está filtrada en la tabla) y abre la vista previa de `PrintSheet`:

- **Encabezado:** membrete (`PrintableLetterhead`) con el título «Planilla de control de stock», la fecha, «Revisó: ____» y la categoría si se filtró.
- **Filas:** solo artículos activos, con el mismo orden que la tabla de Stock (`controlSheetItems`). Columnas: código, artículo, presentación, **stock del sistema**, «Contado» (en blanco), casillero para tildar, «+ / −» (en blanco) y «Observación» (en blanco). Cada fila mide 9 mm para escribir a mano. Con todas las categorías, una fila separadora por categoría.
- **Pie:** observaciones generales (cuatro renglones), firma, aclaración y fecha. El pie no se parte entre hojas y **no queda solo**: las últimas tres filas de la tabla van en el mismo bloque (`data-print-signatures`, sin cortes) y pasan juntas a la hoja siguiente. Con tres artículos o menos no se parte la tabla.
- **A4 vertical:** las columnas suman 180 mm (el ancho útil con márgenes de 15 mm) y `print.css` repite el encabezado de la tabla en cada hoja.

## Cargar control y Controles (IS-16, IS-31)

`/admin/insumos/control`, con «Gestionar stock».

- **Encabezado:** día y hora del control (por defecto, ahora, en hora de Argentina; no futura), **revisor** («Una persona de la app» o «Un nombre escrito»: uno solo, nunca los dos) y observaciones.
- **Aviso:** la diferencia se calcula contra el **stock del sistema a la hora del control** (el actual menos los movimientos posteriores), así un retiro hecho entre el conteo y la carga no se toma como faltante.
- **Filas:** una por artículo activo (con buscador y filtro de categoría), con el stock actual de referencia y un campo «Contado». **En blanco significa no tocar** (no se manda); el cero es un conteo válido. Si el control es de hace más de un minuto, se consultan los movimientos desde ese día y cada artículo avisa «Tuvo 2 movimientos después de esa hora; se tienen en cuenta», con el «stock del sistema a esa hora» calculado. Si hubo más de 500 líneas desde ese día, el aviso se marca como posiblemente incompleto (el servidor calcula con todos igual).
- **Al confirmar** (`register_stock_count`): resumen con stock del sistema, contado y diferencia por artículo. Las diferencias distintas de cero quedan como un solo movimiento «Control de stock».
- **Pestaña «Controles»:** historial (`v_stock_counts_admin`): fecha y hora del conteo, quién revisó, quién lo cargó y cuándo, observaciones, cuántos artículos se contaron y el detalle de las diferencias.

## Pestaña «Retiros» de la ficha (IS-18)

En la ficha del empleado y en la del coordinador (la misma pantalla, `ADM-17`), solo para dueño y administradores. Por defecto el mes en curso (con fechas y atajos). Lista los retiros de la persona (también los que la oficina cargó a su nombre, con «Lo cargó X»): fecha y hora, turno o sede, observación, artículos y cantidades, «Anulado» con su motivo, y el **total a venta del período**, sin contar los retiros anulados. Empleados y coordinadores nunca ven precios (IS-20).

## Resumen (IS-30)

Dos tarjetas debajo de los indicadores de hoy (`StockCards`), con el estilo de `KpiCard`:

- **«Faltantes avisados»:** cuenta por artículo (un artículo con varios avisos cuenta uno, IS-29; `open_shortages`) y debajo dice cuántos avisos hay (`open_reports`). Amarilla si hay alguno. Lleva a `/admin/insumos?pestana=faltantes`.
- **«Stock bajo»:** el valor suma los sin stock y los bajo mínimo; el detalle dice «N sin stock · M bajo mínimo». Roja si hay sin stock, amarilla si solo hay bajo mínimo. Lleva a `/admin/insumos?filtro=aviso` (Stock con «Solo con aviso»).

Si el contador falla, las tarjetas no se muestran y el Resumen sigue igual.

## Formatos

Pesos con dos decimales y separadores argentinos (`$ 1.234,50`, `src/features/stock/money.ts`); los precios se escriben como texto (`1250,50`, `1.250,50` o `1250.5`) y se rechazan los negativos y los de más de dos decimales. Fechas y horas en hora de Argentina (ADR-019) con `src/lib/format.ts`.

## Código

- API: `src/api/stock.ts` (ver [`api.md`](../api.md), «stock»).
- Esquemas: `src/features/stock/schemas.ts`. Hooks: `src/features/stock/queries.ts` (claves `['stock', ...]`).
- Lógica pura: `filters.ts` (filtros, orden, colores, total, orden de categorías), `labels.ts`, `money.ts`, `permissions.ts`, `image.ts`, `tabs.ts`, y de P25.3: `movements.ts` (agrupar, cuándo anular, filtros), `count.ts` (control: fecha y hora, revisor, filas en blanco, movimientos posteriores), `consumption.ts`, `controlSheet.ts`, `withdrawal.ts`, `personWithdrawals.ts`, `excel.ts` y `exportSheets.ts`.
- Pantallas: `src/features/stock/components/` y las páginas de `src/pages/admin/` (`StockPage`, `SupplyDetailPage`, `SupplyFormPage`, `StockEntryPage`, `StockWithdrawalPage`, `StockCountPage`). Tarjetas del Resumen: `src/features/dashboard/components/StockCards.tsx` y `stockCards.ts`. Número de la barra: `src/app/shells/NavBadge.tsx`.

## Pruebas

`src/api/stock.test.ts` (errores, lecturas, imagen y alta, ingreso con `update_cost`, ajuste); `src/features/stock/*.test.ts` (esquemas, filtros y colores, dinero, permisos, pestañas, imagen, etiquetas); `src/features/stock/components/*.test.tsx` (tabla con colores, filtros, ocultamiento por capacidad y tarjetas a 390 px; ajuste; ingreso y pregunta de costo; ficha y desactivar; formulario de artículo; categorías; movimientos; precios); `src/app/shells/adminNav.test.ts` y `AdminShell.test.tsx` (número de avisos). De P25.3: `src/api/stockControl.test.ts`; `movements`, `count`, `consumption`, `withdrawal`, `controlSheet`, `personWithdrawals`, `excel` (abre el `.xlsx` que se genera) y `exportSheets`; los componentes de Movimientos, Faltantes, Consumo, Controles, Cargar control, Retiro en nombre de, la planilla (`ControlSheet`, `ControlSheetAction`), la pestaña «Retiros», los botones de Stock por permiso y el historial de precios; y `StockCards` en el Resumen. Las e2e son de P25.5.

## Decisiones menores

- Páginas y no drawers para alta, edición, ficha e ingreso (P-094: en celular los drawers pasan a página).
- El filtro de texto incluye la presentación además del código y el nombre.
- Un artículo inactivo no se pinta de rojo ni cuenta como «con aviso».
- Contestar la pregunta de costo es obligatorio (no hay respuesta por defecto).
- Desactivar y activar una categoría no pide motivo ni confirmación (es reversible).
- **Historial de precios (P25.3):** `describePriceChange` compara en centavos y muestra «sin cambio» cuando el valor no varió.
- El número junto a «Insumos» cuenta **avisos** (`open_reports`); la tarjeta «Faltantes avisados» cuenta **artículos** (`open_shortages`, IS-29) y muestra los avisos en el detalle.
- «Retiro en nombre de» y «Cargar control» tienen pantalla propia (páginas, no drawers, P-094). «Cargar control» no pide una confirmación aparte: el botón «Confirmar control» es la confirmación y el resultado se muestra enseguida.
- El revisor «persona de la app» se elige entre los usuarios activos (dueño, administradores, coordinadores y empleados) y no tiene valor por defecto, para no atribuir un control a quien lo carga sin querer.
- «Retiro en nombre de» usa las vistas `_admin` (IS-35, P25.5): ofrecen siempre los turnos de -30 a +7 días y todas las sedes activas, sin importar si quien carga además es empleado o coordinador. Las vistas sin `_admin` quedan para el celular.
