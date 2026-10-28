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

| Archivo                    | Qué prueba                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `00-inventario`            | Que la matriz no quede vieja: falla si una migración agrega una tabla, vista, RPC, bucket o acción sin casos                                                                                                                                                                                                                                                                                                                               |
| `10-tablas-lectura`        | `select` de las 28 tablas por los 7 perfiles (`04` §7.2); CB-15, CB-17                                                                                                                                                                                                                                                                                                                                                                     |
| `11-tablas-escritura`      | `insert`, `update` y `delete` por tabla y perfil; escalamiento (CB-17)                                                                                                                                                                                                                                                                                                                                                                     |
| `12-columnas-sensibles`    | Columnas de más en filas que el rol sí puede leer (DNI, contacto, observaciones)                                                                                                                                                                                                                                                                                                                                                           |
| `13-rendimiento`           | Que la RLS no vuelva inutilizable una tabla (`select` sin filtro, menos de 3 s)                                                                                                                                                                                                                                                                                                                                                            |
| `20-vistas`                | Las vistas `v_*` (incluidas las 4 de la coordinación): qué filas ve cada perfil y que ninguna se pueda escribir                                                                                                                                                                                                                                                                                                                            |
| `30-rpc`                   | Cada RPC llamada por cada perfil (`06` §15)                                                                                                                                                                                                                                                                                                                                                                                                |
| `40-capacidades`           | Las ocho capacidades del administrador (desde 0069, `manage_stock`), una por una                                                                                                                                                                                                                                                                                                                                                           |
| `50-storage`               | Buckets `avatars` y `branding`: carpeta propia y ajena, límites de tamaño y tipo                                                                                                                                                                                                                                                                                                                                                           |
| `60-edge`                  | Edge Function `admin-users`: JWT, rol, jerarquía, CORS, errores internos                                                                                                                                                                                                                                                                                                                                                                   |
| `70-escalamiento`          | Un rol no se escala a sí mismo (CB-17); `anon` solo lee `v_public_branding`                                                                                                                                                                                                                                                                                                                                                                |
| `80-desactivado`           | Un desactivado con el token vigente no puede hacer nada (CB-18)                                                                                                                                                                                                                                                                                                                                                                            |
| `90-evidencia`             | Módulo H (evidencia fotográfica, 0047): `shift_media`, bucket `evidence` y sus RPC por rol (P21.6)                                                                                                                                                                                                                                                                                                                                         |
| `61-edge-evidence-cleanup` | Edge Function `evidence-cleanup` (módulo H): sin el secreto del encabezado, nadie la hace correr (P21.6c)                                                                                                                                                                                                                                                                                                                                  |
| `92-geo-b1`                | Módulo B1 (0052 a 0057): correcciones, radio, posición, consentimiento, `v_presence_today` y columnas cerradas, por los 7 perfiles (P22.5)                                                                                                                                                                                                                                                                                                 |
| `93-geo-regla`             | Regla de validación contra las RPC reales: bordes, tope de 150 m, radio por sede y resultado congelado (P22.5)                                                                                                                                                                                                                                                                                                                             |
| `94-coordinacion`          | Coordinación libre y jornada (0063, P24.5): lectura de lo propio y de lo ajeno, coordenadas no legibles, cada RPC nueva con su `hint`, preferencias y correcciones por capacidad, las cuatro RPC revocadas en 42501                                                                                                                                                                                                                        |
| `91-modulos-p19`           | Anuncios, datos bancarios, observación del turno, fijos de un servicio y alto contraste (0040 a 0043) (P21.6c)                                                                                                                                                                                                                                                                                                                             |
| `95-insumos`               | Insumos y control de stock (0069 a 0072, P25.5c): las 8 tablas, las 11 vistas, las 12 RPC y el bucket `supply-images` por los 7 perfiles y por el administrador que también es empleado (IS-35); stock nunca negativo (también con retiros simultáneos), movimientos inmutables, el celular sin precios ni cantidades, contrato de errores (DEF-P25-01, DEF-P25-02), cuentas desactivadas (CB-18) y escalamiento de `manage_stock` (CB-17) |
| `96-client-photos`         | Bucket `client-photos` (0039, P19.6c): quién sube, reemplaza, borra y firma, y los límites de tamaño y tipo. Lo agregó P25.5c: la matriz no lo cubría                                                                                                                                                                                                                                                                                      |

Apoyos: `tablas.ts`, `vistas.ts`, `rpc.ts` y `edge-casos.ts` (los casos esperados), `escenario.ts`
(el escenario `e2e-perm-` que se planta y se borra), `contexto.ts`, `perfiles.ts`, `ayudas.ts`,
`cobertura.ts`, `inventario.ts` y `global-setup.ts` (deja las cuentas, inicia sesión una sola vez
por perfil y repone al final lo que la suite toca).

## Defectos conocidos (`suite/defectos.ts`)

Los casos que fallan por un defecto de la app llevan `it.fails` y el identificador (`DEF-Pxx`). Desde P21.6c está abierto DEF-P14 (`set_my_high_contrast` no mira `is_active`). P22.5 suma DEF-B1-02 y DEF-B1-03 (RPC de B1 que no miran `is_active`, CB-18).
No se ajusta la prueba al defecto: cuando se corrige, Vitest avisa y hay que sacar el caso de
`defectos.ts`. **Desde P18.6 (migración `0030` y Edge Function `admin-users`) la lista quedó vacía (hasta DEF-P14, P21.6c)**: se
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

## Coordinación libre (P24.5)

Los cuatro archivos que escriben (`90`, `92`, `93` y `94`) dejan el escenario como lo encontraron al terminar: Vitest corre primero los archivos que fallaron la vez anterior, así que el orden entre archivos no está garantizado. El escenario planta, además, dos preferencias, una jornada de **ayer** por coordinador (`supervisor1` y el doble rol; ayer para no chocar con `unique (supervisor_id, work_date)` de las pruebas que inician la jornada de hoy) y un turno de hoy sin asignaciones; `94-coordinacion` usa jornadas propias de `supervisor2` para corregir. Quien termine con una jornada de hoy la borra con `borrarJornadasDe(db, ids, hoy)`: sin la fecha borra también las de ayer del escenario.
