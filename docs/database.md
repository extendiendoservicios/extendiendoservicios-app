# Base de datos

Fuente: `04_Modelo_de_Datos.md` (`Docs/Plan_Maestro/` fuera de este repo), completo. Este
archivo resume lo que ya está aplicado en `App_dev` y cómo trabajar sobre `supabase/`; el modelo
completo (todas las tablas, RLS, vistas, RPC) sigue siendo la fuente de verdad y se cita por
sección. Se actualiza en el mismo PR que agregue o cambie algo de lo que describe (crece
paquete a paquete, F4 en adelante).

## Motor y entornos

Postgres 17 (`17.6.1.166` verificado en `App` y `App_dev`, ADR-021) en dos proyectos Supabase de
la organización `bpcfjqvpdfmepiohltbz`: `App` (producción, ref `fysuppdadwvabrjpnnoh`) y
`App_dev` (desarrollo y staging, ref `anesttvrnpsaaaxaquce`). Sin Supabase local (ADR-014): las
migraciones se escriben y se aplican contra `App_dev` con `pnpm db:push`; Docker se prende solo
como herramienta para correr pgTAP y los tests de la Edge Function (ADR-023). Detalle de cuentas
y variables en `docs/environments.md`.

## Convenciones (04 sección 0)

| Convención     | Regla                                                                                                                                                                                                                                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Esquemas       | `public` para las tablas y vistas de negocio; `app` para funciones auxiliares de permisos, trazabilidad y utilidades. Nunca al revés.                                                                                                                                                                                                                         |
| Nombres        | Identificadores en inglés, `snake_case`, tablas en plural. Las etiquetas que ve el usuario van en español con voseo.                                                                                                                                                                                                                                          |
| Claves         | `id uuid default gen_random_uuid()` en todas las tablas, salvo `profiles` (mismo `id` que `auth.users`) y `company_settings` (fila única).                                                                                                                                                                                                                    |
| Trazabilidad   | `created_at timestamptz default now()`, `updated_at timestamptz` (mantenido por el trigger `app.set_updated_at`), `created_by uuid`, `updated_by uuid` en toda tabla de negocio.                                                                                                                                                                              |
| Baja lógica    | `deleted_at timestamptz null` en los maestros. Nada se borra físicamente; las políticas RLS de roles no administrativos filtran `deleted_at is null`.                                                                                                                                                                                                         |
| Fechas y horas | Instantes en `timestamptz` (UTC en disco). Fechas de calendario en `date`, franjas en `time`, interpretadas siempre en `America/Argentina/Buenos_Aires` (única zona del sistema, ADR-019) con `app.local_ts(date, time)`. La hora de cada registro la pone `now()` dentro de la función SQL, nunca el reloj del cliente. Sin turnos que crucen la medianoche. |
| Estados        | Enumeraciones de Postgres (sección siguiente). Las transiciones válidas se verifican dentro de las funciones RPC. Los estados derivados ("sin cubrir", "sin registro", "próximo", "salida anticipada") se calculan en vistas y no se persisten.                                                                                                               |
| Coordenadas    | `latitude`/`longitude numeric(9,6)`, `accuracy_m numeric(7,1)`. Sin PostGIS: no hay cálculos geográficos en la Base.                                                                                                                                                                                                                                          |
| Acceso         | Todo acceso del frontend pasa por PostgREST con RLS. Las operaciones con reglas usan funciones `security definer` que verifican rol y capacidad adentro, con `search_path` fijo. Nunca `service_role` en el navegador.                                                                                                                                        |

## Esquema `app`

Funciones auxiliares de permisos, trazabilidad y utilidades (04 sección 5). No contiene tablas.

De `0001_extensions_and_schema_app.sql` (DB-001):

