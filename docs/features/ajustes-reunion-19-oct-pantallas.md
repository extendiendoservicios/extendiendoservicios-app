# Ajustes de la reunión del 19 de octubre: pantallas de administración (P19.11d)

Pantallas de administración sobre las migraciones `0059` y `0060`. En la
interfaz «Planificación» se llama «Calendario» y «Supervisor» se llama
«Coordinador» (P19.11b).

## 1. «Ausente» con certificado en el detalle del turno

- En el apartado de cada empleado asignado (ADM-06) hay un botón «Ausente»
  cuando corresponde: el turno no está cancelado ni finalizado, la asignación
  no tiene fichaje de inicio ni una ausencia ya avisada, y quien mira tiene
  `manage_attendance` (el dueño siempre).
- Abre un popup: «Con certificado» o «Sin certificado» (hay que elegir) y el
  motivo opcional, con los mismos motivos de la lista; si es «Otro», el
  detalle es obligatorio. Llama a `notify_absence` con `p_has_certificate`.
  `src/features/attendance/components/MarkAbsentDialog.tsx`.
- La acción «Ausencia» de «Registrar en nombre» usa el mismo formulario
  (`AbsenceNoticeForm.tsx`), así que también exige el certificado.
- Si la asignación ya tiene una ausencia avisada (la cargó el empleado o
  administración), en lugar de «Ausente» se ve «Ausente · con certificado»,
  «Ausente · sin certificado» o «Ausente · certificado sin indicar», con la
  acción «Cambiar» o «Marcar certificado» (`set_absence_certificate`,
  `AbsenceCertificateDialog.tsx`). El dato sale de
  `last_notice_has_certificate` de `v_assignments_board`.
- El certificado también se ve en la pestaña «Asistencia» de la ficha del
  empleado (columna «Aviso»), en la línea de tiempo del turno y debajo del
  estado en «Asistencia de hoy». No se agregó a la hoja del cliente: el dato es
  de uso interno.
- Errores mapeados (`src/features/attendance/absenceErrors.ts`):
  `CERTIFICATE_REQUIRED` (se marca el campo), `TOO_LATE_TO_NOTIFY`,
  `FORBIDDEN`, `NO_ABSENCE`; el resto muestra el mensaje del servidor.
- La línea de tiempo ya no muestra los avisos anulados (`voided_at`) por un
  cambio de fecha.

## 2. Imprimible «Licencias y ausencias»

- En la pestaña «Licencias» de la ficha, el botón «Imprimir licencias y
  ausencias» (solo dueño y administradores) pide el período (desde y hasta; por
  omisión el año en curso) y abre la hoja con la misma vista previa de los
  demás imprimibles (logo, «Editar texto», imprimir o guardar como PDF).
- Licencias: desde, hasta (o «Abierta»), motivo y días dentro del período.
  Una licencia abierta cuenta hasta hoy. Las vacaciones no son un tipo aparte:
  son licencias con motivo libre.
- Ausencias a turnos: fecha, cliente, sede, horario, motivo, con o sin
  certificado y quién la cargó. Salen de `v_assignments_board` (ausencias
  avisadas de turnos no cancelados y con asignación vigente): no hizo falta una
  vista nueva. No incluye las inasistencias sin aviso.
- Archivos: `leavesAbsencesSheet.ts` (armado de las tablas),
  `LeavesAbsencesSheet.tsx`, `LeavesAbsencesPrintAction.tsx`.

## 3. Clientes y sedes inactivos fuera de lo nuevo

Al crear un turno (ADM-07) y un servicio (ADM-24 y formulario de servicio) no se
ofrecen clientes suspendidos ni dados de baja ni sedes inactivas
(`src/features/clients/pickerOptions.ts`). Al editar un servicio se conserva el
cliente y la sede vigentes. En los filtros de listados siguen apareciendo.

## 4. Las licencias bloquean

- `ON_LEAVE` es un error de `assign_employee` y aparece en `rejected[]` de
  `create_shift` y `create_shift_series` y en `unassigned[]` de
  `generate_shifts`, con el nombre y el mensaje del servidor.
