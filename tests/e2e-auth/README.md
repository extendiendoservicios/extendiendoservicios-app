# `tests/e2e-auth`

e2e de autenticación (AUTH-012, TEST-003 — `08_Fases_y_Backlog.md` F6, encargo P06.4) contra un
backend real (`App_dev`): ingreso por rol, credenciales erróneas, recuperación de contraseña de
punta a punta, persistencia de sesión y usuario desactivado.

## Por qué está separado de `tests/e2e`

`tests/e2e/` es la suite de **humo**: la corre `ci.yml` contra un build con variables falsas (sin
backend) y `deploy-staging.yml`/`deploy-production.yml` la reutilizan como smoke test contra la
URL ya publicada. Ninguno de los dos casos tiene la clave de servicio que esta carpeta necesita
para loguear con las cuentas del seed y crear/borrar cuentas descartables. Por eso vive en su
propia carpeta, con su propio `playwright.auth.config.ts` y su propio script
(`pnpm test:e2e:auth`): ningún workflow la descubre ni la ejecuta.

## Cómo correrla

Desde `app/`, con `.env.local` completo (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `SEED_DEV_PASSWORD` — las mismas cuatro que `scripts/seed-dev.ts`,
ver `docs/environments.md` sección 4):

```bash
pnpm test:e2e:auth                      # chromium y mobile (390 px)
pnpm test:e2e:auth --project=chromium   # uno solo
```

`pnpm test:e2e:auth` primero corre `pnpm build` (carga `.env.local` con la convención de Vite —
el mismo mecanismo que usa `pnpm dev`, así que apunta de verdad a `App_dev`) y recién después
Playwright, que sirve ese `dist/` con `vite preview --port 4174` (un puerto distinto al de
`tests/e2e/`, 4173, para poder tener las dos suites levantadas sin choque). El `webServer` de
`playwright.auth.config.ts` fija `cwd` a la raíz de `app/` a propósito: por omisión, Playwright
arranca `webServer.command` con el directorio del propio archivo de config como `cwd`
(`tests/e2e-auth/`), y `vite preview` ahí buscaba `./dist` en el lugar equivocado y fallaba con
"The directory 'dist' does not exist" aunque el build de `app/dist` hubiera terminado bien
(comprobado en P06.4).

## Organización

- `helpers/env.ts` — lee y valida las cuatro variables (nunca las imprime); cada spec llama
  `readE2eAuthEnv()` y usa `test.skip(!env, ...)` para saltearse solo si falta algo.
- `helpers/adminClient.ts` — cliente con la clave de servicio, y las funciones para crear/borrar
  cuentas descartables (prefijo `e2e-auth-`, dominio `example.com` — nunca el dominio real de la
  empresa, para no confundir a nadie ni depender de un buzón real).
- `helpers/baseUrl.ts` — el puerto 4174, compartido entre el config y los specs que arman un
  `redirectTo`.
- `auth-by-role.spec.ts` — dueño, administrador, supervisor y empleado del seed (solo lectura)
  caen en su pantalla de inicio (`05_Pantallas_y_Navegacion.md` sección 5).
- `invalid-credentials.spec.ts` — contraseña incorrecta y email inexistente muestran EXACTAMENTE
  el mismo mensaje (`authErrors.ts`, `loginErrorMessage`).
- `password-recovery.spec.ts` — confirmación genérica de COM-02 (con un email inexistente, cero
  correos reales) y recuperación de punta a punta con `auth.admin.generateLink({ type:
'recovery' })` (tampoco manda correo: solo genera el enlace).
- `session-persistence.spec.ts` — recarga y pestaña nueva, mismo contexto de navegador.
- `deactivated-user.spec.ts` — baneo por Admin API (`ban_duration`), el único mecanismo de
  desactivación que el sistema garantiza hoy (la Edge Function `admin-users`, F7, todavía no
  existe). Ver el reporte del encargo P06.4 para la distinción con `profiles.is_active` y la
  ventana de revocación de hasta una hora (documentada desde P06.2).

## Independencia y limpieza

Las cuentas del seed se usan en **solo lectura** (nunca se cambia su contraseña ni su estado). Las
cuentas descartables llevan el prefijo `e2e-auth-` y se borran en un bloque `try/finally` de cada
spec, aun si el test falla.
