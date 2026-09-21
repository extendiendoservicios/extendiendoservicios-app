# `supabase/tests`

Tests pgTAP (`*.sql`), uno o más por migración: estructura y restricciones (unicidad,
exclusión, checks), transiciones de las RPC y políticas RLS por rol (owner, admin, supervisor,
employee) sobre el seed, usando `tests.as_user(email)` (TEST-002, desde P04.2).

`pnpm db:test` (`scripts/db-test.sh`, DB-022) los corre con `supabase test db`:

- en una máquina de desarrollo, contra el proyecto vinculado (`--linked`). Requiere Docker
  Desktop prendido — `supabase test db` ejecuta `pg_prove` en un contenedor (Docker como
  herramienta de pruebas, ADR-023; sin Supabase local, ADR-014) — y verificar antes con
  `docker version` que el servidor responde;
- en CI, contra `App_dev` con la cadena de conexión del secreto `SUPABASE_DB_URL_DEV`
  (`--db-url`), en un runner que ya trae Docker.

`App_dev` también sirve de staging: **ninguna corrida puede dejar cambios**. Por eso:

## Convención de cada archivo

```sql
begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

select plan(<n>);

-- assertions (has_table, has_column, is, ok, results_eq, enum_has_labels, ...)

select * from finish();

rollback;
```

- `set local role postgres` es obligatorio y va primero. Con `--linked`, la CLI entra con un rol
  temporal, `cli_login_postgres`, que es **miembro de `postgres` pero no hereda sus permisos**:
  sin tomar el rol no hay acceso al esquema `extensions` ni a `public`, y cualquier aserción
  falla con `function plan(integer) does not exist` o `permission denied for schema extensions`.
  En CI la conexión ya es `postgres`, así que la línea no cambia nada.
- `set local search_path` hace visibles las funciones de pgTAP (viven en `extensions`, que no
  está en el `search_path` de la sesión) y el esquema `app`.
- La extensión `pgtap` **no** va en una migración (las migraciones también llegan a
  producción): se crea con `create extension if not exists ... with schema extensions` dentro
  de la misma transacción del archivo, así que el `rollback` también deshace su creación cuando
  no estaba instalada de antes. Además, `supabase test db` la instala antes de la corrida y la
  desinstala al terminar: verificado el 20 sep 2026 en `App_dev` (se borró la extensión, se
  corrió `pnpm db:test` y al terminar `pg_extension` volvió a quedar sin `pgtap`). La línea del
  archivo igual se mantiene, para que cada test se pueda correr suelto con `psql`.
- Todo el archivo es una única transacción que termina en `rollback`, nunca en `commit`: lo que
  el test crea (filas, tablas temporales, tipos) desaparece solo. Las tablas de prueba se
  declaran `temporary` (con `on commit drop` de más, por las dudas) en vez de tablas
  permanentes.
- Ningún test depende del orden de ejecución ni de datos que haya dejado otro test: lo que
  necesita lo crea al principio y lo consume dentro de la misma transacción.
- Nombre de archivo: `<NNNN>_<nombre-de-la-migración>.test.sql`, calcado del nombre del archivo
  de `supabase/migrations/` que cubre (por ejemplo, `0001_extensions_and_schema_app.test.sql`
  para `0001_extensions_and_schema_app.sql`). Cuando una migración necesita más de un archivo de
  test (por tamaño), se agrega un sufijo (`0007_services_shifts_assignments_rls.test.sql`).
- Todos los `.sql` quedan en el **primer nivel** de `supabase/tests/` (sin subcarpetas): el CI
  los detecta con `find supabase/tests -maxdepth 1 -name '*.sql'` para decidir si corre el paso
  de pgTAP (`.github/workflows/ci.yml`).

## Fixtures de rol (`tests.as_user`, TEST-002, desde P04.2)

Para probar RLS por rol (owner, admin, supervisor, employee) sobre las filas del seed, cada
archivo que lo necesite crea, dentro de su propia transacción, un esquema `tests` (si no existe)
con la función `tests.as_user(email)` que fija los claims de sesión (`request.jwt.claims`, rol
`authenticated`) como si esa persona del seed hubiese iniciado sesión, para que las políticas RLS
se evalúen igual que en producción. Ese esquema y esa función:

- **no** se crean en una migración (no son de negocio ni llegan a producción);
- se definen dentro de la transacción de cada archivo que los use, igual que la extensión
  `pgtap`, así el `rollback` los deja sin rastro en `App_dev`;
- se apoyan en el seed (`supabase/seed.sql`, DB-019) para resolver el `profile_id` de cada
  email de referencia.

La función se escribe en TEST-002 (P04.2); hasta entonces, los tests de estructura y
restricciones (los que no requieren un rol autenticado) no la usan.

## Qué queda pendiente de decidir en cada tarea de dominio

Cada tarea `DB-0xx` de una tabla o vista agrega, además de sus tests de estructura, uno de RLS
por rol usando `tests.as_user`. Las funciones RPC (sección 9 del modelo) se prueban con pgTAP de
transición de estado en la fase que las implementa (`08_Fases_y_Backlog.md`).
