# `tests/e2e-employees`

e2e de empleados y supervisores (EMP-014, TEST-006 — `08_Fases_y_Backlog.md` F9, encargo P09.5)
contra un backend real (`App_dev`): alta de empleado con usuario que entra a `/app`, alta de
supervisor con usuario que entra a `/sup`, persona con ambos roles (editados desde la ficha) que
puede navegar tanto a `/app` como a `/sup`, baja desde la ficha que revoca el acceso, una licencia
vigente que cambia el estado efectivo a "De licencia" y vuelve a "Activo" al darla de baja, una
licencia superpuesta rechazada con el mensaje exacto de `06_API.md`, el filtro por omisión de
ADM-16 ("Activos y de licencia", sin dados de baja), el buscador global (EMP-012) por nombre,
legajo y DNI, y capturas móviles de ADM-16 y ADM-17 (con cada pestaña) sin scroll horizontal.

## Por qué está separada de `tests/e2e`, `tests/e2e-auth`, `tests/e2e-users` y `tests/e2e-clients-sites`

Mismo motivo que separó esas suites entre sí (ver sus propios README): esta necesita
`SUPABASE_SERVICE_ROLE_KEY` para resolver ids por email y para dar de baja directo (sin pasar por
la interfaz) a toda persona descartable que crea, sin gastar el límite de 10 acciones por minuto
del dueño en la limpieza.

A diferencia de `tests/e2e-clients-sites/` (que no llama a ninguna Edge Function), esta suite SÍ
invoca `admin-users` desde el navegador (ADM-18, alta de empleado o supervisor "con usuario") —
por eso, igual que `tests/e2e-users/`, corre en el puerto **5173**, el único que
`supabase/functions/_shared/cors.ts` (`ALLOWED_ORIGINS`) admite como origen local. Esto significa
que esta suite **no puede correr al mismo tiempo que `pnpm dev`** en la misma máquina (mismo costo
aceptado que ya documenta `tests/e2e-users/helpers/baseUrl.ts`).

## Cómo correrla

Desde `app/`, con `.env.local` completo (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `SEED_DEV_PASSWORD`) y **sin** `pnpm dev` corriendo en el puerto 5173:

```bash
pnpm test:e2e:employees                      # chromium (1280 px) y mobile (390 px, solo las capturas)
pnpm test:e2e:employees --project=chromium   # uno solo
```

`pnpm test:e2e:employees` corre `pnpm build` primero (carga `.env.local` con la convención de
Vite, así apunta de verdad a `App_dev`) y recién después Playwright, que sirve ese `dist/` con
`vite preview --port 5173`.

## Organización

- `helpers/env.ts` — lee y valida las cuatro variables (nunca las imprime); copia deliberada de
  las otras suites de backend real, no un import cruzado.
- `helpers/baseUrl.ts` — puerto 5173 (ver arriba), con el motivo documentado en el propio archivo.
- `helpers/adminEmployeesClient.ts` — cliente con la clave de servicio; `disposableEmail`,
  `disposableLastName`, `disposableDni` para datos únicos por corrida; `findProfileIdByEmail`
  (Admin API, no hay `getUserByEmail` en el SDK v2); `terminateEmployeeDirectly` para la limpieza
  (banea + marca `employees.status = terminated`, sin pasar por la Edge Function ni por la
  interfaz).
- `helpers/employeeForm.ts` — completa y envía el formulario de alta de ADM-18 por interfaz.
- `helpers/login.ts` — login por interfaz; `loginAsExpectingFailure` para el caso de una cuenta
  dada de baja (se queda en `/ingresar`).
- `helpers/noHorizontalScroll.ts` — comprobación mecánica de `scrollWidth <= clientWidth`.
- `employee-and-supervisor-signup.spec.ts` (EMP-014, puntos 1 y 2) — alta de empleado con usuario
  que entra a `/app`; alta de supervisor con usuario que entra a `/sup`.
- `dual-role-cross-access.spec.ts` (EMP-014, punto 3) — persona con ambos roles (agregados desde
  "Editar roles" en la pestaña Datos de ADM-17) que puede navegar tanto a `/app` como a `/sup`; una
  persona con un solo rol queda confinada al suyo (redirigida, nunca a `/sin-acceso`). Ver la
  limitación de esta prueba más abajo.
- `termination-revokes-access.spec.ts` (EMP-014, punto 4) — "Dar de baja" desde la ficha revoca el
  acceso: la persona ya no puede iniciar sesión.
- `leave-status-and-overlap.spec.ts` (EMP-014, punto 5) — licencia vigente → cabecera "De
  licencia"; una segunda licencia que se superpone se rechaza con el mensaje exacto; al dar de
  baja la licencia vigente, la cabecera vuelve a "Activo".
- `list-default-filter.spec.ts` (ADM-16, punto 6) — el filtro por omisión ("Activos y de
  licencia") no muestra dados de baja; al elegir "Baja" aparecen.
- `global-search.spec.ts` (EMP-012, punto 7) — el buscador global encuentra a un empleado por
  nombre, legajo (leído del propio resultado, la secuencia la asigna el servidor) y DNI.
- `mobile-screenshots.spec.ts` (punto 8, proyecto `mobile`) — capturas a 390 px de ADM-16
  (listado) y ADM-17 (ficha, las siete pestañas), cada una con la comprobación de scroll
  horizontal. Usa una persona real del seed (Juan Pérez) porque solo lee estas pantallas, sin
  crear ni modificar nada. Las capturas quedan en `test-results/` (gitignorado).

## Independencia y limpieza

Nombres descartables con el prefijo `E2E P095` en el apellido y `e2e-p095-` en el email, distinto
del de las otras suites de backend real, para poder identificar de un vistazo qué suite dejó cada
fila si algo quedara a medio limpiar. No hay borrado físico (`04_Modelo_de_Datos.md` sección 0,
"Baja lógica"): `terminateEmployeeDirectly` banea el login y marca `employees.status =
'terminated'`, en un `try/finally` de cada spec, aun si el test falla.

## Limitación conocida: EMP-13/SUP-09 todavía son placeholders

El criterio de F9 pide que "una persona con ambos roles ve el acceso cruzado en Más (EMP-13 ↔
SUP-09)". A la fecha de esta suite (rama `feat/P09.4-ficha-empleado`), `EMP-13` (`/app/mas`) y
`SUP-09` (`/sup/mas`) todavía son pantallas placeholder ("Pantalla en construcción",
`src/app/routes/employeeRoutes.tsx` / `supervisorRoutes.tsx`) — no existe el enlace cruzado en sí
("Supervisión" desde Más de empleado, "Mis servicios" desde Más de supervisor). Por eso
`dual-role-cross-access.spec.ts` prueba lo único que hoy es verificable: que `RequireRole` deja
navegar a `/app` y a `/sup` a una persona con ambos roles, y confina a quien tiene un solo rol al
suyo. Falta un e2e del enlace real dentro de Más cuando `EMP-13`/`SUP-09` se implementen — ver el
reporte del encargo P09.5.

## Qué no cubre (para el orquestador)

- La suite de permisos completa por API directa sobre `employees`/`employee_leaves`/etc. (leer y
  escribir fuera de rol, por `supabase-js` directo) es TEST-019 (F18): esta suite solo prueba la
  navegación y los flujos por interfaz.
- Los pgTAP de EMP-013 (legajo, exclusión de licencias, RLS) ya existen (PR #50): esta suite no
  los repite.
- Lighthouse y la revisión sistemática a 768/1024/1366/1440 px son de F17 (RESP-003 en adelante).