| Función                          | Firma                                          | Uso                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app.set_updated_at()`           | `() returns trigger`                           | Trigger `before update`: fija `updated_at = now()`. Se agrega en cada tabla de negocio con esa columna, desde `0003` en adelante.                                                                                                                                                                                                                                                                          |
| `app.local_ts(p_date, p_time)`   | `(date, time) returns timestamptz` `immutable` | Instante UTC de una fecha y hora locales de Argentina. Base de las columnas generadas `starts_at`/`ends_at` de `shifts` (04 sección 2.3, migración `0007`). Inmutable porque la zona no tiene horario de verano desde 2009 (ADR-019): el desplazamiento (`-03:00`) es constante todo el año, se verificó con una fecha de enero y una de julio (`supabase/tests/0001_extensions_and_schema_app.test.sql`). |
| `app.valid_weekdays(p_weekdays)` | `(smallint[]) returns boolean` `immutable`     | Verdadero si el arreglo no es nulo, tiene al menos un valor, todos entre 0 (domingo) y 6 (sábado), sin repetidos. Usada por el check de `services.weekdays` (04 sección 2.3, migración `0007`, todavía no escrita).                                                                                                                                                                                        |

De `0003_profiles_roles_capabilities.sql` (DB-003, DB-004, DB-005; todas con
`set search_path = public, app, pg_temp`, como exige `03_Plan_Maestro_Tecnico.md` sección 15):

| Función                                | Firma                                               | Uso                                                                                                                                     |
| -------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `app.jwt_roles()`                      | `() returns app_role[]` `stable`                    | Roles de la sesión actual (claim `roles` del JWT, sección 7.1). Arreglo vacío si no hay ninguno.                                        |
| `app.jwt_capabilities()`               | `() returns text[]` `stable`                        | Capacidades de la sesión actual (claim `capabilities`, solo se completa para `admin`). Arreglo vacío si no hay ninguna.                 |
| `app.has_role(p_role)`                 | `(app_role) returns boolean` `stable`               | True si la sesión tiene ese rol.                                                                                                        |
| `app.is_admin()`                       | `() returns boolean` `stable`                       | True si la sesión es `owner` o `admin`.                                                                                                 |
| `app.has_capability(p_capability)`     | `(admin_capability) returns boolean` `stable`       | True para `owner` siempre; para `admin`, si la capacidad está en el JWT.                                                                |
| `app.require_role(variadic p_roles)`   | `(app_role[]) returns void` `stable`                | Corta con `FORBIDDEN` si la sesión no tiene ninguno de los roles indicados.                                                             |
| `app.require_admin()`                  | `() returns void` `stable`                          | Corta con `FORBIDDEN` si la sesión no es `owner` ni `admin`.                                                                            |
| `app.require_capability(p_capability)` | `(admin_capability) returns void` `stable`          | Corta con `FORBIDDEN` si la sesión no tiene la capacidad indicada.                                                                      |
| `app.handle_new_user()`                | `() returns trigger` `security definer`             | Trigger `after insert on auth.users`: crea la fila de `profiles` (nombre y apellido desde `raw_user_meta_data`; si faltan, queda `''`). |
| `app.prevent_last_owner_removal()`     | `() returns trigger`                                | Trigger `before delete or update on user_roles`: rechaza (`LAST_OWNER`) quitar el rol `owner` a la última persona que lo tiene.         |
| `app.custom_access_token_hook(event)`  | `(jsonb) returns jsonb` `stable` `security definer` | Hook de Auth (sección siguiente).                                                                                                       |

Pendientes de tablas que todavía no existen: `current_employee_id`, `supervises_shift` y
`shares_shift` (dependen de `employees`/`shifts`/`assignments`), y `log_security_event`
(depende de `security_events`, migración `0004`).

Además, `0001` agrega la extensión `btree_gist` (esquema `extensions`), que van a usar las
restricciones de exclusión de `employee_leaves` (`0006`) y `assignments` (`0007`).

## Personas y acceso (04 sección 2.1, migración `0003`)

`profiles` (una fila por persona con usuario; `id` = `auth.users.id`, la crea
`app.handle_new_user()`), `user_roles` (roles por persona, PK `(profile_id, role)`, ADR-007) y
`admin_capabilities` (capacidades por administrador, PK `(profile_id, capability)`, ADR-006). El
owner tiene todas las capacidades implícitamente y no aparece en esta tabla. La regla "siempre
queda al menos un owner" la aplica el trigger `app.prevent_last_owner_removal()` (código de error
`LAST_OWNER`, antes de borrar o actualizar la última fila `owner` de `user_roles`).

**RLS habilitada, todavía sin políticas.** Las tres tablas nacen con
`alter table ... enable row level security` en la misma migración que las crea, aunque las
políticas de la sección 7.2 llegan recién en `0012_rls_policies.sql` (DB-014). Esto no es
opcional: se verificó en `App_dev` que el ACL por defecto del esquema `public` ya concede
`select/insert/update/delete` a `anon` y a `authenticated` en cuanto `postgres` crea una tabla
ahí (`select * from pg_default_acl where defaclnamespace = 'public'::regnamespace`), así que sin
`enable row level security` inmediato cualquier tabla nueva quedaría expuesta por PostgREST desde
el momento en que la migración se aplica y hasta que 0012 agregue las políticas -- inaceptable
porque `App_dev` también sirve de staging. **Toda migración de acá en adelante que cree una tabla
tiene que habilitar RLS en el mismo archivo**, aunque sus políticas lleguen después. Mientras no
hay políticas, el acceso queda denegado a todos salvo el dueño de la tabla y los roles con el
atributo `bypassrls` (`postgres`, `service_role`; se comprobó con
`select rolname, rolbypassrls from pg_roles` que ni `authenticated`/`anon` ni
`supabase_auth_admin` lo tienen).

`authenticated` tiene `usage` sobre el esquema `app` desde esta migración (antes no tenía ni eso,
verificado con `has_schema_privilege`): sin ese grant de esquema, ninguna política RLS que use
`app.has_role(...)` (o cualquier otra función auxiliar) podría evaluarse desde una sesión
autenticada en `0012`, sin importar el `execute` de la función en sí (Postgres ya concede
`execute` a `public` -- y por lo tanto a `anon`/`authenticated` -- al crear una función nueva,
salvo que se revoque explícitamente). No se le da a `anon`, que no participa de ninguna política
basada en rol (sección 7.2: "anon solo `v_public_branding`").

## Hook de Auth: `app.custom_access_token_hook` (04 sección 7.1, DB-004)

Agrega los claims `roles` (siempre) y `capabilities` (solo si el rol `admin` está entre los
roles de la persona) a cada JWT, leyendo `user_roles`/`admin_capabilities`. Habilitado en
`supabase/config.toml` (`[auth.hook.custom_access_token]`, `uri =
"pg-functions://postgres/app/custom_access_token_hook"`) y aplicado a `App_dev` con
`pnpm exec supabase config push` (`docs/environments.md` tiene el detalle de cuentas y el
comando para que Mike lo aplique a `App` cuando corresponda).

Sigue el patrón oficial de Supabase para el "Custom Access Token Hook"
(<https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook>): firma
`(event jsonb) returns jsonb` que devuelve el mismo `event` con `claims` modificado
(`jsonb_set`), y los grants que solo permiten invocarlo a `supabase_auth_admin`:

```sql
grant usage on schema app to supabase_auth_admin;
grant execute on function app.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function app.custom_access_token_hook(jsonb) from public, anon, authenticated;
```

Verificado en `App_dev`: `authenticated` recibe `permission denied for function
custom_access_token_hook` (`42501`) al intentar llamarlo.

**Diferencia deliberada con el ejemplo oficial:** la documentación de Supabase no marca su
función de ejemplo `security definer` y en cambio le da a `supabase_auth_admin` acceso directo a
la tabla que consulta. Acá no alcanza, porque esta base habilita RLS en cuanto crea cada tabla
(sección anterior) y `supabase_auth_admin` **no** tiene el atributo `bypassrls` (verificado con
`select rolbypassrls from pg_roles`; sí lo tienen `postgres` y `service_role`). Por eso
`app.custom_access_token_hook` es `security definer`: corre con los permisos de quien aplicó la
migración, sin pasar por RLS, y no hace falta darle a `supabase_auth_admin` acceso directo a
`user_roles`/`admin_capabilities`.

## Enumeraciones (04 sección 3)

Las 15 enumeraciones del modelo, en el esquema `public`, migración `0002_enums.sql`. Agregar un
valor más adelante es `alter type ... add value ...`, sin rehacer nada: así entran los estados de
los módulos futuros.

| Enum                  | Valores (en orden)                                                                                                                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app_role`            | `owner`, `admin`, `supervisor`, `employee`                                                                                                                                                   |
| `admin_capability`    | `manage_users`, `cancel_shifts`, `edit_ratings`, `edit_checklists`, `manage_attendance`, `generate_shifts`, `manage_supervisions`                                                            |
| `client_status`       | `active`, `suspended`, `closed`                                                                                                                                                              |
| `site_status`         | `active`, `inactive`                                                                                                                                                                         |
| `employee_status`     | `active`, `terminated`                                                                                                                                                                       |
| `service_status`      | `active`, `paused`, `ended`                                                                                                                                                                  |
| `shift_status`        | `scheduled`, `assigned`, `in_progress`, `completed`, `cancelled`                                                                                                                             |
| `assignment_status`   | `expected`, `delay_notified`, `absence_notified`, `present`, `finished`                                                                                                                      |
| `task_status`         | `pending`, `in_progress`, `done`, `not_done`                                                                                                                                                 |
| `attendance_kind`     | `check_in`, `check_out`                                                                                                                                                                      |
| `attendance_source`   | `employee_app`, `admin`                                                                                                                                                                      |
| `notice_kind`         | `delay`, `absence`                                                                                                                                                                           |
| `absence_reason`      | `illness`, `personal`, `procedure`, `transport`, `other`                                                                                                                                     |
| `supervision_status`  | `assigned`, `in_progress`, `completed`, `not_done`, `cancelled`                                                                                                                              |
| `security_event_type` | `sign_in`, `sign_in_failed`, `user_created`, `user_deactivated`, `user_reactivated`, `password_reset_by_admin`, `sessions_revoked`, `roles_changed`, `capabilities_changed`, `email_changed` |

