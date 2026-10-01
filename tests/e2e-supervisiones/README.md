# `tests/e2e-supervisiones`

Suite e2e de supervisiones y calificaciones (SUP-013/MOB-SUP-013/TEST-013, P15.6,
`08_Fases_y_Backlog.md` F15), contra un backend real (`App_dev`). Mismo criterio que las demás
suites de backend real de esta carpeta: en su propia carpeta porque necesita
`SUPABASE_SERVICE_ROLE_KEY` para armar y limpiar un cliente, una sede, un supervisor y empleados
descartables (prefijo `E2E-P156`). Dos proyectos de Playwright:

- `desktop`: escritorio (≥1024 px), para `admin-*.spec.ts` (ADM-13 a ADM-15).
- `mobile`: 390×844, para `mobile-*.spec.ts` (la app del supervisor, DS-015).

## Qué cubre cada archivo

- `admin-supervisions.spec.ts` (SUP-013): asignar una supervisión (ADM-14) con la advertencia
  SUPERVISES_OWN_SHIFT ("este supervisor también está asignado como empleado en este turno",
  P15.0) y el botón "Ver supervisión"; el detalle (ADM-15); marcar como no realizada con motivo;
  cancelar con motivo; editar una calificación ya cargada (`rate_employee`, upsert, capacidad
  `edit_ratings`). Logueado como el dueño del seed (O: `manage_supervisions`/`edit_ratings`
  siempre).
- `mobile-supervisor-flow.spec.ts` (MOB-SUP-013): Hoy (SUP-02), detalle (SUP-03), registrar inicio
  con geolocalización simulada y concedida (SUP-04), registrar fin, calificar con estrellas y
  comentario (SUP-05), editar esa calificación dentro de la ventana de P-083, CB-13 (la propia
  fila del supervisor dice "Vos", sin acceso a calificarse), cerrar con faltantes ("Falta 1
  empleado por calificar", SUP-06), "No se pudo realizar" con motivo (otra supervisión) e
  historial (SUP-08). Verifica en la Base que `supervision_attendance` tenga coordenadas.
- `mobile-supervisor-without-location.spec.ts` (MOB-SUP-013): SUP-04 con el permiso de ubicación
  del navegador SIN conceder — acepta el consentimiento de la app, pero el navegador deniega el
  permiso real; el registro de inicio se completa igual, sin coordenadas en la Base.

## Cómo correrla

Desde `app/`, con `.env.local` completo (las mismas cuatro variables que el resto de suites de
backend real):

```bash
pnpm test:e2e:supervisiones
```

Puerto 4178 (ninguna otra suite lo usa): no llama a la Edge Function `admin-users` desde el
navegador, así que no necesita el puerto 5173 reservado en `ALLOWED_ORIGINS` — se puede correr en
paralelo con `pnpm dev` de Mike en el puerto 5173.

## Independencia y limpieza

Cada test crea sus propias cuentas descartables (`peopleFixture.ts`: Auth con
`auth.admin.createUser` + `user_roles` + `employees`, sin pasar por la Edge Function
`admin-users`), su propio cliente y su propia sede. `admin-supervisions.spec.ts` usa turnos de
MAÑANA a horas fijas (`tomorrowISODate`, sin relación con la hora a la que corra la suite);
`mobile-supervisor-*.spec.ts` usa turnos de HOY (SUP-02 solo lista las supervisiones de hoy), con
horas relativas al momento de la corrida (hora de Argentina) — como son cuentas de un solo uso,
sin ningún otro turno real, no tiene la fragilidad que señaló el reporte de pausa de P15.6 para
`tests/permissions/` (esas pruebas comparten las cuentas FIJAS del seed con el resto de la
operación de `App_dev`).

Al terminar, las cuentas descartables quedan baneadas e inactivas
(`deactivateDisposableSupervisor`/`deactivateDisposableEmployee`) y el cliente/sede quedan de baja
lógica (`cleanupDisposableClient`) — sin borrado físico. Toda supervisión de fixture que no haya
quedado en un estado terminal (completada, no realizada o cancelada) se cancela en el `finally` de
cada test (`cancelSupervisionFixture`).
