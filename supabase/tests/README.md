# `supabase/tests`

Tests pgTAP (`*.sql`), uno o más por migración: estructura y restricciones (unicidad,
exclusión, checks), transiciones de las RPC y políticas RLS por rol (owner, admin, supervisor,
employee) sobre el seed, usando `tests_<NNNN>.as_user(email)` (TEST-002, desde P04.2).

`pnpm db:test` (`scripts/db-test.sh`, DB-022) los corre con `supabase test db`, repartidos en 3
tandas en paralelo (ver «Corrida en paralelo» más abajo):

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

## Fixtures de rol (`tests_<NNNN>.as_user`, TEST-002, desde P04.2)

Para probar RLS por rol (owner, admin, supervisor, employee) sobre filas conocidas, cada archivo
que lo necesite crea, dentro de su propia transacción, un esquema auxiliar **propio** (`tests_<NNNN>`,
con el número del archivo y una letra si hay varios con el mismo número: `tests_0012b`; nunca
`tests` a secas, ver «Corrida en paralelo») con la
función `tests_<NNNN>.as_user(p_email text)` que fija los claims de sesión (`request.jwt.claims`, rol
`authenticated`) como si esa persona hubiese iniciado sesión, para que las políticas RLS y las
funciones de permisos (`app.has_role`, `app.is_admin`, `app.has_capability`, ...) se evalúen
igual que en producción. Patrón (`select tests_<NNNN>.as_user('email@ejemplo.com');` antes de las
aserciones que necesiten esa sesión):

```sql
create schema if not exists tests_<NNNN>;

-- authenticated/anon necesitan USAGE para poder invocarla de nuevo después de que una llamada
-- previa haya cambiado el rol activo (si no se va a encadenar más de una llamada en el mismo
-- archivo, alcanza con dársela a authenticated).
grant usage on schema tests_<NNNN> to authenticated, anon;

create or replace function tests_<NNNN>.as_user(p_email text)
returns void
language plpgsql
as $$
declare
  v_user_id uuid;
  v_claims jsonb;
begin
  -- Vuelve a postgres primero: si se llama de nuevo después de una simulación previa (rol
  -- activo != postgres), authenticated/anon no tienen SELECT sobre auth.users.
  perform set_config('role', 'postgres', true);

  select id into v_user_id from auth.users where email = p_email;

  if v_user_id is null then
    raise exception 'tests_<NNNN>.as_user: no existe auth.users.email = %', p_email;
  end if;

  -- Arma los claims con el mismo hook que usa producción (app.custom_access_token_hook, DB-004):
  -- así el fixture no duplica la lógica de roles/capacidades y cualquier cambio futuro al hook
  -- se refleja acá solo.
  v_claims := (
    app.custom_access_token_hook(
      jsonb_build_object(
        'user_id', v_user_id::text,
        'claims', jsonb_build_object('sub', v_user_id::text, 'email', p_email, 'role', 'authenticated')
      )
    )
  ) -> 'claims';

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', v_claims::text, true);
end;
$$;

grant execute on function tests_<NNNN>.as_user(text) to authenticated, anon;
```

Ese esquema y esa función:

- **no** se crean en una migración (no son de negocio ni llegan a producción);
- se definen dentro de la transacción de cada archivo que los use, igual que la extensión
  `pgtap`, así el `rollback` los deja sin rastro en `App_dev`;
- hasta que exista el seed (`supabase/seed.sql`, DB-019), cada test crea sus propias filas de
  `auth.users` (con `raw_user_meta_data` para nombre y apellido) y de `user_roles`/
  `admin_capabilities` según el rol que necesite, y recién ahí llama a `tests_<NNNN>.as_user` con el
  email que acaba de insertar -- ver
  `0003_profiles_roles_capabilities_permissions.test.sql` (TEST-002) para un ejemplo completo.
  **Cuando exista el seed**, los tests de dominio (RLS por tabla) van a poder saltarse ese paso y
  llamar directo a `tests_<NNNN>.as_user('email-del-seed@...')`, porque las filas de `auth.users` y de
  roles ya van a estar puestas por `seed.sql`/`scripts/seed-dev.ts`; la función en sí no cambia.
- vuelven a `postgres` al principio del cuerpo antes de tocar `auth.users`, porque `authenticated`
  no tiene privilegios sobre esa tabla: sin ese paso, una segunda llamada a `tests_<NNNN>.as_user` en el
  mismo archivo (para simular a otra persona) falla con `permission denied for table users`.