Las etiquetas en español para pantalla están en `04_Modelo_de_Datos.md` sección 3; no se
duplican acá para no desincronizarse.

## Migraciones aplicadas

Ver `supabase/migrations/README.md` para la tabla completa y actualizada. Hasta este paquete:
`0001_extensions_and_schema_app.sql` (DB-001), `0002_enums.sql` (DB-002) y
`0003_profiles_roles_capabilities.sql` (DB-003, DB-004, DB-005).

## Cómo escribir una migración

1. Un archivo por bloque de `04_Modelo_de_Datos.md` sección 11, numerado en ese orden
   (`0003_...`, `0004_...`, ...). Nunca se edita un archivo ya aplicado en `App_dev`: un cambio
   posterior es una migración nueva.
2. Objetos schema-calificados siempre (`public.mi_tabla`, `app.mi_funcion`), sin depender de
   `search_path` implícito.
3. Todo lo que la sección 0 exige (trazabilidad, baja lógica, RLS habilitada, `security_invoker`
   en vistas, `security definer` + `search_path` fijo en RPC) se agrega en el mismo archivo que
   crea el objeto, salvo que el modelo lo separe explícitamente en su propio archivo (por ejemplo,
   las políticas RLS van todas juntas en `0012_rls_policies.sql`). En particular: **toda tabla
   nueva lleva `alter table ... enable row level security` en el mismo archivo que la crea**,
   aunque sus políticas lleguen recién en `0012` -- ver "Personas y acceso" más abajo para por
   qué no es opcional (el ACL por defecto de `public` ya expone las tablas nuevas a
   `anon`/`authenticated`). Toda función nueva de `app` lleva `set search_path` fijo desde que se
   crea (lección de P04.1: las tres funciones de `0001` quedaron sin él y se corrigieron recién en
   `0018_grants.sql`).
