# Turno nuevo desde el calendario del empleado (P33.1)

Pestaña «Calendario» de la ficha del empleado: el «+» de cada día abre un menú con dos opciones.

- **Agregar turno**: lleva a `/admin/turnos/nuevo?fecha=AAAA-MM-DD&empleado={profileId}&volver={ficha}`. Solo se ofrece si la persona puede administrar turnos (`canManageShiftTime`); si no, el «+» abre directo la observación.
- **Agregar observación**: el diálogo de siempre.

Etiqueta accesible del botón: «Agregar un turno o una observación el {fecha}» (sin permiso de turnos sigue siendo «Agregar una observación el {fecha}»).

## «Nuevo turno» con `empleado` y `volver`

- `?empleado=`: se precarga una sola vez, cuando llegan los empleados activos, en «Empleados». Se puede sacar o sumar otros. Si no está entre los activos, se ignora. El bloqueo por licencia y el recorte por dotación siguen igual.
- `?volver=`: solo se acepta si empieza con `/admin/empleados/` y no tiene `//`, `\` ni caracteres de control (`safeReturnPath`, `src/features/shifts/returnPath.ts`). Con `volver` válido, guardar (turno único, serie, turno pasado) y «Cancelar» vuelven a esa dirección, reemplazando la entrada del historial. La dirección lleva `pestana=calendario&mes=AAAA-MM`, así que se vuelve al mismo mes. Sin `volver`, todo sale como antes.
- Al crear se invalidan `shifts` y `planning`, por eso el turno ya se ve al volver.

Sin migraciones.
