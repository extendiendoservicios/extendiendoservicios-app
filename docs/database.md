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

De `0007_services_shifts_assignments.sql` (DB-009):

| Función                        | Firma                                                | Uso                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------ | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app.sync_assignment_window()` | `() returns trigger`                                 | Trigger: mantiene `assignments.shift_date`/`"window"` (rango `[)` en UTC de la franja efectiva). `before insert or update of shift_id, start_time, end_time on assignments` recalcula la fila propia; `after update of shift_date, start_time, end_time on shifts` recalcula las asignaciones vigentes del turno (04 sección 2.3, P-053). |
| `app.current_employee_id()`    | `() returns uuid` `stable` `security definer`        | `auth.uid()` si la sesión tiene fila en `employees` (cualquiera sea su `status`), `null` si no. `security definer` porque `employees` ya tiene RLS habilitada y la función se evalúa dentro de políticas de otras tablas desde `0012`.                                                                                                    |
| `app.shares_shift(p_shift_id)` | `(uuid) returns boolean` `stable` `security definer` | True si la sesión tiene una asignación vigente (`removed_at is null`) en ese turno (P-103, "ver compañeros").                                                                                                                                                                                                                             |

De `0010_supervisions_ratings.sql` (DB-012):

| Función                            | Firma                                                | Uso                                                                                                                             |
| ---------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `app.supervises_shift(p_shift_id)` | `(uuid) returns boolean` `stable` `security definer` | True si la sesión tiene una supervisión no cancelada sobre ese turno. Pendiente desde `0007` porque dependía de `supervisions`. |

Con esto queda completa la sección 5 del modelo (todas las funciones auxiliares de `app` ya
existen).

De `0011_views.sql` (DB-013), auxiliar nuevo -- no está en la lista de la sección 5 del modelo,
se agrega para las columnas derivadas de las vistas que necesitan "hoy" en Argentina:

| Función       | Firma                      | Uso                                                                                                                                             |
| ------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `app.today()` | `() returns date` `stable` | Fecha de hoy en `America/Argentina/Buenos_Aires` (ADR-019). Usada por `v_employees` (licencia vigente) y `v_my_day` (ventana de 7 días, P-093). |

Además, `0001` agrega la extensión `btree_gist` (esquema `extensions`), que usan las
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

## Servicios, turnos y asignaciones (04 sección 2.3, migración `0007`)

El corazón de la operación. `services` (acuerdo recurrente: `client_id not null`, `site_id not
null` -- FK compuesta `(site_id, client_id) references sites (id, client_id)`, igual criterio que
la de `sites` en `0005` --, `weekdays smallint[] not null check (app.valid_weekdays(weekdays))`,
franja `check (end_time > start_time)`, `required_staff smallint not null default 1 check
(between 1 and 10)`, `valid_from`/`valid_to`, `works_on_holidays not null default true` --
decisión menor, P-050 queda POR CONFIRMAR en F10 --, horas informativas, `status service_status
not null default 'active'`, traza + `deleted_at`).

`shifts` (ocurrencia fechada: `service_id` nulo = turno puntual, `client_id`/`site_id not null`
con la misma FK compuesta, `shift_date`/franja/`required_staff` con los mismos checks que
`services`, `status shift_status not null default 'scheduled'`, `generated not null default
false`, `checklist_template_id uuid` **sin FK todavía** -- `checklist_templates` nace en `0008`,
después en el orden de la sección 11; la FK se agrega ahí con `alter table` --, campos de
cancelación con `check` de conjunto -- `cancelled_at`/`cancelled_by`/`cancel_reason` obligatorios
los tres cuando `status = 'cancelled'` --, traza + `deleted_at`). Columnas generadas `starts_at`/
`ends_at timestamptz generated always as (app.local_ts(shift_date, start_time/end_time)) stored`
(ADR-019; probado con una fecha de enero y otra de julio, mismo desplazamiento `-03:00`, sin
horario de verano). Unicidad parcial `shifts_service_id_shift_date_key` sobre `(service_id,
shift_date) where service_id is not null and deleted_at is null` (ADR-010): un turno **cancelado**
(`status = 'cancelled'`, `deleted_at` sigue `null`) **sigue bloqueando** el día -- la restricción
solo excluye `deleted_at is null`, no el `status` --; un turno **dado de baja lógica** (`deleted_at`
no nulo) sí libera el día. Índices de 04 sección 8: `(shift_date)`, `(site_id, shift_date)`,
`(status) where status in ('scheduled','assigned','in_progress')` (el par `(service_id,
shift_date)` ya lo cubre el índice único parcial, no se duplica).

`assignments` (empleado × turno: `start_time`/`end_time time null` -- franja propia opcional,
P-046 --, con un `check` propio (`end_time > start_time` cuando ambas puntas vienen indicadas,
decisión menor: el modelo no lo pide explícito) que en la práctica queda de respaldo porque el
constructor de `tstzrange` del trigger ya rechaza antes una franja invertida con `22000`, ver test;
`status assignment_status not null default 'expected'`; baja lógica con `removed_at`/`removed_by`/
`removed_reason`, los dos últimos obligatorios cuando el primero no es nulo; **sin** `deleted_at`
-- el modelo la lista como "Traza" simple --; `shift_date date not null`/`"window" tstzrange not
null` denormalizadas, con la columna citada entre comillas dobles porque `window` es palabra
reservada de SQL, verificado al aplicar la migración: `syntax error at or near "window"`).

El trigger `app.sync_assignment_window()` mantiene `shift_date`/`"window"`: `before insert or
update of shift_id, start_time, end_time on assignments` recalcula la fila propia leyendo el
turno referenciado (franja efectiva = la propia si existe, si no la del turno; rango `"[)"` --
media abierta -- para que dos turnos consecutivos sin hueco, por ejemplo 08-12 y 12-16, no se
consideren superpuestos); `after update of shift_date, start_time, end_time on shifts` recalcula
**todas** las asignaciones que referencian ese turno (incluidas las quitadas, `removed_at not
null` -- decisión menor: no se filtró, así queda documentado; no afecta ninguna regla porque las
quitadas ya están fuera de la exclusión y de las consultas activas) cuando cambia la fecha o la
franja del turno (`update_shift_time`, `0013`, todavía no escrita). Verificado en `App_dev`: al
correr el turno de 08:00 a 07:00, la asignación sin franja propia pasa de `[11:00,15:00)` a
`[10:00,15:00)` UTC (07:00-12:00 ART) mientras que la asignación con franja propia (09:00-10:00
ART) no se mueve.

Restricción de exclusión `assignments_no_overlap` (P-053) `exclude using gist (employee_id with
=, "window" with &&) where (removed_at is null)`: bloquea que el mismo empleado tenga dos
asignaciones vigentes con ventanas superpuestas (verificado: dos turnos que se pisan -> `23P01`;
adyacentes o con franja propia que evita el cruce -> entran; una asignación quitada libera el
rango). Unicidad parcial `assignments_shift_id_employee_id_key` sobre `(shift_id, employee_id)
where removed_at is null`: un empleado no puede tener dos asignaciones vigentes del mismo turno,
_independiente_ de si las franjas se pisan o no (verificado con dos franjas que no se solapan:
igual la rechaza la unicidad, no la exclusión). Índices de 04 sección 8: `(employee_id,
shift_date)`, `(shift_id) where removed_at is null`.

`app.current_employee_id()` (`auth.uid()` si existe fila en `employees`, sea cual sea su
`status`) y `app.shares_shift(p_shift_id)` (asignación vigente del usuario en ese turno) nacen acá
porque ya existen `employees`/`shifts`/`assignments`; ambas `security definer` por el mismo motivo
que el hook de `0003` (evaluarse dentro de políticas de otras tablas desde `0012` sin pasar de
nuevo por RLS). `app.supervises_shift` queda para `0010` (necesita `supervisions`).

Las tres tablas nacen con RLS habilitada y sin políticas (llegan en `0012`, DB-014).

## Checklists y tareas (04 sección 2.4, migración `0008`, ADR-011)

`checklist_templates` (`client_id not null`, `site_id null` -- FK compuesta `(site_id, client_id)
references sites (id, client_id)`, con `MATCH SIMPLE` la restricción no se evalúa cuando `site_id`
es nulo --, `name not null` -- decisión menor, el modelo no lo anota pero toda plantilla necesita
nombre --, `is_active not null default true`, traza + `deleted_at`). Único parcial
`checklist_templates_client_site_key` sobre `(client_id, coalesce(site_id,
'00000000-0000-0000-0000-000000000000')) where deleted_at is null`: una plantilla por cliente y
una por sede como máximo, entre las vigentes.

`checklist_template_items` (`template_id not null`, `position not null` -- decisión menor, igual
criterio que `name` arriba --, `title not null`, `description`, `is_required not null default
true` P-059, traza + `deleted_at`). Unicidad `(template_id, position) deferrable initially
deferred`: permite reordenar dos ítems en un solo `update` (intercambiar posiciones) sin que la
restricción se dispare a mitad de camino -- probado con un `update ... case id when ...`; para
verlo fallar dentro de un test pgTAP (que nunca hace `commit`) hace falta forzar `set constraints
... immediate` después del insert duplicado, porque un constraint diferido recién se evalúa al
terminar la transacción o cuando se pide explícitamente.

`shift_tasks` (copia del checklist en el turno, ADR-011: `shift_id not null`, `position`,
`title not null`/`is_required not null` copiados sin default propio, `status task_status not null
default 'pending'`, `not_done_reason` obligatorio si `status = 'not_done'` (check), traza **sin**
`deleted_at` -- el modelo la lista solo "Traza"). Índice `(shift_id, position)` (04 sección 8).

Este archivo también agrega la FK que había quedado pendiente en `0007`:
`shifts.checklist_template_id references checklist_templates (id)` (sin `checklist_templates` no
existía todavía cuando se creó `shifts`).

Las tres tablas nacen con RLS habilitada y sin políticas (llegan en `0012`, DB-014).

## Asistencia (04 sección 2.3, migración `0009`, ADR-009)

`attendance_records` (inicio y fin por asignación: `assignment_id not null`, `kind
attendance_kind not null`, `recorded_at not null` -- la pone `now()` dentro de la RPC, nunca el
reloj del cliente --, coordenadas `numeric(9,6)`/`numeric(7,1)` opcionales -- solo si el empleado
concede el permiso, ninguna pantalla de la Base las muestra --, `source attendance_source not
null`, `recorded_by`, `reason` obligatorio cuando `source = 'admin'` (check), `unique
(assignment_id, kind)`: un `check_in` y un `check_out` por asignación). Índice `(assignment_id)`
(04 sección 8).

`attendance_notices` (avisos de demora y ausencia: `assignment_id not null`, `kind notice_kind not
null`, `minutes_late` obligatorio y en `1..600` cuando `kind = 'delay'` (check), `reason_code
absence_reason` obligatorio cuando `kind = 'absence'` (check), `reason_text` obligatorio cuando
`reason_code = 'other'` (check), `reported_by`, `source not null`). Varios avisos por asignación
permitidos (probado: demora + dos ausencias sobre la misma asignación, las tres filas quedan).
Índice `(assignment_id, created_at desc)` (04 sección 8, "último aviso").

Solo estructura: las reglas de negocio (ventana de aviso, transición de la asignación) las
verifican las RPC de asistencia (`0014`, fase 13/14). Las dos tablas nacen con RLS habilitada y
sin políticas (llegan en `0012`, DB-014).

## Supervisiones (04 sección 2.5, migración `0010`)

`supervisions` (una por turno y supervisor entre las no canceladas: `shift_id not null`,
`supervisor_id not null references employees (profile_id)`, `status supervision_status not null
default 'assigned'`, `assigned_by`/`assigned_at not null default now()` -- decisión menor, mismo
criterio que otras columnas `created_at`-like con default `now()` --, `not_done_reason` obligatorio
si `status = 'not_done'` (check), `cancel_reason` obligatorio si `status = 'cancelled'` (check),
`general_notes`, `criteria_snapshot jsonb`, traza **sin** `deleted_at`). Único parcial
`supervisions_shift_id_supervisor_id_key` sobre `(shift_id, supervisor_id) where status <>
'cancelled'` (P-086, sin supervisión espontánea): cancelar una libera el par para una nueva.
Índices `(supervisor_id, status)`, `(shift_id)` (04 sección 8).

`supervision_attendance` (inicio y fin de la supervisión, por sede: mismas columnas y mismo
criterio que `attendance_records` -- hora del servidor, coordenadas opcionales sin validar,
ADR-009 --, `unique (supervision_id, kind)`).

`ratings` (calificación por asignación: `supervision_id not null`, `assignment_id not null`,
`score smallint not null check (between 1 and 5)`, `comment`, traza sin `deleted_at`,
`updated_by` distingue ediciones administrativas, `unique (supervision_id, assignment_id)`). La
RPC `rate_employee` (`0015`, todavía no escrita) va a verificar que `assignment_id` pertenezca al
turno de la supervisión; esta migración no agrega ese `check` porque cruza dos tablas y el modelo
lo deja para "RPC y trigger" si hace falta. Índice `(assignment_id)` (04 sección 8).

`rating_criteria` (guía de texto, sin puntaje por criterio: `position`, `title not null`,
`description`, `valid_from not null default current_date`, `valid_to null` -- cerrar un criterio
es poner `valid_to`, no se borra, P-087 --, traza sin `deleted_at`).

`app.supervises_shift(p_shift_id)` (existe supervisión no cancelada del usuario sobre ese turno)
nace acá porque necesitaba esta tabla; queda pendiente desde `0007`. Con esto se completa la
sección 5 del modelo.

Las cuatro tablas nacen con RLS habilitada y sin políticas (llegan en `0012`, DB-014).

## Vistas (04 sección 4, migración `0011`, DB-013)

Las diez vistas de `04_Modelo_de_Datos.md` sección 4, todas `with (security_invoker = true)`: la
visibilidad de FILAS la deciden las políticas RLS de las tablas base (`0012`), no la vista -- la
vista solo proyecta y calcula columnas derivadas.

Agrega `app.today()` (`() returns date` `stable`), auxiliar nuevo que no está en la lista de
`04` sección 5: fecha de hoy en `America/Argentina/Buenos_Aires` (ADR-019), para no repetir
`(now() at time zone 'America/Argentina/Buenos_Aires')::date` en cada vista que la necesita
(licencia vigente de `v_employees`, ventana de 7 días de `v_my_day`).

| Vista                  | Filas                                                                                                             | Columnas derivadas (decisión de implementación)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `v_employees`          | `employees` join `profiles`                                                                                       | `effective_status` = `on_leave` si hay una `employee_leaves` vigente hoy (`deleted_at is null`, `starts_on <= hoy <= coalesce(ends_on, hoy)`), si no `employees.status`. `roles`: `array_agg` de `user_roles.role` (orden del enum, no alfabético: `owner, admin, supervisor, employee`).                                                                                                                                                                                                                                                                                                                                                                 |
| `v_shifts_board`       | `shifts` join `clients`/`sites`, conteos de `assignments`                                                         | `assigned_count`/`present_count`/`finished_count`/`absent_count`/`delayed_count` sobre asignaciones vigentes (`removed_at is null`). `display_status`: `uncovered` si `status not in (in_progress, completed, cancelled)` y `assigned_count < required_staff` y (`now() > starts_at` o hay alguna asignación vigente `absence_notified`); `upcoming` si `status in (scheduled, assigned)` y `starts_at` está entre ahora y ahora + 2 horas; si no, el `status` real. La fórmula exacta de `uncovered` es una decisión de implementación (04 la describe en prosa, sin álgebra booleana) documentada en el comentario de la migración.                     |
| `v_assignments_board`  | `assignments` join `shifts`/`clients`/`sites`/`profiles`, `attendance_records`                                    | Franja efectiva: `coalesce(start_time/end_time, turno)` y `lower/upper(assignments."window")`. `display_status = no_record` si `status in (expected, delay_notified)` y ya pasó el inicio efectivo (P-071). `minutes_late`/`minutes_early_leave` (P-076): minutos entre el registro y la hora efectiva, solo si el registro llegó después del inicio (o antes del fin, para early leave) -- `minutes_late` no está en `02_Decisiones.md`, se implementó por simetría con `minutes_early_leave`, que sí. Incluye asignaciones quitadas (`removed_at not null`): la fila queda para historia (04 sección 2.3), quien consuma la vista filtra si las quiere. |
| `v_my_day`             | `assignments` propias (`employee_id = auth.uid()` en la definición, no solo por RLS) de hoy y los próximos 7 días | `is_today`, `tasks_total`/`tasks_done` (conteo de `shift_tasks`), `changed_since_last_seen` (P-092): compara `greatest(coalesce(updated_at, created_at))` de la asignación y del turno contra `profiles.last_seen_changes_at` (`coalesce` con `-infinity` si nunca abrió Hoy: todo se marca como cambiado).                                                                                                                                                                                                                                                                                                                                               |
| `v_supervisions_admin` | `supervisions` join `shifts`/`clients`/`sites`/`profiles`                                                         | `ratings_count`, `ratings_avg` (`numeric(3,2)`, promedio simple del turno -- P-088: los promedios por empleado son módulo F).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `v_my_supervisions`    | `supervisions` propias (`supervisor_id = auth.uid()` en la definición)                                            | `assigned_employees`: `jsonb` con los empleados asignados vigentes del turno (id, nombre, estado).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `v_public_branding`    | `company_settings` (fila `id = 1`)                                                                                | Solo `name`, `logo_path`, `support_phone` (04 sección 7.2): no expone `location_consent_text` ni `updated_by`/`updated_at`. Única vía de `anon` hacia `company_settings`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `v_people_basic`       | `profiles`                                                                                                        | Solo `profile_id`, `first_name`, `last_name`, `avatar_path` (04 sección 7.2, P-103): la vista recorta columnas; qué personas ve cada rol lo decide la RLS de `profiles`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `v_clients`            | `clients`, conteos de `sites`/`services`                                                                          | `sites_count` (sedes vigentes, `deleted_at is null`, sin filtrar por estado), `active_services_count` (`services.status = active` y vigente).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `v_search`             | `employees`+`profiles`, `clients`, `sites` (unión)                                                                | PROPUESTO (06_API.md sección 3): forma común `kind` (`employee`/`client`/`site`), `id`, `title`, `subtitle`, `search_text` (concatenación en minúsculas, pensada para `.ilike('search_text', '%término%')` desde el cliente). Forma a confirmar con EMP-012 (F9) si hace falta full-text search de verdad.                                                                                                                                                                                                                                                                                                                                                |

Detalle completo (fixtures, casos borde probados) en `supabase/tests/0011_views.test.sql` y
`supabase/tests/0011_views_my_day_supervisions_search.test.sql`.

## Políticas RLS (04 sección 7.2, migración `0012`, DB-014)

Tabla por tabla, sobre las 23 tablas de negocio (más dos políticas de `anon` sobre
`company_settings`, ver abajo). Convenciones:

- Roles y capacidades se leen del JWT con `app.is_admin()`, `app.has_role(...)`,
  `app.has_capability(...)`, sin subconsultas contra `user_roles`/`admin_capabilities` (04 sección
  7.1: el hook ya los puso en el token). Las subconsultas que sí aparecen resuelven "¿esta fila
  pertenece a un turno mío?" contra `assignments`/`supervisions`/`shifts` (equivalente por-fila de
  `app.shares_shift`/`app.supervises_shift` cuando la tabla no tiene un `shift_id` propio).
- Donde la escritura es "RPC" en `04` sección 7.2 (turnos, asignaciones -- salvo notas propias --,
  asistencia, tareas, supervisiones, calificaciones), esta migración no agrega política de
  insert/update/delete para ningún rol: esas RPC (fases 10 a 15) son `security definer` y no
  necesitan grant de `authenticated`.
- Ningún rol tiene política de `delete`: nada se borra físicamente (P-014, P-105); la baja es
  siempre `update` (`deleted_at`, `removed_at`, `status`).
- Las tablas con `deleted_at` filtran `deleted_at is null` en las políticas de supervisor/empleado
  (04 sección 0); owner/admin ven todo, incluidas las filas dadas de baja lógica.
- `to authenticated` en todas las políticas salvo las dos de `anon` sobre `company_settings`.

**Límite real de "solo columnas" en Postgres (decisión de Mike, tramo A de P04.5).** RLS es por
fila, no por columna. `04` sección 7.2 pide, para `profiles` (empleado: compañeros) y
`clients`/`client_contacts` (empleado: clientes de sus turnos), exponer "solo columnas" limitadas
a quien de otro modo vería la fila completa. Como las diez vistas de `0011` son `security_invoker`
(para que la RLS de las tablas base decida qué filas se ven), la única manera de que
`v_people_basic` muestre compañeros es que la política de `profiles` le dé al empleado acceso de
FILA a esas personas -- no hay forma de restringir, encima, las columnas que ve _solo para esas
filas_ sin un grant de columnas distinto por fila (que Postgres no ofrece). Resolución, distinta
según la tabla:

- `profiles`: se mantiene el acceso de fila del empleado a los perfiles de sus compañeros de turno
  (`profiles_select_employee_teammates`), sin restricción de columna en este tramo. **Riesgo
  residual aceptado por Mike:** un cliente API que consulte `profiles` en crudo para la fila de un
  compañero puede leer `contact_email`/`phone` además de nombre y foto (lo único que el frontend
  muestra, vía `v_people_basic`).
- `client_contacts`: acá sí se cierra el acceso del empleado -- `client_contacts_select_shift_party`
  es solo para `supervisor`. Los datos de contacto (teléfono, email) de la gente del cliente no los
  necesita un empleado, a diferencia del nombre del cliente en `clients`, que sí conserva su acceso
  de fila para empleado (mismo riesgo residual que `profiles`, pero acotado a
  `legal_name`/`trade_name`/`cuit`/etc., de menor sensibilidad que un teléfono o email personal).

**Guard de rol en las políticas "propias" de supervisión (decisión de consistencia, tramo A).**
`supervisions_select_own`, `supervision_attendance_select_own` y `ratings_select_own_supervision`
verifican `app.has_role('supervisor')` además de `supervisor_id = auth.uid()`. Sin ese chequeo, a
alguien a quien le quitaron el rol supervisor le seguirían apareciendo sus supervisiones,
asistencias y calificaciones pasadas por esta vía -- no es una brecha grave (ya fue supervisor de
esa fila, no ve datos ajenos), pero rompe el patrón del resto de las políticas de rol no
administrativo del archivo, que siempre exigen el rol vigente en el JWT antes de mirar la relación
de fila.

**`company_settings` y `anon`.** Es la única tabla con una política para `anon`
(`company_settings_select_anon`, `using (true)`): necesaria para que `v_public_branding` funcione
bajo `security_invoker`. A diferencia de `profiles`/`clients`, acá no hay riesgo residual de
"fila ajena con más columnas de las debidas": `company_settings` es un singleton (una sola fila
para todo el mundo), así que el recorte de columnas para `anon` (`name`, `logo_path`,
`support_phone`) sí se puede lograr con un grant de columnas más adelante (`0017_grants.sql`,
DB-017, tramo B) sin el problema de "misma fila, columnas distintas según quién mira" que sí tienen
`profiles`/`clients`. Hasta que ese grant llegue, `anon` ve la fila completa de `company_settings`
por el ACL por defecto del esquema (nota de seguridad de `0003`); `v_public_branding` igual solo
proyecta las tres columnas públicas.

**Columnas de `profiles` y `assignments.notes` pendientes de grant (tramo B).** El `update` propio
de `profiles` (`profiles_update_own`) y el `update` de `assignments.notes` por el empleado
(`assignments_update_own_notes`) están limitados por fila en este tramo (`id = auth.uid()`;
`employee_id = auth.uid()` y turno no `completed`), pero **no** todavía por columna: hasta que
`0017_grants.sql` agregue `grant update (contact_email, phone, avatar_path, location_consent_at,
last_seen_changes_at) on profiles to authenticated` y `grant update (notes) on assignments to
authenticated`, una persona autenticada podría, en su propia fila, actualizar columnas que no le
corresponden (por ejemplo `profiles.is_active`). Documentado en los comentarios de la migración
para que no se pierda al escribir `0017` (DB-017).

Detalle completo (RLS por rol, con las filas exactas esperadas sobre fixtures) en
`supabase/tests/0012_rls_policies.test.sql`,
`supabase/tests/0012_rls_policies_clients_sites_services_shifts.test.sql`,
`supabase/tests/0012_rls_policies_assignments_attendance_tasks.test.sql` y
`supabase/tests/0012_rls_policies_supervisions_ratings_settings.test.sql`. Estos dos criterios de
aceptación de F4 tienen un test explícito: un empleado autenticado no lee `ratings` (ni siquiera la
propia, P-084) ni asignaciones de turnos ajenos (P-103: sí lee las propias y las de compañeros del
mismo turno); `anon` no lee ninguna tabla de negocio salvo lo que expone `v_public_branding`
(con la salvedad de `company_settings` fila completa, documentada arriba).

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
`0005_clients_sites.sql` (DB-007), `0006_employees.sql` (DB-008),
`0007_services_shifts_assignments.sql` (DB-009), `0008_checklists_tasks.sql` (DB-010),
`0009_attendance.sql` (DB-011), `0010_supervisions_ratings.sql` (DB-012),
`0011_views.sql` (DB-013) y `0012_rls_policies.sql` (DB-014).

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
   crea (lección de P04.1: las tres funciones de `0001` quedaron sin él; la corrección está
   prevista para `0016_hardening.sql` según la numeración vigente desde el 21 sep 2026 -- ver
   `04_Modelo_de_Datos.md` sección 11 -- todavía no escrita al cierre del tramo A de P04.5).
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
