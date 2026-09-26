# `tests/e2e-employee-shift`

Suite e2e móvil (390×844) del turno completo de la app del empleado (MOB-EMP-017/TEST-010, P13.4,
`08_Fases_y_Backlog.md` F13), contra un backend real (`App_dev`). Mismo criterio que las demás
suites de backend real de esta carpeta (`tests/e2e-checklists/`, `tests/e2e-assignments/`, etc.):
en su propia carpeta porque necesita `SUPABASE_SERVICE_ROLE_KEY` para armar y limpiar un
empleado, un cliente, una sede y un turno de hoy descartables (prefijo `E2E-P134`).

## Qué cubre cada archivo

- `full-shift-with-geolocation.spec.ts`: consentimiento aceptado, registro de inicio, cronómetro,
  tareas (completar, no realizada con motivo, deshacer), observación, finalizar (con los dos
  avisos informativos) y resumen. Tareas bloqueadas antes del inicio y después del fin. Verifica
  en la Base que `attendance_records` tenga coordenadas, la asignación termine `finished` y el
  turno `completed`.
- `without-geolocation.spec.ts`: dos casos, siempre con el permiso de ubicación del navegador SIN
  conceder — aceptar el consentimiento de la app pero con el navegador denegando igual, y
  rechazar el consentimiento ("Continuar sin ubicación"), en los dos casos sin coordenadas en la
  Base y, en el segundo, sin que la segunda vez que se ficha se vuelva a pedir el consentimiento.
- `offline.spec.ts`: sin conexión (`context.setOffline(true)`) en servicio en curso, tareas,
  observaciones y finalizar — los botones que escriben quedan deshabilitados con un aviso.
- `today-and-changes.spec.ts`: Hoy — tarjeta destacada, otro servicio de hoy, próximos días, y el
  bloque "Cambios desde tu última visita" (aparece con un cambio hecho por administración y
  desaparece en la siguiente visita).

## Cómo correrla

Desde `app/`, con `.env.local` completo (las mismas cuatro variables que el resto de suites de
backend real):

```bash
pnpm build && node --env-file=.env.local ./node_modules/@playwright/test/cli.js test --config=tests/e2e-employee-shift/playwright.employee-shift.config.ts
```

(No hay script propio en `package.json` todavía — a diferencia de las demás suites de esta
carpeta, que sí tienen su `test:e2e:<nombre>`. Se pide en el reporte de esta tarea: agregar
`"test:e2e:employee-shift"` con el mismo patrón.)

Puerto 5173 (mismo que `tests/e2e-users/`/`tests/e2e-employees/`): no se puede correr en paralelo
con `pnpm dev` en la misma máquina.

## Independencia y limpieza

Cada test crea su propio empleado (cuenta descartable con `auth.admin.createUser` + `user_roles`

- `employees`, sin pasar por la Edge Function `admin-users`), su propio cliente, su propia sede y
  su propio turno de HOY (fechas y horas siempre relativas al momento de la corrida, hora de
  Argentina — nunca fechas fijas). Al terminar, el empleado queda baneado e inactivo
  (`deactivateDisposableEmployee`) y el cliente/sede quedan de baja lógica
  (`cleanupDisposableClient`) — sin borrado físico, mismo criterio que el resto de suites de backend
  real. Los turnos, `shift_tasks` y `attendance_records` de fixture no se tocan: quedan fechados hoy,
  con un cliente ya cerrado, sin aportar nada a la operación real a partir de mañana.
