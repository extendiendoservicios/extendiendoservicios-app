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

De `0004_company_holidays_security_events.sql` (DB-006):

| Función                                                                             | Firma                                                                                       | Uso                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app.log_security_event(p_event_type, p_actor_id, p_target_id?, p_details?, p_ip?)` | `(security_event_type, uuid, uuid, jsonb, inet) returns security_events` `security definer` | Inserta una fila en `security_events` y la devuelve (04 sección 5). Uso interno: solo la llaman funciones `security definer` del sistema (dueñas: `postgres`, igual que la función); no es una RPC de la sección 9, así que se le revocó el `execute` que Postgres concede a `public` por defecto -- verificado en `App_dev` que `authenticated` recibe `permission denied for function log_security_event` (`42501`). |

Pendientes de tablas que todavía no existen: `current_employee_id`, `supervises_shift` y
`shares_shift` (dependen de `employees`/`shifts`/`assignments`, migración `0007`).

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

## Configuración y seguridad (04 sección 2.6, migración `0004`)

`company_settings` (singleton, `id smallint primary key check (id = 1)`: nombre, logo -- bucket
`branding` --, teléfono de soporte, texto de consentimiento de ubicación, `updated_by`/
`updated_at`; sin `created_at`/`created_by`, mismo criterio que `admin_capabilities` en `0003` --
`updated_at` nace `not null default now()` en vez de en null, porque es el único rastro temporal
de la fila). La fila la crea el seed (`DB-019`/`DB-020`), no esta migración: `App_dev` queda con
la tabla vacía hasta ese paquete (probado con el chequeo de RLS sin políticas).

`holidays` (`id`, `holiday_date unique`, `name`, traza + `deleted_at`; ni `holiday_date` ni
`name` se anotaron `not null` porque el modelo tampoco lo hace para esta tabla, a diferencia de
otras fechas del sistema como `shifts.shift_date`). `generate_shifts` (`0013`) la va a usar para
no crear turnos de servicios con `works_on_holidays = false`.

`security_events` (`id`, `event_type not null`, `actor_id`/`target_id` -- ambos referencian
`profiles.id`, igual criterio que `user_roles.granted_by` en `0003`: el nombre ya dice que
apuntan a una persona --, `details jsonb`, `ip inet`, `created_at`). Tabla de solo inserción: sin
`updated_at`/`updated_by`/`deleted_at`. Índices de 04 sección 8: `(created_at desc)` y
`(actor_id)`. Se escribe únicamente a través de `app.log_security_event(...)` (sección anterior),
desde funciones `security definer` del sistema o desde la Edge Function `admin-users` (conexión
`service_role`, que hace `insert` directo porque `bypassrls` la exime de RLS sin pasar por esta
función).

Las tres tablas nacen con RLS habilitada y sin políticas (llegan en `0012`, DB-014).

## Clientes y sedes (04 sección 2.2, migración `0005`)

`clients` (`legal_name not null`, `trade_name`, `cuit unique`, `admin_address`,
`latitude`/`longitude numeric(9,6)`, `status client_status not null default 'active'` --
decisión menor: el modelo no anota un valor por defecto, pero toda alta de pantalla nace
operable --, `notes`, traza + `deleted_at`). `CUIT_IN_USE` (06_API.md sección 15) sale de la
restricción `unique` sobre `cuit`, sin `check` de formato: el modelo describe "11 dígitos" en
prosa, no como un `check` explícito (a diferencia de, por ejemplo,
`employee_availability.end_time`), así que esa validación queda para el formulario (zod) y no
para la base.

`client_contacts` (`client_id not null`, `name not null`, `role_title`, `phone`, `email`,
`is_primary not null default false`, traza + `deleted_at`). Índice único parcial
`client_contacts_one_primary_per_client_idx` sobre `(client_id) where is_primary and
deleted_at is null`: a lo sumo un contacto principal por cliente entre los vigentes; los
contactos no principales no tienen límite.

`sites` (`client_id not null`, `name not null`, `address not null`, `city`,
`latitude`/`longitude`, `contact_name`/`contact_phone`, `access_instructions`,
`building_hours`, `phone_restricted`/`photos_not_allowed not null default false` -- informativos,
P-029 --, `restrictions_notes`, `status site_status not null default 'active'` -- mismo criterio
que `clients.status` --, traza + `deleted_at`). Nombre único por cliente entre las sedes vigentes
(`sites_client_id_name_key`, índice parcial `where deleted_at is null`, `SITE_NAME_IN_USE`).
`unique (id, client_id)` (además de la primary key en `id`) para que `services` y `shifts`
(`0007`, DB-009) puedan declarar la FK compuesta `(site_id, client_id) references
sites (id, client_id)` y así la base garantice que la sede referenciada pertenece de verdad al
cliente referenciado. Índice `sites_client_id_idx` (04 sección 8) para el listado y el mapa por
cliente.

Las tres tablas nacen con RLS habilitada y sin políticas (llegan en `0012`, DB-014).

## Empleados (04 sección 2.1, migración `0006`)

`employees` (`profile_id primary key references profiles`, `employee_number not null unique
default nextval('employee_number_seq')` -- editable, P-036 --, `dni not null unique`, `cuil`,
`address`, `birth_date`, `hire_date`, datos de contacto de emergencia, `status employee_status
not null default 'active'` -- decisión menor, mismo criterio que `clients.status` --,
`terminated_at`, `notes`, traza + `deleted_at`). "De licencia" no es un valor de `status`: se
deriva de `employee_leaves` en la vista `v_employees` (`0011`, todavía no escrita).
`employee_number_seq` es una secuencia de Postgres común (`owned by
employees.employee_number`); sus valores no son transaccionales -- un `rollback` no los
"devuelve" -- lo cual es el comportamiento estándar y no afecta a la numeración real (el legajo
es editable).

`employee_client_permissions` (`employee_id`, `client_id`, `created_by`, `created_at`, primary
key `(employee_id, client_id)`; sin `updated_at`/`deleted_at`, tal cual lo lista el modelo).
Lista vacía para un empleado = habilitado para todos los clientes (P-034).

`employee_availability` (`id`, `employee_id not null`, `weekday smallint not null check
(weekday between 0 and 6)`, `start_time`/`end_time not null check (end_time > start_time)`,
traza sin `deleted_at` -- el modelo la trata como "traza" simple, no como maestro, a diferencia
de `employee_leaves`).

`employee_leaves` (`id`, `employee_id not null`, `starts_on not null`, `ends_on` nulo = licencia
abierta, `reason`, traza + `deleted_at`, `check (ends_on is null or ends_on >= starts_on)`).
Restricción de exclusión `employee_leaves_no_overlap` con `btree_gist` (instalada por `0001`):
`exclude using gist (employee_id with =, daterange(starts_on, coalesce(ends_on, 'infinity'),
'[]') with &&) where (deleted_at is null)` -- bloquea dos licencias vigentes superpuestas del
mismo empleado; el `where` es una decisión menor (no la escribe el modelo, pero sigue el mismo
criterio que va a usar la exclusión de `assignments` en `0007` con `removed_at is null`) para que
una licencia corregida (dada de baja lógica) no siga bloqueando el rango de fechas que ocupaba.

Las cuatro tablas nacen con RLS habilitada y sin políticas (llegan en `0012`, DB-014).

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
`0001_extensions_and_schema_app.sql` (DB-001), `0002_enums.sql` (DB-002),
`0003_profiles_roles_capabilities.sql` (DB-003, DB-004, DB-005),
`0004_company_holidays_security_events.sql` (DB-006),
`0005_clients_sites.sql` (DB-007) y `0006_employees.sql` (DB-008).

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
