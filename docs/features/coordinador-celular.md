# Celular del coordinador: coordinación libre y jornada (P24.2)

Especificación: `Docs/Plan_Maestro/modulos/P24_coordinacion_libre_y_jornada.md` (CJ-01 a CJ-34). Contrato de la base:
`docs/database.md`, sección «Coordinación libre y jornada del coordinador» (migraciones `0062` y `0063`, P24.1).

Desde P24.2 el coordinador no recibe supervisiones asignadas: ve todos los turnos del día, inicia su jornada, elige un
turno y «Supervisar» registra el inicio. Las horas del coordinador son las de su jornada (inicio a fin menos pausas); el
tiempo de cada supervisión es informativo.

## Pantallas (`/sup`)

| Pantalla                 | Ruta                                             | Archivo                                   | Qué hace                                                                                                                                               |
| ------------------------ | ------------------------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SUP-02 Hoy               | `/sup`                                           | `src/pages/sup/TodayPage.tsx`             | Barra de jornada arriba (`WorkdayBar`) y lista de turnos del día abajo (`TodayShiftsList`). Quien también es empleado ve antes «Tus servicios de hoy». |
| SUP-03 Detalle del turno | `/sup/turnos/:shiftId`                           | `src/pages/sup/SupervisorShiftPage.tsx`   | Datos del turno y de la sede, empleados, quién más lo supervisa y el botón «Supervisar».                                                               |
| SUP-04 Supervisión       | `/sup/supervisiones/:id`                         | `src/pages/sup/SupervisionDetailPage.tsx` | La supervisión en curso: empleados con acceso a calificar, «Descartar» y «Cerrar supervisión».                                                         |
| SUP-05 Calificar         | `/sup/supervisiones/:id/calificar/:assignmentId` | `src/pages/sup/RateEmployeePage.tsx`      | Sin cambios de flujo.                                                                                                                                  |
| SUP-06 Cerrar            | `/sup/supervisiones/:id/cerrar`                  | `src/pages/sup/CloseSupervisionPage.tsx`  | Nota general y «Cerrar supervisión» (`complete_supervision`, registra el fin con la posición).                                                         |
| SUP-07 Supervisiones     | `/sup/supervisiones`                             | `src/pages/sup/SupervisionsPage.tsx`      | Las supervisiones abiertas (`in_progress`). Ya no hay «asignadas».                                                                                     |
| SUP-08 Historial         | `/sup/historial`                                 | `src/pages/sup/HistoryPage.tsx`           | Jornadas por día: horas netas, horario, pausas y supervisiones (con su duración informativa).                                                          |

Se quitó la ruta `/sup/supervisiones/:id/registro` (SUP-04 anterior, `SupervisionAttendancePage`): el inicio se registra al
tomar el turno y el fin al cerrar. `supervision_check_in`, `supervision_check_out`, `assign_supervision` y
`mark_supervision_not_done` están revocadas (dan `42501`) y la app ya no las llama; «No se pudo realizar» desapareció del
cierre (si empezó por error, se descarta).

## Barra de jornada (SUP-02)

`src/features/coordinator/components/WorkdayBar.tsx`. Lee `v_my_workdays` del día (`useTodayWorkdayQuery`, relectura cada
30 s) y ofrece los botones según el estado:

| Estado                             | Etiqueta                                        | Botones                                                 |
| ---------------------------------- | ----------------------------------------------- | ------------------------------------------------------- |
| Sin jornada de hoy                 | Sin iniciar                                     | Iniciar jornada                                         |
| En marcha, sin supervisión abierta | En actividad                                    | Pausar, Finalizar jornada                               |
| En marcha, con supervisión abierta | Supervisando (con cliente y sede)               | Pausar y Finalizar deshabilitados con el motivo (CJ-29) |
| En pausa                           | En pausa (desde la hora y el motivo, si lo hay) | Reanudar, Finalizar jornada                             |
| Finalizada                         | Finalizada                                      | Reabrir jornada                                         |
| Cerrada sola a las 23:55 (CJ-31)   | Cerrada automáticamente, con aviso              | Reabrir jornada                                         |

- **Contador**: horas netas de `v_my_workdays.worked_minutes`; mientras la jornada está en marcha se le suman los minutos
  transcurridos desde la última lectura (solo la diferencia entre dos relojes del dispositivo, nunca la hora absoluta del
  teléfono) y cada lectura nueva lo vuelve a anclar al valor del servidor. En pausa o finalizada no avanza.
- **Hora de cada evento**: la que devuelve el servidor (`started_at`, `ended_at`, pausas).
- **Pausar** abre un diálogo con el motivo opcional (hasta 300 caracteres).
- **Sin conexión**: aviso y botones deshabilitados.

