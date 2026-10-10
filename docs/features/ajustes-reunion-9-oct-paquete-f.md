# Ajustes de la reunión del 9 oct 2026 · paquete F (P19.6)

Un ajuste: **AJ2-17**, asignar empleados al crear un turno suelto y cargar
«empleados fijos» en el servicio. La base está en la migración `0041` (ver
`docs/database.md`); acá va la parte de pantallas.

## Decisión de Mike

- **Turno suelto:** al crearlo («Nuevo turno») se eligen los empleados y quedan
  asignados en la misma operación.
- **Servicio:** se le cargan «empleados fijos», que se asignan solos en cada
  turno que genera la generación mensual.

## Nuevo turno (ADM-07, alta)

`/admin/turnos/nuevo` suma el campo **Empleados (opcional)**.

- Selector múltiple con búsqueda por nombre o legajo, solo empleados activos
  (estado guardado, igual que los candidatos de la asignación manual: quien
  está de licencia hoy puede figurar para un turno futuro). Muestra nombre y
  legajo, y los elegidos quedan como chips que se pueden quitar.
- **Tope = dotación del turno.** Al llegar, las filas sin elegir quedan
  deshabilitadas y se avisa debajo. Si después se baja la dotación, se recorta
  lo elegido de más.
- Se manda como `p_employee_ids`. El turno se crea siempre.
- **Después de crear:**
  - Si hay `rejected`: aviso (toast de advertencia, 20 s) «Creamos el turno, pero
    a N personas no se las pudo asignar:» con una línea por empleado
    («Beto Gómez: <message del servidor>»).
  - Si hay advertencias en `assigned`: una línea por empleado con los mismos
    textos de la asignación manual (`WARNING_MESSAGES` de `AssignEmployeeSheet`).
  - Si no hay nada que avisar: «Creamos el turno y asignamos a los empleados.»
    (o el aviso de feriado de siempre).
  - En todos los casos se navega a la planificación del día.

## Servicio (ADM-25)

Sección **Empleados fijos** con el mismo selector (tope = dotación del
servicio) y la ayuda «Se asignan solos en cada turno que se genere. No cambia
los turnos ya generados.»

- **Alta:** se crea el servicio y después se llama a
  `set_service_fixed_employees` con el id nuevo. Si esa segunda llamada falla,
  el servicio ya existe: aviso y se pasa a su edición para reintentar.
- **Edición:** se cargan los fijos actuales (`service_fixed_employees`). Solo se
  llama a la RPC si la lista cambió, y nunca si falló la lectura (para no pisar
  nada). Orden: si la dotación **baja**, primero se guardan los fijos y después
  el servicio (el servidor no deja bajar la dotación por debajo de los fijos);
  si **sube** o queda igual, primero el servicio.
- **`FIXED_EXCEEDS_STAFF`:** se controla en el formulario (mensaje inline
  «Los empleados fijos no pueden ser más que la dotación del servicio (N).») y
  el servidor lo vuelve a verificar, tanto en la RPC como al bajar
  `required_staff` en el `update` del servicio; se muestra su `message`.
- Un fijo que ya no está activo aparece como «Empleado que ya no está activo»
  para poder sacarlo.
- No se mostraron los fijos en el listado de servicios (no recargar la tabla).

## Generar turnos (ADM-09)

El resultado suma:

- «Además, N asignaciones de empleados fijos.»
- Si hay `unassigned`: aviso con la lista (`dd/mm · Cliente · Sede · Servicio ·
Empleado: motivo`, ordenada por fecha). El servicio, cliente y sede se
  resuelven con una consulta chica a `services` (`fetchServiceLabels`); mientras
  carga se lee «Servicio». Los turnos se crearon igual; administración los
  asigna a mano.
- Si `pastWithoutFixed > 0`: «N turnos de días que ya empezaron quedaron sin los
  empleados fijos.»

## Código

- `src/api/shifts.ts`: `createShift` (con `employeeIds`) y `generateShifts`
  traducen los resultados nuevos. `src/api/services.ts`:
  `fetchServiceFixedEmployees`, `setServiceFixedEmployees`, `fetchServiceLabels`.
  `src/api/employees.ts`: `fetchActiveEmployeeOptions`.
- `src/features/shifts/assignOnCreate.ts`: lógica pura (tope, textos de
  rechazados y advertencias, resumen de la generación).
- `src/features/planning/components/EmployeeMultiPicker.tsx`: el selector.
- `src/lib/database.types.ts`: editado a mano (`service_fixed_employees`,
  `create_shift.p_employee_ids`, `set_service_fixed_employees`); se regenera
  contra `App_dev` y gana lo generado.
- Al crear un turno o generar se invalidan también las consultas de
  planificación.

## Pruebas

`src/features/shifts/assignOnCreate.test.ts` (tope, mensajes de rechazados,
resumen de generación), `src/api/shifts.test.ts` y `src/api/services.test.ts`.
