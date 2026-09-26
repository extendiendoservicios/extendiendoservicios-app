# App del empleado: jornada, inicio y fin, tareas, observaciones (F13)

`08_Fases_y_Backlog.md` F13 "App del empleado: jornada, inicio y fin, tareas,
observaciones". P13.1 (ATT-001 a ATT-004, `supabase/migrations/0026_rpc_attendance.sql`)
y P13.2 (Hoy, detalle del servicio, Fichar, consentimiento, Más) ya estaban
en `develop`. Este paquete (P13.3, MOB-EMP-007 a MOB-EMP-012, MOB-EMP-014,
MOB-EMP-015) completa el turno de punta a punta: registrar el inicio, seguir
el servicio en curso, marcar tareas, cargar una observación, registrar el fin
y ver el resumen -- más el banner de instalación (COM-06) y el indicador de
"sin conexión".

## Mapa de pantallas y rutas

| Pantalla                    | Ruta                                                 | Componente                                                 | Contenido                                                                                                   |
| --------------------------- | ---------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| EMP-05 Registrar inicio     | `/app/fichar` (mismo nodo que EMP-14, ver más abajo) | `RegisterStart` dentro de `src/pages/app/ClockTabPage.tsx` | Servicio elegido, hora de referencia, botón "Registrar inicio" (`record_check_in`).                         |
| EMP-07 Servicio en curso    | `/app/en-curso/:assignmentId`                        | `src/pages/app/InProgressPage.tsx`                         | Cronómetro desde `check_in_at`, fin previsto, progreso de tareas, accesos a Tareas/Observaciones/Finalizar. |
| EMP-08 Tareas               | `/app/en-curso/:assignmentId/tareas`                 | `src/pages/app/TasksPage.tsx`                              | `TaskList`/`TaskItem` (DS-012) con guardado por ítem (`update_task_status`).                                |
| EMP-09 Observaciones        | `/app/en-curso/:assignmentId/observaciones`          | `src/pages/app/NotesPage.tsx`                              | Un textarea con contador (2000 caracteres) y guardado explícito (`set_assignment_notes`).                   |
| EMP-10 Finalizar servicio   | `/app/en-curso/:assignmentId/finalizar`              | `src/pages/app/FinishPage.tsx`                             | Resumen antes de confirmar, avisos informativos, botón "Registrar fin" (`record_check_out`).                |
| EMP-11 Resumen del servicio | `/app/resumen/:assignmentId`                         | `src/pages/app/SummaryPage.tsx`                            | Comprobante: inicio, fin, duración, tareas, observación.                                                    |

`src/app/routes/employeeRoutes.tsx` monta las cinco últimas donde antes había
`placeholderRoute(...)`; los títulos y subtítulos de cada `handle` están
escritos para quien usa la aplicación, nunca con el código de pantalla del
plan (regla del encargo) -- el código (`EMP-07`, etc.) queda solo en el campo
`screenId`, que no se muestra en ninguna pantalla.

EMP-05 no tiene ruta propia (decisión de P13.2, ratificada acá): comparte
`/app/fichar` con EMP-14 -- `ClockTabPage` ya resuelve toda la cadena
(elegir servicio si hay más de uno → consentimiento de ubicación si hace
falta → `RegisterStart`) y termina en el mismo componente donde ahora vive el
botón real de "Registrar inicio".

## Flujo de estados de una asignación (empleado)

```
expected ──(record_check_in)──> present ──(record_check_out)──> finished
   │                                │
   └─(notify_delay/absence, F14)    └─(update_task_status: solo mientras `present`)
```

