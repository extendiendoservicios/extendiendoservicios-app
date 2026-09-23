# `tests/e2e-users`

e2e de usuarios, roles, capacidades y configuración de la empresa (USERS-018, TEST-004 —
`08_Fases_y_Backlog.md` F7, encargo P07.4) contra un backend real (`App_dev`): el dueño crea un
administrador, capacidades iniciales, ajuste de capacidades, revocación inmediata de acceso,
límites de un administrador frente al dueño, y las pantallas ADM-28 a ADM-31.

## Por qué está separada de `tests/e2e` y de `tests/e2e-auth`

Mismo motivo que separó `tests/e2e-auth/` de `tests/e2e/` (ver su propio README): esta suite
necesita `SUPABASE_SERVICE_ROLE_KEY` para crear y dar de baja administradores descartables y
para llamar a la Edge Function `admin-users` por API directa (no solo por la interfaz), algo que
ni `ci.yml` ni los workflows de despliegue tienen ni deberían tener. No se agregó a
`tests/e2e-auth/` porque el dominio es otro (usuarios y configuración de la empresa, no
autenticación) y porque comparten el mismo actor (el dueño) en varios tests seguidos: mezclarla
con los specs de login haría más difícil ver de un vistazo cuánto cupo del límite de acciones
por minuto consume cada suite.

## Cómo correrla

Desde `app/`, con `.env.local` completo (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `SEED_DEV_PASSWORD`):

```bash
pnpm test:e2e:users                      # chromium (1280 px) y mobile (390 px, solo el recorrido principal)
pnpm test:e2e:users --project=chromium   # uno solo
```

`pnpm test:e2e:users` corre `pnpm build` primero (carga `.env.local` con la convención de Vite,
así apunta de verdad a `App_dev`) y recién después Playwright, que sirve ese `dist/` con
`vite preview --port 4176` (4173 es `tests/e2e/`, 4174 es `tests/e2e-auth/`).

## Organización

- `helpers/env.ts` — lee y valida las cuatro variables (nunca las imprime); copia deliberada del
  de `tests/e2e-auth/`, no un import cruzado: cada suite de backend real queda autocontenida.
- `helpers/adminUsersClient.ts` — cliente con la clave de servicio para crear/banear cuentas
  descartables (prefijo `e2e-p074-`), `signInForToken` (login sin navegador, para tener un
  `access_token` crudo), `countOwnProfileRowsWithToken` (lectura REST directa con ese token, para
  la prueba de revocación inmediata) y `callAdminUsersFunction` (POST directo a la Edge Function,
  para los casos de permisos negativos que no tienen botón en la interfaz).
- `helpers/baseUrl.ts` — el puerto 4176.
- `owner-creates-admin-and-capabilities.spec.ts` — el recorrido principal de USERS-018: alta de
  administrador desde ADM-27, capacidades iniciales (las siete activas), qué ve y qué no ve un
  administrador con todas las capacidades, el dueño le quita `manage_users`, y qué deja de ver
  tras un nuevo ingreso. Único spec que corre también a 390 px.
- `deactivation-revokes-access-immediately.spec.ts` — un `access_token` vigente deja de leer su
  propia fila al instante al desactivar a su dueño, y vuelve a leer al reactivar (por API
  directa, sin UI: `04_Modelo_de_Datos.md` sección 7.1 y la migración
  `0022_own_row_policies_active_check.sql`).
- `admin-cannot-create-admin-or-reactivate.spec.ts` — un administrador con `manage_users` no
  puede crear otro administrador ni reactivar a nadie (por API directa: el servidor lo rechaza,
  no solo la interfaz).
- `last-owner-cannot-be-deactivated.spec.ts` — el servidor rechaza desactivar al último dueño
  activo (`LAST_OWNER`), sin baneo parcial.
- `owner-config-screens.spec.ts` — ADM-28 a ADM-31 como dueño: lectura de cada pantalla y
  "Cargar feriados nacionales" no duplica al llamarse dos veces.

## Independencia, límite de acciones y limpieza

Cuentas descartables con el prefijo `e2e-p074-`, distinto del de `tests/e2e-auth/`
(`e2e-auth-`) y del de `tests/permissions/`, para poder identificar de un vistazo qué suite dejó
cada cuenta si algo quedara a medio limpiar. Cada spec banea su propia cuenta al terminar, en un
`try/finally`, aun si el test falla — nunca se borra nada físicamente (P-014/P-105).

**Límite de 10 acciones por minuto de `admin-users` (por actor, decisión de Mike del 23 sep
2026):** el cupo se cuenta sobre acciones EXITOSAS de la Edge Function (un intento rechazado con
`FORBIDDEN`/`LAST_OWNER` no llega a insertar el evento que cuenta, `checkRateLimit` en
`supabase/functions/admin-users/index.ts`). Por eso la limpieza de esta suite banea directo con
la clave de servicio (`banDirectly`, mismo patrón que `tests/e2e-auth/helpers/adminClient.ts`)
en vez de volver a llamar a `deactivate_user`: así el dueño gasta cupo solo en las acciones que
cada test necesita probar de verdad, nunca en la limpieza. Con ese diseño, una corrida completa
usa unas 4 llamadas exitosas de `admin-users` como dueño (una en
`owner-creates-admin-and-capabilities.spec.ts`, una en
`admin-cannot-create-admin-or-reactivate.spec.ts`, dos en
`deactivation-revokes-access-immediately.spec.ts`), bien por debajo del límite. Dos corridas
seguidas (8 llamadas) entran cómodas dentro de la ventana de 60 segundos; para una tercera
corrida inmediata (regla del encargo, TEST-029: "la suite tiene que pasar tres veces seguidas")
puede hacer falta esperar unos segundos entre corridas para no chocar con el propio límite -- se
comprobó en la práctica (ver el reporte del encargo P07.4).
