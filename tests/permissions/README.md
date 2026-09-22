# `tests/permissions`

Suite negativa de permisos por rol, por **API directa** (`supabase-js`, sin interfaz) contra
`App_dev`: cada rol intenta leer y escribir lo que la RLS no le permite, y también lo que sí le
permite (para que un `deny all` accidental no pase la suite). Nace en P04.7
(`11_Desglose_de_Tareas.md`) como primer esqueleto que adelanta parte de TEST-019
(`08_Fases_y_Backlog.md`, F18); la suite completa por tabla y por RPC, más la variante por
interfaz (acción oculta), llega en F18.

## Cómo está organizada

- `helpers/env.ts` — lee y valida las variables de entorno (nunca las imprime).
- `helpers/clients.ts` — fábricas de clientes `supabase-js`: `createAdminClient` (clave de
  servicio, solo para preparar y verificar datos, nunca para probar qué puede hacer un rol),
  `createAnonClient`, `loginAs(email)`.
- `helpers/admin-lookups.ts` — resuelve ids del seed por email en tiempo de ejecución (nunca se
  hardcodean uuids: el seed no promete los mismos ids entre corridas de `pnpm db:seed`).
- `fixtures/seed-accounts.ts` — los emails de las 14 cuentas del seed, por rol.
- Un archivo por rol: `anon.permissions.ts`, `employee.permissions.ts`,
  `supervisor.permissions.ts`, `admin.permissions.ts`. Cada uno separa dos bloques: "lo que NO
  puede hacer" (tiene que dar cero filas o un error `FORBIDDEN`/`42501`) y "lo que SÍ puede
  hacer" (contraprueba).

Para agregar un rol o una tabla nueva: un archivo o un `it()` más, siguiendo el mismo patrón
(cliente autenticado con `loginAs`, cliente admin solo para verificar, limpieza de cualquier dato
que el test haya tocado).

## Por qué `.permissions.ts` y no `.spec.ts`/`.test.ts`

Esta suite pega contra `App_dev`, un backend real, con credenciales que solo existen en
`.env.local` (nunca en CI). `pnpm test` (Vitest con el config de la raíz) corre en cada PR
(`ci.yml`) sin ese archivo: si esta suite usara la extensión `.spec.ts`/`.test.ts`, Vitest la
descubriría con su patrón por defecto y `pnpm test` intentaría correrla igual, fallando en CI por
falta de credenciales.

En cambio, los archivos de esta carpeta terminan en `.permissions.ts`: no coinciden con el patrón
de include por defecto de Vitest (`**/*.{test,spec}.*`), así que el `vitest.config.ts` de la raíz
ni siquiera los ve. Quedan **fuera de la corrida por defecto por construcción**, no por una
condición en tiempo de ejecución — es la opción más robusta entre las dos que pedía el encargo
P04.7 ("que quede fuera de la corrida por defecto o se saltee sola"): no depende de que nadie
recuerde chequear una variable de entorno antes de imprimir un resultado.

Como capa adicional (no la principal), cada archivo llama `readPermissionsTestEnv()` y envuelve
sus casos en `describe.skipIf(!env)`: si alguien corre este config a mano sin `.env.local`
completo, los tests se saltean solos con un aviso por consola, en vez de fallar con un error de
red confuso.

## Cómo correrla

Desde `app/`, con `.env.local` completo (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `SEED_DEV_PASSWORD` — las mismas cuatro que ya usa
`scripts/seed-dev.ts`, ver `docs/environments.md` sección 4):

```bash
pnpm test:permissions
```

Que es un atajo de:

```bash
node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config tests/permissions/vitest.config.ts
```

(No `./node_modules/.bin/vitest`: en Git Bash de Windows ese shim es un script pensado para
`sh`/`cmd`, no para pasárselo directo a `node`; el `.mjs` de arriba es el mismo binario, sin ese
problema.)

No hay script en `package.json` para esto (ver la nota en el reporte de P04.7): agregar uno queda
para cuando el orquestador decida si esta suite entra a algún workflow de CI aparte (con
`App_dev` como secreto), y con qué nombre.

## Independencia y limpieza

Usa las cuentas fijas del seed (no crea personas: distinto de `tests/e2e/`, que si llega a crear
datos lo hace con prefijo `e2e-`). Los pocos casos que escriben algo (teléfono propio, nota de una
asignación propia, un `set_user_roles` con el mismo conjunto de roles) lo hacen sobre datos que
después dejan como estaban, salvo el evento de auditoría que la propia RPC registra en
`security_events` (no se puede deshacer: no hay política de `delete` para esa tabla, ni falta —
es historial real de una acción real, no un dato de prueba corrupto).

## Qué NO cubre todavía (queda para TEST-019, F18)

- El resto de las tablas de `04_Modelo_de_Datos.md` sección 7.2 (`employee_leaves`,
  `employee_availability`, `client_contacts`, `checklist_templates`, `shift_tasks`,
  `attendance_records`, `attendance_notices`, `supervision_attendance` no tienen su propio caso
  todavía).
- Las RPC que dependen de turnos y asignaciones activas (`assign_employee`, `record_check_in`,
  `notify_absence`, etc.): no existen todavía en F4, nacen en fases 10 a 15.
- La variante "por interfaz" (botón o ruta oculta) de cada caso: esta carpeta es solo API directa.
- Storage (`avatars`, `branding`).
- Una segunda cuenta admin con capacidades parciales (el seed de F4 solo tiene una, con las 7).