## Qué queda pendiente de decidir en cada tarea de dominio

Cada tarea `DB-0xx` de una tabla o vista agrega, además de sus tests de estructura, uno de RLS
por rol usando `tests_<NNNN>.as_user`. Las funciones RPC (sección 9 del modelo) se prueban con pgTAP de
transición de estado en la fase que las implementa (`08_Fases_y_Backlog.md`).

## Corrida en paralelo (30 oct 2026)

En CI (`--db-url`), `pnpm db:test` sin argumentos reparte los archivos en 3 tandas balanceadas por
duración y corre 3 `supabase test db` a la vez contra la misma base (`scripts/db-test.sh`; ~24 min
de a uno, casi todo latencia de red). **En local, con `--linked`, corre en una sola tanda**: la CLI
entra con un rol temporal (`cli_login_postgres`) cuya contraseña regenera cada proceso, así que
tres corridas a la vez se invalidan entre sí (`password authentication failed`) y el pooler las
frena con `ECIRCUITBREAKER`. Si por algún motivo tenés una cadena de conexión directa, exportando
`SUPABASE_DB_URL_DEV` el script usa tandas también en local. Cada tanda deja su salida en un archivo y se imprime entera, con un título
por tanda, al terminar; el comando falla si falla cualquiera. Un archivo nuevo cae solo en la
tanda menos cargada (no hay que registrarlo en ningún lado).

Como los archivos se ejecutan al mismo tiempo, **ningún archivo puede repetir una clave única con
otro**: dos transacciones que insertan la misma clave única (o crean el mismo objeto) no fallan, se
esperan una a la otra hasta que la primera termina (y si cruzan el orden de las filas, Postgres
aborta una por deadlock). Reglas:

- **Prefijo propio de uuid por archivo** (`e2500003-...`), y no repetir el de otro archivo; antes
  de elegirlo, `grep -rl 'e2500003' supabase/tests`.
- **Emails** de `auth.users` con una marca propia del archivo (`test-db0070mov-owner@example.com`).
- **`dni`, `employee_number` (legajo explícito), `cuit`, códigos de artículo, nombres únicos de
  categorías** y toda otra clave única que el fixture inserte: valores propios, sin coincidir con
  ningún otro archivo.
- **Esquema auxiliar propio** (`tests_<NNNN>`): `create schema if not exists tests;` compartido
  hacía que 64 archivos se esperaran entre sí por el esquema y por `as_user`. `db-test.sh` frena la
  corrida si dos archivos crean el mismo esquema.
- Lo que el archivo **lee** del seed (no lo inserta) puede coincidir con otros: es de solo lectura.
  Evitá, en cambio, hacer `update`/`delete` sobre filas del seed que otro archivo también toque:
  el segundo espera hasta el `rollback` del primero.
- **Filas globales compartidas**: `company_settings` tiene una sola fila, y cada alta de `clients`
  toma un lock de aviso global (`app.next_client_calendar_color`, 0067) que dura hasta el
  `rollback`. Un archivo que escribe `company_settings` (directo o con `set_media_retention` /
  `set_geofence_radius`) puede cruzarse en un deadlock con otro. `db-test.sh` los detecta por
  contenido (`grep` de `company_settings|set_media_retention|set_geofence_radius`) y los pone a
  todos en la misma tanda, que corre de a un archivo: no hay que hacer nada, pero conviene que un
  archivo nuevo no escriba esa fila si no lo necesita. Cualquier otra fila global que un archivo
  modifique tiene el mismo problema; avisá y se suma a ese `grep`.
- Los valores de fecha (`2199-...`) no son claves únicas por sí solos (el turno es único por
  servicio y fecha, y el servicio es del archivo), pueden repetirse.

## Correr archivos sueltos

```bash
pnpm db:test supabase/tests/0070_p25_1_insumos_movimientos.test.sql
pnpm db:test supabase/tests/0012_rls_policies_*.test.sql
```

Con argumentos, el script corre solo esos archivos en una única corrida (sin tandas), contra el
proyecto vinculado o contra `SUPABASE_DB_URL_DEV` según el entorno. Es lo que tienen que usar los
agentes de backend para probar lo que tocan; la suite completa la corre el CI. `DB_TEST_TANDAS=2`
baja la cantidad de tandas en la corrida completa si el pooler llegara a rechazar conexiones.