## Posición y consentimiento (CJ-20, CJ-21, ADR-009)

Cada botón de la jornada y de la supervisión pide la posición con el flujo de consentimiento de B1 y **registra siempre**,
con o sin coordenadas. Las coordenadas no se muestran.

- Jornada (`WorkdayBar`): si el consentimiento falta o el texto cambió (`useLocationConsent`), `LocationConsentGate` muestra
  el texto de la empresa en un diálogo (mismo `LocationConsentScreen` de EMP-06). Aceptar guarda el consentimiento y pide el
  permiso del navegador; «Continuar sin ubicación» sigue sin coordenadas. Con consentimiento, `getCurrentPositionSafe`
  (6 s) pide la posición; si falla o no llega, el evento se registra sin coordenadas.
- «Supervisar» (SUP-03) y «Cerrar supervisión» (SUP-06): además del consentimiento usan el panel en vivo de B1
  (`useGeoFichaje` + `GeoFichajePanel`: mapa de la sede, precisión, «Esperar mejor señal», motivo opcional si queda fuera de
  zona). Después de «Supervisar» se muestra `AttendanceResultScreen` con la hora y la validación que devolvió la base. Si el
  consentimiento se acepta en ese momento, hay que volver a tocar el botón (la posición en vivo recién empieza).
- La vista `v_supervisor_today` no trae el radio de la sede: el mapa de SUP-03 usa el radio general por defecto. El
  resultado que vale es el que calcula la base.

## Lista de turnos del día (SUP-02)

`TodayShiftsList` + `src/features/coordinator/shifts.ts`, sobre `v_supervisor_today` (`src/api/supervisorToday.ts`, relectura
cada 30 s para ver rápido quién tomó un turno):

- Dos bloques: **Mis sedes** (`is_priority`, por sede o por cliente, CJ-24) y **Otras sedes**, con buscador por cliente o sede
  (sin acentos ni mayúsculas; filtra solo «Otras sedes»).
- En cada bloque: en curso, después por empezar y al final terminados; dentro de cada grupo, por hora de inicio.
- Cada turno muestra «Supervisando: Ana» y/o «Supervisó: Luis» (el propio coordinador figura como «Vos»).
- Se puede tomar cualquier turno: las sedes propias solo ordenan.

## «Supervisar», «Descartar» y «Cerrar»

- **Supervisar** (`take_supervision`): deshabilitado, con el motivo a la vista, si no hay jornada iniciada, si está en pausa o
  finalizada (CJ-07), si ya tiene otra supervisión abierta (CJ-08) o si ya supervisó ese turno (CJ-27).
- **Descartar** (`discard_supervision`, SUP-04): solo mientras no calificó a nadie; queda cancelada y puede volver a tomar el
  turno. Pide confirmación.
- **Cerrar** (`complete_supervision`): deshabilitado mientras falte calificar a alguien (CJ-10). Cuentan los empleados
  asignados con inicio registrado; los ausentes no se califican y el propio coordinador, si también es empleado del turno,
  queda fuera (CJ-28). SUP-04 y SUP-06 listan a quién falta (en SUP-06, con acceso a calificar). Una supervisión «Sin cerrar»
  por el cierre automático de la jornada solo se ve, no se cierra desde el celular.
- La ventana de edición de la calificación (P-083) no corre mientras la supervisión sigue abierta; corre desde que se
  registra el fin (`isRatingWindowClosed`).

## Errores

`src/features/coordinator/errors.ts` traduce los `hint` de las RPC a mensajes claros (`coordinatorErrorMessage`, mismo
patrón que `src/features/geo/errors.ts`): `ON_LEAVE`, `WORKDAY_*`, `SUPERVISION_OPEN`, `SUPERVISION_ALREADY_OPEN`,
`ALREADY_SUPERVISED`, `NOT_TODAY`, `SUPERVISION_HAS_RATINGS`, etc. `RATINGS_PENDING` usa el mensaje del servidor, que trae
los nombres.

## Archivos

- `src/api/myWorkdays.ts` (jornada: lectura y RPC), `src/api/supervisorToday.ts` (turnos del día),
  `src/api/mySupervisions.ts` (`takeSupervision`, `discardSupervision`, `completeSupervision` con la firma nueva; se quitaron
  `supervisionCheckIn`, `supervisionCheckOut` y `markSupervisionNotDone`).
- `src/features/coordinator/`: `workday.ts`, `shifts.ts`, `ratings.ts`, `schemas.ts`, `errors.ts` (lógica pura con tests),
  `components/` (`WorkdayBar`, `TodayShiftsList`, `LocationConsentGate`) y `fixtures.ts` / `testUtils.tsx` (solo tests).
