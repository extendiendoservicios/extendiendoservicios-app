# Insumos y control de stock en administración: Stock, ficha, ingreso, ajuste y categorías (módulo E, P25.2)

Primeras pantallas de la sección «Insumos» (`/admin/insumos`). Especificación: `Docs/Plan_Maestro/modulos/E_insumos_y_stock.md` (IS-01 a IS-34). Contrato de la base: [`database.md`](../database.md), «Insumos y control de stock». Lo de P25.3 (Movimientos, Faltantes, Consumo por cliente, Controles, anulación, «Cargar control», planilla, retiro en nombre de, tarjetas del Resumen) y lo del celular (P25.4) no está acá.

## Quién ve qué (IS-19, IS-21)

| Quién                               | Ve                                                                          | Puede                                                                                                                                                    |
| ----------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dueña                               | Todo                                                                        | Todo (la capacidad `manage_stock` la tiene implícita)                                                                                                    |
| Administrador con «Gestionar stock» | Todo                                                                        | Todo                                                                                                                                                     |
| Administrador sin «Gestionar stock» | Todo: stock, precios, fichas, historial de precios, movimientos, categorías | Nada que mueva stock ni edite el catálogo: sin «Ingreso», «Nuevo artículo», «Ajustar», «Editar», «Cambiar precios», «Desactivar» ni cambios de categoría |
| Empleado y coordinador              | Nada de esta sección (tienen su pestaña de celular, P25.4)                  | —                                                                                                                                                        |

La decisión es `canManageStock(actor)` (`src/features/stock/permissions.ts`), con el mismo criterio que `canManageAttendance`: dueño, o administrador con la capacidad. El servidor vuelve a verificar en cada RPC (`FORBIDDEN`). Quien entra por la URL a «Nuevo artículo», «Editar» o «Ingreso» sin la capacidad ve un mensaje que lo explica.

La capacidad se otorga en ADM-27 (solo el dueño), donde ya figura como «Gestionar stock» (P25.1).

## Rutas

| Ruta                                | Pantalla                                  | Pantalla (id) |
| ----------------------------------- | ----------------------------------------- | ------------- |
| `/admin/insumos`                    | Pestañas Stock (por defecto) y Categorías | `ADM-IS-01`   |
| `/admin/insumos?pestana=categorias` | Pestaña Categorías                        | `ADM-IS-01`   |
| `/admin/insumos/nuevo`              | Nuevo artículo                            | `ADM-IS-03`   |
| `/admin/insumos/:id`                | Ficha del artículo                        | `ADM-IS-02`   |
| `/admin/insumos/:id/editar`         | Editar artículo                           | `ADM-IS-03`   |
| `/admin/insumos/ingreso`            | Ingreso o devolución                      | `ADM-IS-04`   |

«Insumos» está en la barra lateral y en el menú «Más» del celular, después de «Tareas» (`src/app/shells/adminNav.ts`). En esta etapa no lleva el número de avisos abiertos (lo suma P25.3).

### Pestañas

`src/features/stock/tabs.ts` define la lista completa en el orden de IS-33: Stock, Movimientos, Faltantes, Consumo por cliente, Controles y Categorías. Una pestaña sin `component` no se muestra ni se puede abrir por la URL (`?pestana=` desconocido o todavía vacío cae en Stock). Para sumar una pestaña en P25.3 alcanza con completar su `component`; `StockScreen` arma las pestañas y la URL a partir de esa lista.

## Stock (IS-05, IS-24, IS-25)

- **Columnas:** imagen chica, código, artículo y presentación, categoría, stock, mínimo, costo, venta y valor a costo. Al pie, la cantidad de artículos y el **valor del stock a costo** de lo que se ve (con los filtros puestos suma solo lo filtrado).
- **Colores de fila:** amarillo (`bg-warning-bg`) si hay mínimo y el stock es igual o menor; rojo (`bg-danger-bg`) si el stock es cero, aunque no tenga mínimo. Siempre con una etiqueta de texto («Bajo mínimo», «Sin stock»), para no depender del color. La fuente es `status` de `v_stock_admin` (`ok`, `low`, `empty`).
- **Un artículo inactivo no marca aviso:** solo se desactiva con stock cero y ese cero no es un faltante (el Resumen tampoco lo cuenta). Se ve con la etiqueta «Inactivo» y sin color.
- **Filtros:** texto (código, nombre o presentación, sin distinguir mayúsculas ni tildes), categoría, «Solo con aviso» (amarillos y rojos) e «Incluir inactivos». Se aplican en pantalla sobre la lista completa que trae `fetchStockItems`.
- **Orden por defecto:** categoría (en el orden de la pestaña Categorías) y nombre; las columnas se pueden reordenar con el encabezado.
- **`?filtro=aviso`:** abre la pestaña Stock con «Solo con aviso» puesto. Es el enlace que usarán las tarjetas del Resumen (IS-30, P25.3).
- **Botones:** «Ingreso» y «Nuevo artículo» arriba; «Ajustar» y «Ficha» en cada fila.
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

Datos e imagen; «Editar»; «Cambiar precios» (diálogo con costo y venta; si no cambió nada no llama al servidor); **historial de precios** (cuándo, quién, de cuánto a cuánto de costo y de venta, y el origen: alta, cambio de precios o costo de un ingreso); «Ajustar»; «Desactivar» o «Activar»; y los **movimientos** del artículo con filtro de fechas (desde y hasta, días de Argentina): fecha y hora, tipo, cantidad con signo, stock resultante, persona, turno o sede, observación y la marca «Anulado» (con quién y por qué). La anulación se hace en Movimientos (P25.3): acá solo se muestra.

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

## Formatos

Pesos con dos decimales y separadores argentinos (`$ 1.234,50`, `src/features/stock/money.ts`); los precios se escriben como texto (`1250,50`, `1.250,50` o `1250.5`) y se rechazan los negativos y los de más de dos decimales. Fechas y horas en hora de Argentina (ADR-019) con `src/lib/format.ts`.

## Código

- API: `src/api/stock.ts` (ver [`api.md`](../api.md), «stock»).
- Esquemas: `src/features/stock/schemas.ts`. Hooks: `src/features/stock/queries.ts` (claves `['stock', ...]`).
- Lógica pura: `filters.ts` (filtros, orden, colores, total, orden de categorías), `labels.ts`, `money.ts`, `permissions.ts`, `image.ts`, `tabs.ts`.
- Pantallas: `src/features/stock/components/` y las páginas de `src/pages/admin/` (`StockPage`, `SupplyDetailPage`, `SupplyFormPage`, `StockEntryPage`).

## Pruebas

`src/api/stock.test.ts` (errores, lecturas, imagen y alta, ingreso con `update_cost`, ajuste); `src/features/stock/*.test.ts` (esquemas, filtros y colores, dinero, permisos, pestañas, imagen, etiquetas); `src/features/stock/components/*.test.tsx` (tabla con colores, filtros, ocultamiento por capacidad y tarjetas a 390 px; ajuste; ingreso y pregunta de costo; ficha y desactivar; formulario de artículo; categorías; movimientos; precios); `src/app/shells/adminNav.test.ts`. Las e2e son de P25.5.

## Decisiones menores

- Páginas y no drawers para alta, edición, ficha e ingreso (P-094: en celular los drawers pasan a página).
- El filtro de texto incluye la presentación además del código y el nombre.
- Un artículo inactivo no se pinta de rojo ni cuenta como «con aviso».
- Contestar la pregunta de costo es obligatorio (no hay respuesta por defecto).
- Desactivar y activar una categoría no pide motivo ni confirmación (es reversible).