- En «Nuevo turno» el selector de empleados deshabilita a quien está de licencia
  el día elegido («De licencia»). Si ya lo habían elegido y cambian la fecha, se
  lo saca de la selección y se avisa. En una repetición, quien tiene licencia
  solo en parte del período se puede elegir, con el aviso «Licencia en parte del
  período»; en esas fechas el servidor no lo asigna.
- En «Asignar empleado» los candidatos de licencia no se pueden elegir.
- Al guardar una licencia (alta o edición) se llama a `get_leave_conflicts` y,
  si hay turnos ya asignados en el período, se muestra el aviso con la lista
  (fecha, horario, cliente y sede) y un enlace «Abrir turno» para reasignarlos.
  No se desasigna nada.

## 5. Fecha editable del turno

- En «Editar turno» (ADM-07) hay un selector de fecha, solo si el turno está
  programado o con personal asignado; si ya empezó o terminó se ve la fecha de
  solo lectura. No se puede elegir una fecha anterior a hoy.
- Si cambia la fecha, antes de guardar se llama a `get_shift_date_warnings`:
  feriado y personal fuera de su disponibilidad se muestran en un diálogo de
  confirmación («Mover igual»). Después, `update_shift_time` con `p_date`.
- La pantalla explica siempre que al mover de día se limpian los avisos de
  demora y ausencia.
- Errores mapeados: `SHIFT_STARTED`, `SHIFT_DATE_IN_PAST`, `SHIFT_DATE_TAKEN`;
  `ON_LEAVE` y `ASSIGNMENT_OVERLAP` muestran el mensaje del servidor (trae el
  nombre).
- Al guardar se invalidan turnos, calendario y asistencia y se lleva al usuario
  al día nuevo del calendario.

## 6. Calendario semanal (ADM-04)

`WeekGrid.tsx`: tabla de ancho completo con columnas fijas (`table-fixed`): la
de empleados de 144 px y los 7 días se reparten el resto, con el texto recortado
con puntos suspensivos (el texto completo queda en el título). Si no entra
(menos de 760 px), el contenedor desplaza en horizontal, con la columna de
empleados y el encabezado fijos y alto máximo, para que la barra de
desplazamiento quede siempre a la vista.

Ancho de contenido con el menú lateral (236 px abierto, 60 px cerrado) y 52 px
de márgenes:

| Pantalla | Menú abierto              | Menú cerrado    |
| -------- | ------------------------- | --------------- |
| 1024 px  | 736 px (desplaza un poco) | 912 px (entra)  |
| 1280 px  | 992 px (entra)            | 1168 px (entra) |
| 1366 px  | 1078 px (entra)           | 1254 px (entra) |
| 1440 px  | 1152 px (entra)           | 1328 px (entra) |

### Revisión visual (chip del horario)

El horario del chip es el dato principal y nunca se recorta: va en su propia
línea con `whitespace-nowrap` y cifras de ancho fijo (`tabular-nums`) en 10,5 px
(unos 62 px). El relleno de la celda baja a 4 px por lado y el del chip a 4 px:
en una celda de 88 px quedan 72 px útiles. «A terminar» se parte en dos líneas
completas («10:00–» y «A terminar»). Solo la sede se recorta con puntos
suspensivos (el texto completo queda en el título del chip).

## 6 bis. Calendario del día (ADM-05)

`ShiftsDayList.tsx`, desde 1024 px: la tabla entra en el ancho sin desplazar.

- Relleno de celdas de 8 px (antes 14 px) y columnas más angostas: horario
  6,25 rem, dotación 5,5 rem, estado 6,75 rem, acciones 7,5 rem; cliente · sede
  19 %, asignados 13 %, coordinador 12 % (recortados con puntos suspensivos y
  título).
- Acciones solo con ícono (Ver, Editar, Cancelar) con `aria-label` y `title`:
  mismos nombres accesibles que antes.
- Respaldo: contenedor con alto máximo y desplazamiento interno, y ancho mínimo
  de 44 rem (704 px), menor que los 736 px de 1024 px con el menú abierto.
- Ancho de contenido (menú abierto / cerrado): 1024 px: 736 / 912; 1145 px:
  857 / 1033; 1280 px: 992 / 1168; 1366 px: 1078 / 1254. En todos entra.
- En celular se mantiene la vista de tarjetas con botones de texto.
