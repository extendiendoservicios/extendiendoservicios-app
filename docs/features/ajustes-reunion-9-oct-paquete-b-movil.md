# Ajustes de la reunión del 9 oct 2026, paquete B: celular (AJ2-09, AJ2-10)

Parte de las vías móviles (empleado y supervisor). La base está en las migraciones 0037 y 0038; la parte de administración va en otra rama.

## Qué cambia en pantalla

### Empleado (`/app`)
- **Turno «A terminar»:** en Hoy, próximos días, detalle del servicio, avisar, Fichar (elegir servicio, consentimiento y Registrar inicio) la franja sale `08:00–A terminar`; nunca 23:59. Usa `effective_open_ended` de `v_my_day` (manda sobre el turno: una franja propia con fin deja de ser «A terminar»).
- **Detalle del servicio:** sin duración prevista en un turno «A terminar».
- **En curso:** en vez de «fin previsto» dice «registrá la salida cuando termines».
- **Finalizar:** no aparece el aviso «salida antes del horario previsto» en un turno «A terminar».
- **«Sin salida»:** si `v_my_day.no_checkout` es verdadero (pasaron las 23:59 sin fichar la salida), la asignación muestra la insignia «Sin salida» y el aviso «el día de este turno ya terminó, avisale a tu supervisor o a la oficina para que carguen la salida»; Fichar no la ofrece, y En curso y Finalizar redirigen al detalle. Tampoco se ofrece «Estoy en camino».
- **Error `OPEN_SHIFT_DAY_ENDED`:** si igual se intenta fichar la salida, se muestra ese mismo mensaje claro.

### Supervisor (`/sup`)
- Hoy, Supervisiones, Historial, detalle y Registrar inicio muestran `A terminar` cuando `v_my_supervisions.shift_open_ended` es verdadero.
- El supervisor no lleva tope de horas (migración 0038). El plazo de calificación sigue calculándose igual que la RPC (fin del turno guardado o fin registrado, el mayor); calificar y completar solo piden el fin registrado de la supervisión, nunca el fin del turno.

## Código
- `src/api/myDay.ts`: `openEnded`, `noCheckout`. `src/api/mySupervisions.ts`: `shiftOpenEnded`.
- `src/features/employee/shiftRange.ts`: `formatAssignmentRange`, `formatSupervisionRange` y los mensajes. Usa `src/features/shifts/openEnded.ts` (compartido con administración).
- `src/features/employee/components/AssignmentStatusBadge.tsx`: insignia de estado con «Sin salida».
