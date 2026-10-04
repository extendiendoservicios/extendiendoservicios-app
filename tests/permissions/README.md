# `tests/permissions`

Matriz de permisos por rol, por **API directa** (`supabase-js`, sin interfaz) contra `App_dev`
(TEST-019, P18.3, y limpieza de TEST-020, P18.4). Cada uno de los siete perfiles intenta leer y
escribir cada tabla de `public`, leer cada vista, llamar cada RPC, usar los buckets `avatars` y
`branding` y llamar cada acción de la Edge Function `admin-users`. Lo permitido tiene que
funcionar (contraprueba: así un `deny all` accidental no pasa) y lo no permitido tiene que dar
cero filas, `FORBIDDEN` o un error de RLS (`42501`).

La parte "por interfaz" (la acción oculta) está en las suites de Playwright de cada rol
(`tests/e2e/admin/permisos-capacidades.admin.ts`, `tests/e2e/supervisor/permisos.supervisor.ts`,
`tests/e2e/empleado/sin-calificaciones.empleado.ts`); acá se prueba lo que importa de verdad: que
el servidor lo rechace.

## Los siete perfiles

`anon` (sin sesión, clave publicable), empleado, supervisor, doble rol (empleado y supervisor),
administrador sin capacidades, administrador con las siete capacidades y dueño. Los seis con
sesión son cuentas fijas `e2e-fijo-*` (`tests/fixtures/accounts.ts`) y el dueño del seed. Los
tests nunca nombran emails: piden el perfil por su clave (`suite/perfiles.ts`).

## Cómo está organizada (`suite/`)

| Archivo                 | Qué prueba                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| `00-inventario`         | Que la matriz no quede vieja: falla si una migración agrega una tabla, vista, RPC, bucket o acción sin casos |
| `10-tablas-lectura`     | `select` de las 25 tablas por los 7 perfiles (`04` §7.2); CB-15, CB-17                                       |
| `11-tablas-escritura`   | `insert`, `update` y `delete` por tabla y perfil; escalamiento (CB-17)                                       |
| `12-columnas-sensibles` | Columnas de más en filas que el rol sí puede leer (DNI, contacto, observaciones)                             |
| `13-rendimiento`        | Que la RLS no vuelva inutilizable una tabla (`select` sin filtro, menos de 3 s)                              |
| `20-vistas`             | Las 10 vistas `v_*`: qué filas ve cada perfil y que ninguna se pueda escribir                                |
| `30-rpc`                | Cada RPC llamada por cada perfil (`06` §15)                                                                  |
| `40-capacidades`        | Las siete capacidades del administrador, una por una                                                         |
| `50-storage`            | Buckets `avatars` y `branding`: carpeta propia y ajena, límites de tamaño y tipo                             |
| `60-edge`               | Edge Function `admin-users`: JWT, rol, jerarquía, CORS, errores internos                                     |
| `70-escalamiento`       | Un rol no se escala a sí mismo (CB-17); `anon` solo lee `v_public_branding`                                  |
| `80-desactivado`        | Un desactivado con el token vigente no puede hacer nada (CB-18)                                              |

Apoyos: `tablas.ts`, `vistas.ts`, `rpc.ts` y `edge-casos.ts` (los casos esperados), `escenario.ts`
(el escenario `e2e-perm-` que se planta y se borra), `contexto.ts`, `perfiles.ts`, `ayudas.ts`,
`cobertura.ts`, `inventario.ts` y `global-setup.ts` (deja las cuentas, inicia sesión una sola vez
por perfil y repone al final lo que la suite toca).

## Defectos conocidos (`suite/defectos.ts`)

Los casos que fallan por un defecto de la app llevan `it.fails` y el identificador (`DEF-Pxx`).
No se ajusta la prueba al defecto: cuando se corrige, Vitest avisa y hay que sacar el caso de
`defectos.ts`. **Desde P18.6 (migración `0030` y Edge Function `admin-users`) la lista está vacía**: se
corrigieron DEF-P01 a DEF-P13 (con SEG-01, SEG-02, SEG-03, SEG-07 y SEG-08) y todos los casos son `it`
comunes. El mecanismo queda para el próximo defecto. El detalle está en `docs/test-inventory.md`
(sección 9) y en `docs/security-review.md`.

La matriz usa vistas recortadas para lo ajeno (`v_people_basic`, `v_clients_basic`,
`v_shift_peers`) y comprueba que las tablas base no entregan esas filas. Como desde P18.6 los
intentos rechazados de `admin-users` cuentan para su límite de 10 por minuto, `edge-cliente.ts`
borra los eventos `admin_action_rejected` de quien llama antes de cada llamada (salvo en el caso
que prueba el límite).

## Cómo correrla

Desde `app/`, con `.env.local` completo (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `SEED_DEV_PASSWORD`: las mismas cuatro de `scripts/seed-dev.ts`):

```bash
pnpm test:fixtures:setup   # una vez: deja las cuentas fijas (idempotente)
pnpm test:permissions      # unos 340 s
```

Los archivos corren uno detrás del otro (`fileParallelism: false`): comparten el escenario
plantado y `80-desactivado` cambia el estado de tres cuentas. No se repone ninguna contraseña en
plena corrida (cerraría las sesiones de la cuenta).

### Con otras suites en paralelo (CI)

Tiene que correr con su propio conjunto de cuentas, para no pisarse con las suites de Playwright:
`E2E_CONJUNTO=perm` (ver `tests/fixtures/accounts.ts`). Además lee el dueño del seed y repone al
final la configuración de la empresa (`company_settings`): por eso la edición de esa configuración
desde la interfaz (`tests/e2e/admin/configuracion-dueno.admin.ts`) va en el proyecto
`dueno-config`, que en CI espera a que esta suite termine.

## Por qué `.permissions.ts` y no `.spec.ts` ni `.test.ts`

Esta suite pega contra `App_dev`, con credenciales que solo existen en `.env.local` (nunca en el
CI de cada PR). `pnpm test` corre en cada PR sin ese archivo: con la extensión `.test.ts` Vitest
la descubriría y fallaría por falta de credenciales. Los archivos terminan en `.permissions.ts`,
que no coincide con el patrón por defecto de Vitest: quedan **fuera de la corrida por defecto por
construcción**, no por una condición en tiempo de ejecución. Como capa adicional, sin
`.env.local` completo la matriz se saltea sola con un aviso.

## `helpers/` y lo que se borró en P18.4

Los cuatro archivos por rol de P04.7 (`anon`, `employee`, `supervisor`, `admin`), su config
(`vitest.legacy.config.ts`), el script `test:permissions:legacy`, los `helpers/` que solo ellos
usaban (`assignment-fixtures`, `checklist-fixtures`, `supervision-fixtures`, `team-lookups`) y
`fixtures/seed-accounts.ts` (que se movió a `tests/fixtures/seed-accounts.ts` porque lo importan
las suites viejas por dominio) quedaron reemplazados por esta matriz. Quedan `helpers/env.ts`,
`helpers/clients.ts` y `helpers/admin-lookups.ts` porque los importa `tests/e2e-assignments/`;
cuando esa carpeta se migre a `tests/fixtures/`, se borran.