4. Cada migración trae su/s test/s pgTAP (`supabase/tests/`, ver esa carpeta) antes de darse por
   terminada.
5. `pnpm exec supabase db push --dry-run` para previsualizar, después `pnpm db:push` contra
   `App_dev` (nunca contra `App` sin encargo explícito de F20). `pnpm exec supabase migration
list` tiene que mostrar el archivo igual en local y en remoto.
6. Si el esquema público cambió, `pnpm db:types` (dos veces: la segunda no debe generar diff).

## Cómo correr pgTAP (DB-022, TEST-001)

`pnpm db:test` (`scripts/db-test.sh`) corre `supabase test db`, que ejecuta `pg_prove` dentro de
un contenedor:

- **Local:** con Docker Desktop prendido, verificar primero que el servidor responde
  (`docker version` tiene que devolver también la sección `Server`, no solo `Client`). Si no
  responde, `pnpm db:test` (y por lo tanto `supabase test db --linked`) va a fallar: no hay otra
  vía sin Docker (ADR-023). Con Docker respondiendo, corre contra el proyecto vinculado
  (`App_dev`).
- **CI:** con la variable `SUPABASE_DB_URL_DEV` (secreto de GitHub), corre con `--db-url` contra
  `App_dev`, en un runner que ya trae Docker.

`App_dev` también sirve de staging, así que ningún archivo de test puede dejar cambios: la
convención completa (transacción con `rollback`, `set local role postgres`, `search_path`,
creación de la extensión `pgtap` dentro de esa misma transacción, nombre de archivo, fixtures de
rol) está en `supabase/tests/README.md`.

Con `--linked`, la CLI entra con el rol temporal `cli_login_postgres`, que es miembro de
`postgres` pero **no hereda** sus permisos: por eso cada archivo empieza con
`set local role postgres`. Sin esa línea, las aserciones fallan con
`function plan(integer) does not exist`.

## Tipos para el frontend

`src/lib/database.types.ts` se genera con `pnpm db:types` (`supabase gen types --linked`) contra
el proyecto vinculado. Se regenera siempre que cambia el esquema público y se commitea junto con
la migración; el CI falla si queda diferencia (`git diff --exit-code`, DB-021).