- **`canEditTasks`** (`src/features/employee/attendanceWindow.ts`): la
  ventana de edición de tareas es exactamente `assignment.status === 'present'`
  -- ese es el mismo estado que pone `record_check_in` y que saca
  `record_check_out` (P-063, `06_API.md` sección 9: "sin asignación vigente
  `present`" → `TASK_LOCKED`). No hace falta comparar horas a mano.
- **`taskWindowNotice`**: el aviso que se muestra en EMP-08 en solo lectura,
  distinto según si todavía no se registró el inicio o si ya se registró el
  fin.
- Si el servidor igual devuelve `TASK_LOCKED` (por ejemplo, dos pestañas
  abiertas y en una se registró el fin mientras la otra seguía en EMP-08), el
  error de la mutación se muestra tal cual llega (`ApiError.message`, ya en
  español).

## Ubicación y consentimiento (ADR-009, P-067, P-091)

- `src/lib/geolocation.ts` (`getCurrentPositionSafe`, de P13.1/ATT-006) nunca
  rechaza: sin API, permiso denegado, error del sensor o timeout (6 s)
  siempre resuelven en `null`. EMP-05 y EMP-10 llaman a esta función **solo
  si** `profiles.location_consent_at` no es `null`; si el empleado rechazó el
  consentimiento (ver el punto siguiente), ni siquiera se intenta pedir la
  posición.
- **La negativa se recuerda en el dispositivo** (`src/features/employee/locationChoice.ts`,
  corrección de P13.2/fix-005): sin esto, alguien que elige "Continuar sin
  ubicación" en EMP-06 volvería a ver esa pantalla en cada intento de fichar,
  porque la Base solo guarda el consentimiento _dado_, nunca el rechazado.
  `hasDeclinedLocation(userId)` guarda una marca en `localStorage` (por
  usuario, para no mezclar sesiones en un dispositivo compartido); si el
  almacenamiento no está disponible (modo privado), se vuelve a preguntar la
  próxima vez -- nunca bloquea el registro.
- Las coordenadas (latitud, longitud, precisión) nunca se mapean a un tipo de
  `src/api/attendance.ts`: es imposible mostrarlas por accidente en una
  pantalla (regla del encargo, ADR-009).
- El pedido de posición (si corresponde) nunca demora el registro más de lo
  que tarda `getCurrentPositionSafe`: el botón se deshabilita mientras se
  resuelve (`busy`/`loading` del botón), pero ese tiempo está acotado por el
  `timeoutMs` de esa función, no por el usuario ni por el servidor.

## Hora del servidor, nunca la del dispositivo (P-066)

- `record_check_in`/`record_check_out` ponen `now()` del lado del servidor;
  el frontend nunca manda ni construye esa hora.
- Las pantallas que muestran "la hora ahora" mientras el empleado todavía no
  registró nada (EMP-05, EMP-10) usan `src/features/employee/useNow.ts`
  (un reloj de `Date` que se actualiza cada 15 segundos) con una leyenda
  explícita: _"Hora de referencia de tu celular. La hora que vale y queda
  registrada es la del servidor."_ No se pretende que esta hora sea exacta al
  segundo, ni hace falta: es solo orientativa hasta que la RPC responde.
- El cronómetro de EMP-07 (`src/features/employee/chronometer.ts`,
  `elapsedSeconds`/`formatElapsed`) sí se ve correr en tiempo real (`useNow`
  con un intervalo de 1 segundo), pero se calcula restando el reloj del
  dispositivo menos `check_in_at` (el instante fijo que puso el servidor):
  un desvío del reloj del celular corre por igual a los dos lados de la
  resta y no cambia el número que se ve.

## Avisos de EMP-10 (finalizar), ninguno bloquea (P-076)

`src/features/employee/finishSummary.ts`:

- `countPendingRequiredTasks(tasks)`: tareas obligatorias que siguen
  `pending` o `in_progress` (ni completadas ni marcadas "no realizada").
  Si es mayor a 0, se muestra un aviso -- el botón "Registrar fin" sigue
  habilitado.
- `isEarlyLeave(now, assignment)`: compara la hora actual contra el fin
  previsto de la asignación (`endsAt` si tiene franja propia, si no
  `shiftDate` + `endTime` combinados con el offset fijo de Argentina
  `-03:00`, ADR-019 -- nunca con la zona horaria del dispositivo). Si `now`
  todavía no llegó a ese instante, se muestra el aviso "Vas a registrar la
  salida antes del horario previsto", también informativo.

## Sin conexión (MOB-EMP-015)

`useOnlineStatus` (de P13.2) se usa en las cuatro pantallas que escriben:

- **EMP-05** (`RegisterStart`): banner y botón "Registrar inicio"
  deshabilitado.
- **EMP-07**: banner informativo (la pantalla en sí es de solo lectura, no
  hace falta deshabilitar nada ahí).
- **EMP-08**: banner y `TaskList` en `readOnly` (además de la ventana propia:
  sin conexión, ninguna de las dos condiciones alcanza para editar).
- **EMP-09**: banner, textarea y botón "Guardar" deshabilitados.
- **EMP-10**: banner y botón "Registrar fin" deshabilitado.

Sin cola ni sincronización (fuera de la Base, módulo C): al volver la
conexión, la persona vuelve a intentar la acción a mano.

## Banner de instalación (COM-06)

`src/features/employee/components/InstallBanner.tsx`, montado en EMP-03
(`TodayPage`) -- SUP-02 (Hoy del supervisor) todavía no existe (F15) y por
lo tanto ese `05` fila COM-06 ("EMP-03 y SUP-02") queda con un solo punto de
montaje hasta esa fase.

- Con `beforeinstallprompt` disponible (Chrome/Android, `useInstallPrompt` de
  P13.2): botón "Instalar" que abre el diálogo nativo, y "Ahora no" para
  descartarlo.
- Sin ese evento (no lo dispara Safari/iOS) pero en un dispositivo iOS
  (detectado por `navigator.userAgent`): el texto con los dos pasos
  manuales ("Compartir" → "Agregar a pantalla de inicio") y un botón de
  cerrar.
- En cualquier otro caso (navegador de escritorio, o un navegador Android
  que ya descartó el evento) no se muestra nada.
- No aparece si la app ya corre instalada (`display-mode: standalone`, o
  `navigator.standalone` en iOS).
- Al cerrarlo, `src/features/employee/installBannerDismiss.ts` guarda la
  marca por siete días (decisión menor, el plan no fija un número): ni
  insiste en cada visita, ni desaparece para siempre por un solo cierre.

## Decisiones menores de este paquete

- **Confirmación de EMP-05 con la hora del servidor** (`05` fila EMP-05:
  "Confirmación con la hora del servidor"): en vez de una pantalla o un
  diálogo intermedio (que el mapa de navegación de `05` sección 6 no lista:
  el siguiente nodo después de EMP-05 es directamente EMP-07), la
  confirmación es la propia EMP-07, que muestra "Iniciado a las HH:mm" con
  `check_in_at` -- la hora del servidor queda visible apenas se llega a la
  pantalla siguiente, sin agregar un paso que el plan no pide.
- **Tamaños de tipografía del cronómetro y de la hora de referencia**: se usan
  los valores de `07_Design_System.md` sección 1.2 ("Móvil: cronómetro" 33 px
  peso 700 tabular; "Móvil: hora" 22 px peso 700 tabular) tal cual.
- **Plazo de siete días para el banner de instalación**: ver la sección de
  arriba.
- **Umbral de salida anticipada**: se compara contra el instante exacto de
  fin previsto (sin margen de tolerancia) -- el plan no pide ninguno y P-068
  ya descarta tolerancias para el inicio; se aplica el mismo criterio acá.

## Cómo probarla

1. Como un empleado del seed con un turno de hoy sin iniciar, entrar a
   `/app`, abrir "Fichar" (`/app/fichar`) y, si hace falta, resolver el
   consentimiento de ubicación (aceptar o rechazar) -- después registrar el
   inicio. Verificar que la pantalla no espera más de unos segundos aunque
   se niegue el permiso del navegador.
2. En `/app/en-curso/:assignmentId`, ver el cronómetro correr, entrar a
   "Tareas", marcar una como completada y otra como "no realizada" (con
   motivo obligatorio), volver y ver el progreso actualizado.
3. Cargar una observación en "Observaciones", guardarla, volver a entrar y
   ver que quedó.
4. Ir a "Finalizar servicio" con alguna tarea obligatoria todavía pendiente y
   antes del horario previsto de fin: verificar los dos avisos informativos
   y que el botón "Registrar fin" sigue habilitado.
5. Registrar el fin y verificar el resumen (EMP-11): inicio, fin, duración,
   tareas y observación.
6. Repetir el registro de inicio o de fin con el DevTools de Chrome en modo
   "Offline": los botones de escritura tienen que deshabilitarse con un aviso
   claro, sin que la aplicación se rompa.
7. Probar el registro de inicio y de fin **negando el permiso de ubicación**
   del navegador (o sin conceder el consentimiento): el registro tiene que
   completarse igual.
8. Tests automatizados: `pnpm test` corre las suites unitarias de esta
   vía (`src/features/employee/*.test.ts(x)`, `src/pages/app/*.test.tsx`).
   El flujo completo de punta a punta (con geolocalización simulada) es de
   `qa-pruebas` (MOB-EMP-017, P13.4).
