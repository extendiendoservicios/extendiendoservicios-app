# P30.3a · Resumen, «volver al lugar», Servicios y Clientes (administración)

Frontend de OH-01, OH-02, OH-03, OH-12, OH-13 y OH-14. No hay migraciones. Se apoya en las piezas de P30.2 (`DataTable` con alto acotado, ancho de columnas y orden; `DatePicker clearable`; `useSearchParamState`; `useBackTo` y `BackLink`).

## OH-01 y OH-02 · «Servicios de hoy» (Resumen)

`ServicesTodayTable` pasa `maxHeight` de `calc(2.5rem + 10 * 3.5rem)` (encabezado más 10 filas con avatar, de unos 3,5 rem cada una; las filas con estado que se parte en dos líneas pueden ser más altas). El encabezado queda fijo y la tabla se desplaza dentro del bloque. También lleva `resizableColumns` y `persistKey="resumen-servicios-hoy"` (anchos y orden se recuerdan en el navegador). El formato visual no cambia.

Orden por encabezado (ascendente, descendente, sin orden): Empleado (apellido y nombre), Cliente · sede, Horario (texto `HH:MM-HH:MM`), Inicio real, Estado, Horas y Salida anticipada. En Inicio real, Horas y Salida anticipada las filas sin dato quedan siempre al final (`sortUndefined: 'last'`). El Estado se ordena por urgencia (`statusSortKey` en `servicesToday.ts`: sin fichar, ausencia avisada, llegada tarde, sin salida, demora avisada, en camino, salida anticipada, presente, finalizado, cancelado) y no por orden alfabético. Validación y Acciones no se ordenan.

## OH-03 · Volver a donde se estaba

El estado de pantalla vive en la dirección, con `replace` (no apila historial) y quitando el valor por defecto:

| Pantalla                        | Parámetros                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| Planificación, mes              | `mes=2026-12` (más los filtros `cliente`, `sede`, `empleado`, `estado` que ya estaban) |
| Planificación, semana           | `semana=2026-11-16` (lunes)                                                            |
| Planificación, día              | `fecha` (ya estaba)                                                                    |
| Clientes                        | `estado`, `categoria`, `q`                                                             |
| Empleados                       | `q`, `rol`, `estado`, `cliente`, `orden` (`rating` o `-rating`), `pagina`              |
| Insumos, Consumo por cliente    | `consumo_desde`, `consumo_hasta`, `consumo_cliente`, `consumo_sede`                    |
| Ficha del empleado, Retiros     | `retiros_desde`, `retiros_hasta`                                                       |
| Ficha del coordinador, Jornadas | `jornadas_mes=2026-11`                                                                 |

El caso que reportó la dirección (el calendario volvía al mes actual al abrir un turno y volver) era porque el mes y la semana eran un `useState`: al abrir `/admin/turnos/:id` la pantalla se desmontaba y perdía el mes. Ahora el mes está en la dirección y «Volver» usa `navigate(-1)`.

Un valor inválido en la dirección (editada a mano) cae en el valor por defecto. Los buscadores (`useUrlSearchText`) responden al instante con estado local y escriben en la dirección con antirrebote de 300 ms; si la dirección cambia desde afuera (atrás o adelante del navegador) el campo la sigue. Para cambiar varios parámetros juntos (período desde/hasta, cliente y sede) está `useSearchParamsPatch`: una sola navegación sobre la dirección vigente.

«Volver»:

- `ShiftDetailPage` y `SupervisionDetailPage` cierran con `useBackTo` (antes repetían la lógica a mano).
- Los enlaces «Volver a Insumos / Stock», «Volver a los anuncios» y los «Cancelar» de los formularios de insumos (artículo, ingreso, control, retiro en nombre de) pasan a `BackLink`: vuelven a la página anterior tal cual estaba y, si se entró directo por la dirección, a la pantalla de respaldo.
- Guardar el formulario de un artículo: al editar vuelve a donde se estaba, al crear reemplaza el formulario por la ficha (`useLeaveForm`). Cancelar y «Volver al anuncio» del formulario de anuncios usan `useBackTo`.

## OH-12 · «Vigente hasta» que se borra

`DatePicker` ya tenía `clearable`. Se verificó el camino completo: la ✕ llama `onValueChange(undefined)`, el formulario lo guarda como `''`, `serviceInputFromFormValues` lo convierte en `null` y `updateService` manda `valid_to: null` (una columna con `null` explícito se pone en `NULL`). Como `apply_service_changes` y `preview_service_changes` leen el servicio ya guardado, ven «sin fin». `serviceChangesCanAddShifts` cuenta el cambio de vigencia (con fecha → sin fecha) y la pantalla pide la vista previa con `p_create_missing = true`. No hizo falta cambiar código; se agregaron las pruebas.

## OH-13 · Categoría en la edición del cliente

La casilla «Categoría (opcional)» quedaba vacía aunque el cliente tuviera categoría. La causa: el `Select` de Radix avisa un valor vacío (`onValueChange('')`) cuando el valor cargado todavía no tiene su ítem (las categorías llegan por una consulta aparte), y el formulario lo guardaba, pisando la categoría. Ahora se ignora el valor vacío y el texto de la casilla se arma con la categoría seleccionada (`SelectValue` con contenido propio). Prueba: `ClientFormPage.category.test.tsx` (categorías antes o después del cliente, y sin categoría).

## OH-14 · Categorías que se contraen (Clientes)

Cada categoría del listado lleva un botón (con `aria-expanded` y `aria-controls`) con una flechita (`ChevronDown` abierta, `ChevronRight` contraída), el nombre y el número de clientes. Tocar el nombre o la flecha contrae o despliega ese grupo, tanto en tabla como en tarjetas (se deja de dibujar el `DataTable` del grupo). Arriba del listado, «Contraer todo» y «Desplegar todo» (cada uno se deshabilita si no tiene efecto). Lo contraído se recuerda en `localStorage` (`clients:collapsed-categories`, lista de ids de categoría y `none` para «Sin categoría»); si el almacenamiento falla, la pantalla anda igual sin recordar (`useCollapsedGroups`).

## Pruebas

`ServicesTodayTable.test.tsx`, `ClientsPage.test.tsx`, `EmployeesPage.test.tsx`, `ShiftDetailPage.test.tsx`, `ClientFormPage.category.test.tsx`, `ServiceFormPage.validTo.test.tsx`, `serviceChanges.test.ts`, `MonthCalendar.test.tsx`, `WeekGrid.test.tsx`, `ConsumptionTab.test.tsx`, `useUrlSearchText.test.tsx` y `useSearchParamsPatch.test.tsx`.
