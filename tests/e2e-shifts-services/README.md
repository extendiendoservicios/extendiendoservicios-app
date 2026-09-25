# `tests/e2e-shifts-services`

e2e de servicios y turnos (SERVICE-007, SHIFT-012, TEST-007 — `08_Fases_y_Backlog.md` F10,
encargo P10.4) contra un backend real (`App_dev`): alta y edición de servicio (ADM-25), flujo
completo "servicio → generar el mes → lista del día" (ADM-09, ADM-05), idempotencia de
`generate_shifts`, feriados, servicio pausado, alta de turno puntual con aviso de feriado
(ADM-07), cambio de franja, cancelación con motivo obligatorio, y permisos por capacidad en la
interfaz (`generate_shifts`, `cancel_shifts`).

## Por qué está separada de las demás suites de backend real

Mismo motivo que `tests/e2e-auth/`, `tests/e2e-users/`, `tests/e2e-clients-sites/` y
`tests/e2e-employees/` (ver sus propios README): necesita `SUPABASE_SERVICE_ROLE_KEY` para
preparar y limpiar clientes, sedes, servicios y feriados descartables por API directa, y para
crear un administrador descartable en los casos de permisos por capacidad (Edge Function
`admin-users`, de ahí el puerto 5173, igual que `tests/e2e-users/` y `tests/e2e-employees/`).

## El mes lejano reservado (2190-06)

`generate_shifts` genera turnos para TODOS los servicios `active` del sistema cuya vigencia
cubra el mes pedido, no solo los de esta suite: `App_dev` tiene servicios reales con vigencia
abierta (`valid_to` nulo), así que cualquier mes que se genere de verdad crea turnos también
para ellos. Para no tocar meses de trabajo real, esta suite usa siempre el mismo mes fijo y muy
lejano (junio de 2190, `helpers/farDate.ts`): los servicios de fixture tienen vigencia SOLO ese
mes, y las aserciones son siempre sobre los turnos de esos servicios (filtrados por
`service_id`), nunca sobre los contadores totales que devuelve la RPC.

## Cómo correrla

Desde `app/`, con `.env.local` completo:

```bash
pnpm test:e2e:shifts-services                      # los cuatro specs, proyecto chromium (1280 px)
pnpm test:e2e:shifts-services -- service-crud.spec.ts   # uno solo
```

`pnpm test:e2e:shifts-services` corre `pnpm build` primero (carga `.env.local` con la convención
de Vite, así apunta de verdad a `App_dev`) y recién después Playwright, que sirve ese `dist/` con
`vite preview --port 5173`.

## Organización

- `helpers/env.ts`, `helpers/baseUrl.ts`, `helpers/login.ts` — mismo patrón que el resto de las
  suites de backend real. `login.ts` usa `getByLabel('Contraseña', { exact: true })`: sin
  `exact`, el nuevo `PasswordInput` (botón "Mostrar contraseña") rompe el selector por
  "strict mode violation" — defecto real, reportado al orquestador (ver el reporte del encargo),
  que ya afecta a `tests/e2e-users/` y `tests/e2e-clients-sites/` (no tocadas por esta tarea:
  quedan fuera del alcance de este paquete).
- `helpers/farDate.ts` — constantes del mes lejano reservado y el feriado de fixture.
- `helpers/adminClient.ts` — cliente con la clave de servicio: cliente/sede/servicio/turno de
  precondición y limpieza SIN borrado físico (encargo P10.4, P-014/P-105): pausa y finaliza los
  servicios, marca sede y cliente de baja lógica. Los turnos (todos fechados en 2190) no se
  tocan: no hay ninguna acción del dominio que los borre y, tan lejos en el tiempo, no molestan a
  nada real.
- `helpers/datePicker.ts` — navega el `DatePicker` (`react-day-picker`, sin selector de año) por
  teclado: `Shift+PageDown/Up` salta de a un año, `PageDown/Up` de a un mes, sobre el día
  enfocado tras abrir el popover.
- `helpers/monthPicker.ts` — navega el `MonthPicker` de ADM-09 (grilla propia) a clics de año.
- `service-crud.spec.ts` (SERVICE-007) — alta y edición de servicio con fechas cercanas a hoy
  (crear/editar un servicio no dispara `generate_shifts`, no hace falta el mes lejano).
- `generate-shifts-far-month.spec.ts` (SHIFT-012) — flujo central de F10 con tres servicios de
  fixture (normal, sin feriados, pausado), tiempo de la generación medido y verificado contra el
  criterio de F10 (menos de 10 s).
- `shift-manual-and-cancel.spec.ts` (SHIFT-012) — turno puntual con aviso de feriado, cambio de
  franja, cancelación con motivo obligatorio.
- `permissions-interface.spec.ts` (SHIFT-012, permisos) — un administrador sin `generate_shifts`
  no puede generar; sin `cancel_shifts` no debería ver "Cancelar" (falla a propósito: defecto
  real, reportado al orquestador).

## Qué no cubre (para el orquestador)

- La conservación de asignaciones al cancelar un turno (criterio de aceptación de F10): no se
  pudo armar una asignación de fixture por ninguna vía (ni API directa con la clave de servicio,
  ni RPC: `assign_employee` es de F11) — ver el comentario de `shift-manual-and-cancel.spec.ts`.
- Lighthouse, accesibilidad y capturas responsive de estas pantallas son de F17 (RESP-*).
- La suite de permisos completa por tabla y RPC (F18, TEST-019): acá se sumaron los casos
  puntuales de las cinco RPC de turnos y la tabla `services` a `tests/permissions/`.
