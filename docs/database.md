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
Hasta ahora (DB-001, migración `0001_extensions_and_schema_app.sql`):

| Función                          | Firma                                          | Uso                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app.set_updated_at()`           | `() returns trigger`                           | Trigger `before update`: fija `updated_at = now()`. Se agrega en cada tabla de negocio con esa columna, desde `0003` en adelante.                                                                                                                                                                                                                                                                          |
| `app.local_ts(p_date, p_time)`   | `(date, time) returns timestamptz` `immutable` | Instante UTC de una fecha y hora locales de Argentina. Base de las columnas generadas `starts_at`/`ends_at` de `shifts` (04 sección 2.3, migración `0007`). Inmutable porque la zona no tiene horario de verano desde 2009 (ADR-019): el desplazamiento (`-03:00`) es constante todo el año, se verificó con una fecha de enero y una de julio (`supabase/tests/0001_extensions_and_schema_app.test.sql`). |
| `app.valid_weekdays(p_weekdays)` | `(smallint[]) returns boolean` `immutable`     | Verdadero si el arreglo no es nulo, tiene al menos un valor, todos entre 0 (domingo) y 6 (sábado), sin repetidos. Usada por el check de `services.weekdays` (04 sección 2.3, migración `0007`, todavía no escrita).                                                                                                                                                                                        |

El resto de las funciones de la sección 5 (`jwt_roles`, `jwt_capabilities`, `has_role`,
`is_admin`, `has_capability`, `current_employee_id`, `supervises_shift`, `shares_shift`,
`handle_new_user`, `custom_access_token_hook`, `log_security_event`) depende de tablas que
todavía no existen o del hook de Auth: llegan desde la migración `0003` (P04.2 en adelante).

Además, `0001` agrega la extensión `btree_gist` (esquema `extensions`), que van a usar las
restricciones de exclusión de `employee_leaves` (`0006`) y `assignments` (`0007`).

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
`0001_extensions_and_schema_app.sql` (DB-001) y `0002_enums.sql` (DB-002).

## Cómo escribir una migración

1. Un archivo por bloque de `04_Modelo_de_Datos.md` sección 11, numerado en ese orden
   (`0003_...`, `0004_...`, ...). Nunca se edita un archivo ya aplicado en `App_dev`: un cambio
   posterior es una migración nueva.
2. Objetos schema-calificados siempre (`public.mi_tabla`, `app.mi_funcion`), sin depender de
   `search_path` implícito.
3. Todo lo que la sección 0 exige (trazabilidad, baja lógica, RLS habilitada, `security_invoker`
   en vistas, `security definer` + `search_path` fijo en RPC) se agrega en el mismo archivo que
   crea el objeto, salvo que el modelo lo separe explícitamente en su propio archivo (por ejemplo,
   las políticas RLS van todas juntas en `0012_rls_policies.sql`).
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
