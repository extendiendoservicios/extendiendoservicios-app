# Despliegue

Fuente: `03_Plan_Maestro_Tecnico.md` secciones 3.6 (dominios y cabeceras), 3.7
(CI/CD) y 16 (Deployment) del Plan Maestro (`Docs/Plan_Maestro/`, fuera de
este repo); ADR-013, ADR-014, ADR-015, ADR-016, ADR-017, ADR-018, ADR-020,
ADR-021. Este archivo se actualiza en el mismo PR que cambie algo de lo que
describe (primera versión: INFRA-015, INFRA-016, INFRA-017, INFRA-021,
INFRA-022, F3; ampliado en P03.4: INFRA-012, INFRA-018, INFRA-020,
`public/_headers`; puesto al día en P03.7 tras P03.5/P03.6: los tres
interruptores activos, `dev.`/`app.` publicando de verdad, primer respaldo
real, GitHub Pages desactivado, y `restore-test.yml`, INFRA-024; corregida
y validada el 23 sep 2026 en `fix/TEST-024-restore-sequence` la secuencia
de restauración de `scripts/restore-from-r2.sh` (sección 6.3)).

## 1. Los seis workflows

`.github/workflows/` tiene los cinco workflows de `03` sección 3.7 más
`restore-test.yml` (TEST-024, agregado en P03.7, ver sección 6.3).

| Workflow                | Dispara                                                        | Qué hace                                                                                                                    | Estado                                                                                                                                                                          |
| ----------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`                | Pull Request a `develop` o `main`                              | Instala, lintea, tipa, formatea, testea, construye y corre e2e (chromium)                                                   | Activo desde P03.3; verificación obligatoria de `develop` y `main` desde P03.6                                                                                                  |
| `deploy-staging.yml`    | Push a `develop`, o `workflow_dispatch`                        | Migra `App_dev`, construye con variables de staging, publica en Pages, smoke test                                           | Activo desde P03.6 (`STAGING_DEPLOY_ENABLED=true`); primera corrida real verificada                                                                                             |
| `deploy-production.yml` | Push a `main`                                                  | Volcado a R2, migra `App`, construye con variables de producción, publica, smoke test                                       | Activo desde P03.6 (`PRODUCTION_DEPLOY_ENABLED=true`), con aprobación de Mike en `production`                                                                                   |
| `backup.yml`            | Cron diario 03:00 Argentina (06:00 UTC), o `workflow_dispatch` | `pg_dump` cifrado de `App` a R2, retención 30 diarios / 12 mensuales (ADR-015)                                              | Activo desde P03.7 (`BACKUP_ENABLED=true`); primer respaldo real verificado (sección 6.2)                                                                                       |
| `keepalive.yml`         | Cron semanal (lunes 12:00 UTC), o `workflow_dispatch`          | Consulta trivial a `App_dev` para evitar la pausa por inactividad (ADR-014)                                                 | Activo desde P03.2 (INFRA-019); disparado a mano y verificado en P03.6                                                                                                          |
| `restore-test.yml`      | Solo `workflow_dispatch`, con confirmación explícita           | Restaura un respaldo de R2 en `App_dev` (`public` + usuarios de `auth`), verifica y borra todo antes de terminar (TEST-024) | Escrito en P03.7, secuencia corregida y validada en Docker el 23 sep 2026, sin correr contra recursos remotos todavía: recién cuando `App` tenga las tablas de F4 (sección 6.3) |

Los primeros cinco ya corrieron de verdad contra recursos remotos (staging,
producción, R2 y `App_dev`): detalle y números de corrida en
`12_Registro_de_Progreso.md`. Solo `restore-test.yml` sigue "escrito y
validado, sin ejecutar" (sección 6.3): además de la razón operativa (recién
tiene sentido correrlo cuando exista algo real que restaurar, F4),
`workflow_dispatch` solo aparece como opción en la pestaña **Actions** de
GitHub para workflows que ya existen en la rama por defecto (`main`) -- así
que ni siquiera se podría disparar desde la interfaz hasta que este archivo
llegue ahí con un pase futuro (sección 13).

## 2. `ci.yml` (INFRA-015)

Un solo job, nombrado **`CI`** (así aparece en la pestaña Checks de un Pull
Request), para que se lo pueda marcar como verificación obligatoria en la
protección de ramas de `develop` y `main` — hecho en P03.6, ver sección 12.

Pasos, en orden: instalar dependencias (`pnpm install --frozen-lockfile`),
`pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm test` (Vitest),
`pnpm build`, y por último Playwright con **solo el proyecto `chromium`**
contra el propio build local (`pnpm preview`, que `playwright.config.ts`
levanta solo). Los navegadores de Playwright se instalan en el runner en
cada corrida (`playwright install --with-deps chromium`): no están
cacheados ni preinstalados.

**Condicionados, no eliminados:** `db:types --check` (genera
`src/lib/database.types.ts` desde `App_dev` y falla si difiere de lo
commiteado, DB-021) y `pnpm db:test` (pgTAP, DB-022) están escritos en el
workflow pero se saltean mientras no exista al menos un archivo `.sql` en
`supabase/migrations/` o en `supabase/tests/` respectivamente (hoy ninguna
de las dos carpetas tiene uno: son placeholders con solo un `README.md`).
Un paso previo (`Detectar si ya hay migraciones o tests de base`) revisa
ambas carpetas y expone el resultado; los pasos reales (y sus explicaciones
alternativas, que sí corren y dejan un mensaje en el log) usan ese
resultado en su `if:`. No hace falta tocar `ci.yml` cuando F4 agregue el
primer archivo: se activan solos.

## 3. Interruptores de despliegue (INFRA-016, INFRA-017, INFRA-018)

`deploy-staging.yml`, `deploy-production.yml` y `backup.yml` dependen de
secretos y, los dos primeros, de la protección de ramas y el `environment`
de producción. Para que fusionar en `develop` no fallara por falta de
secretos ni publicara nada antes de tiempo mientras eso no estaba listo,
cada workflow entero queda detrás de una **variable de repositorio** de
GitHub (`vars`, no `secrets`: no es información sensible, así se puede leer
en el `if:` del job sin gastar un secreto):

- `STAGING_DEPLOY_ENABLED` para `deploy-staging.yml`.
- `PRODUCTION_DEPLOY_ENABLED` para `deploy-production.yml`.
- `BACKUP_ENABLED` para `backup.yml`.

El job entero (`if: vars.STAGING_DEPLOY_ENABLED == 'true'`, etc.) no corre si
la variable no existe o vale cualquier cosa distinta de la cadena exacta
`"true"` — un push a `develop`/`main`, o el disparo diario del cron, sigue
activando el workflow, pero el run queda marcado como "skipped", sin gastar
minutos de runner ni intentar nada.

**Estado actual: los tres en `true`.** Mike cargó los secretos en P03.5 y
activó `STAGING_DEPLOY_ENABLED`/`PRODUCTION_DEPLOY_ENABLED` en P03.6 (primer
despliegue verificado en `dev.`/`app.`) y `BACKUP_ENABLED` en P03.7 (primer
respaldo verificado, sección 6.2). El comando que los activó, como
referencia:

```bash
gh variable set STAGING_DEPLOY_ENABLED --body true --repo extendiendoservicios/extendiendoservicios-app
gh variable set PRODUCTION_DEPLOY_ENABLED --body true --repo extendiendoservicios/extendiendoservicios-app
gh variable set BACKUP_ENABLED --body true --repo extendiendoservicios/extendiendoservicios-app
```

Para volver a apagar uno sin borrar el workflow: `gh variable set ... --body false`, o borrar
la variable con `gh variable delete`.

## 4. Aprobación manual de producción

`deploy-production.yml` corre bajo `environment: production` (declarado en
el YAML, como pide INFRA-017). **Ya existe** en GitHub con
`extendiendoservicios` como revisor obligatorio (creado por el orquestador
con OK de Mike antes de P03.5, verificado por API): un push a `main` con
`PRODUCTION_DEPLOY_ENABLED=true` queda esperando esa aprobación antes de
tocar nada. Se verificó en la práctica en P03.6 (PR #10 `develop → main`):
el job quedó en espera hasta que Mike aprobó, y recién ahí migró, construyó,
publicó y corrió el smoke test.

`backup.yml` corre diariamente por cron y **no** usa `environment:
production` (correr bajo ese environment exigiría que Mike apruebe a mano
cada corrida diaria del respaldo, lo que rompería la automatización) — sus
secretos son de repositorio, no de `environment` (sección 11).

## 5. Migraciones, Edge Function y el volcado previo a producción

Igual que en `ci.yml`, `supabase db push` y `supabase functions deploy
admin-users` están escritos en ambos workflows de despliegue pero
condicionados a que ya existan migraciones (F4) o la función (F7) — hoy
ninguna de las dos existe, así que ambos pasos se saltean con un mensaje
explicativo en el log, en cada uno de los dos workflows.

`deploy-production.yml` además exige, **antes** de tocar `App`, un volcado a
R2 (ADR-015: nunca migrar producción sin un respaldo fresco). Ese paso
invoca `scripts/backup-to-r2.sh` (sección 6): si hay migraciones que aplicar
y el script no existe o perdió el bit ejecutable, **el workflow falla ahí a
propósito** en vez de seguir con `db push` sin respaldo — no es un paso
"opcional" como los de arriba, que se saltean en silencio mientras no haya
nada que migrar todavía.

## 6. Respaldos a R2 y restauración (INFRA-018, INFRA-020, ADR-015)

### 6.1 `scripts/backup-to-r2.sh`

Lo reutilizan dos workflows: `backup.yml` (cron diario) y el paso "Volcado
previo de `App` a R2" de `deploy-production.yml` (sección 5). Qué hace, en
orden:

1. Verifica que estén las seis variables de entorno que necesita (abajo);
   si falta alguna, falla enseguida con un mensaje que dice cuál, sin
   imprimir ningún valor.
2. Se asegura de tener un **cliente de PostgreSQL 17** (`scripts/lib/dependencias-ci.sh`,
   función `asegurar_pg17`): los proyectos de Supabase corren Postgres 17.6
   y un `pg_dump`/`pg_restore` más viejo no puede volcar ni restaurar ese
   formato. Ubuntu (el runner de GitHub) no siempre trae la versión 17 por
   defecto; si no la encuentra en el `PATH` la instala desde el repositorio
   oficial de PostgreSQL (PGDG), nunca desde un paquete de terceros.
3. `pg_dump --format=custom --no-owner --no-privileges` de `App`
   (`SUPABASE_DB_URL_PROD`, Session pooler) a un archivo temporal.
4. Cifra ese archivo con `gpg --symmetric --cipher-algo AES256` usando
   `BACKUP_PASSPHRASE`, y borra el volcado sin cifrar del disco. **El
   volcado sin cifrar nunca se sube**: solo existe unos segundos en un
   directorio temporal que un `trap` borra al salir, pase lo que pase.
5. Sube el archivo cifrado a R2 por su API S3 (`aws s3 cp`, con
   `asegurar_aws_cli` instalando la AWS CLI si hace falta), con el nombre y
   el prefijo de retención que corresponda.

Variables de entorno (ninguna se imprime en ningún momento):
`SUPABASE_DB_URL_PROD`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`R2_BUCKET`, `CLOUDFLARE_ACCOUNT_ID`, `BACKUP_PASSPHRASE`.

**Nombre y prefijo de retención:** `diarios/App_<fecha_hora_argentina>.dump.gpg`
todos los días salvo el 1º de cada mes, que va a
`mensuales/App_<fecha_hora_argentina>.dump.gpg`. La **retención la aplica el
propio bucket `es-backups`** con sus reglas de ciclo de vida (INFRA-020, ya
creadas): `retencion-diaria` expira los objetos de `diarios/` a los 30 días,
`retencion-mensual` expira los de `mensuales/` a los 370 días (~12 meses).
El script no borra nada.

### 6.2 `backup.yml`

Cron diario `0 6 * * *` (06:00 UTC = 03:00 Argentina, UTC-3 todo el año, sin
horario de verano — ADR-019) más `workflow_dispatch` para correrlo a mano.
Detrás de `vars.BACKUP_ENABLED == 'true'` (sección 3). Si el volcado, el
cifrado o la subida fallan, el job falla sin reintento: eso es lo que
dispara el correo de alerta de GitHub Actions a quien tenga notificaciones
activadas para el repositorio (mismo criterio que `keepalive.yml`; a quién
le llega exactamente ese correo cuando el workflow es por `schedule`, y la
guía clic por clic para activarlo: `docs/environments.md` sección 7,
INFRA-024).

**Primer respaldo real (P03.7, 19 sep 2026):** con `BACKUP_ENABLED=true`, el
orquestador disparó `backup.yml` a mano desde `main` (`workflow_dispatch`,
run `35424708501`) con el OK de Mike. Resultado: éxito, objeto
`diarios/App_20260919_024332.dump.gpg` en `es-backups`, 46.702 bytes,
verificado por el orquestador con `wrangler` (existencia y tamaño del
objeto, cuenta `extserviciosapp@gmail.com`). Desde entonces corre solo,
todos los días a las 06:00 UTC.

### 6.3 Restauración de prueba (`scripts/restore-from-r2.sh`, `restore-test.yml`, TEST-024)

> **Corrección validada, en dos rondas (23 sep 2026, `fix/TEST-024-restore-sequence`).** La
> versión anterior de esta sección describía dos defectos conocidos y una traba en
> `restore-test.yml` mientras no se corrigieran. Primera ronda: los dos se corrigieron, se
> validaron de punta a punta contra un Postgres 17 local en Docker (con las 19 migraciones reales
> aplicadas, datos de prueba y un volcado generado con los mismos comandos que `backup-to-r2.sh`)
> y aparecieron además dos defectos más de `pg_restore` en PostgreSQL 17.11 que no estaban
> documentados. Resumen de los cuatro:
>
> 1. **Recrear la estructura era innecesario y arriesgado.** La versión anterior recreaba
>    `public` desde cero (`DROP TABLE` + `CREATE TABLE`, pre-data/post-data). Eso fallaba por
>    claves foráneas y políticas RLS de post-data que el `--clean` de pre-data no toca, y al
>    intentar arreglarlo borrando esas claves/políticas antes apareció un problema más de fondo:
>    `DROP TABLE ... CASCADE` puede llevarse puesta una función de OTRO esquema si depende del
>    tipo fila de la tabla (por ejemplo, `app.log_security_event` devuelve `public.security_events`).
>    Solución adoptada: **no recrear la estructura en absoluto.** El paso 0 (más abajo) ya
>    garantiza que `App_dev` tiene exactamente las mismas migraciones que el volcado, así que la
>    estructura es idéntica en los dos lados — alcanza con reemplazar los datos.
> 2. **`--no-privileges` habría dejado un ACL más abierto que el de las migraciones.** Con la
>    estructura recreada, las tablas nuevas heredaban el ACL por defecto de Supabase (más amplio
>    que `0017_grants.sql`). Al no recrear nunca la estructura (punto 1), este defecto desaparece
>    solo: ningún `GRANT`, `REVOKE` ni política se toca jamás durante la restauración — quedan
>    exactamente como los dejaron las migraciones, siempre. Verificado comparando, permiso por
>    permiso y tabla por tabla, el estado de `App_dev` antes y después de una restauración de
>    prueba: idéntico (y también idéntico al de una base recién migrada, sin restaurar nada).
> 3. **`pg_restore -t esquema.tabla` no matchea nada en PostgreSQL 17.11** (el cliente que instala
>    `asegurar_pg17`): la restauración de `auth.users`/`auth.identities` con `-t auth.users`
>    terminaba sin error pero sin restaurar una sola fila (confirmado también con
>    `public.clients`: `--table=esquema.tabla` no encuentra nada, `--table=tabla` sí). Corregido
>    usando `-n <esquema> -t <tabla>` (dos argumentos separados).
> 4. **`pg_restore --data-only -t <tabla>` sin `--dbname` ni `--file` ahora corta con error**
>    ("one of -d/--dbname and -f/--file must be specified") en vez de imprimir a la salida
>    estándar como antes: el paso 0 (lee las migraciones del volcado sin tocar ninguna base)
>    quedaba roto por esto. Corregido agregando `-f -`.
>
> La primera ronda resolvía el orden de carga entre tablas con
> `alter table ... disable trigger all` en todas las tablas de `public` (permiso, se creyó, de
> dueño de tabla). **Segunda ronda, revisión del orquestador:** eso tenía un defecto bloqueante.
> `disable trigger all` deshabilita TAMBIÉN los triggers internos de las claves foráneas
> (`RI_ConstraintTrigger_*`), y deshabilitar esos puntualmente exige superusuario, no alcanza con
> ser dueño de la tabla. La validación de la primera ronda no lo detectó porque corrió como
> superusuario de un Postgres vainilla; reproducido por el orquestador en Docker con un rol dueño
> de las tablas sin superusuario (`ERROR: permission denied: "RI_ConstraintTrigger_c_..." is a
system trigger`), y confirmado que en Supabase el rol `postgres` **no** es superusuario
> (`select rolsuper from pg_roles where rolname = 'postgres'` da `false` en `App_dev`) — la
> restauración real habría abortado en ese paso.
>
> **Corrección adoptada:** en vez de deshabilitar triggers tabla por tabla, cada carga de datos
> fija `session_replication_role = replica` en su propia conexión antes de insertar filas. Con
> `replica` activo, ni los triggers de usuario (incluido el que crea la fila de `profiles` al
> insertar en `auth.users`) ni los internos de las claves foráneas se disparan: el orden de carga
> entre tablas deja de importar, sin tocar ningún trigger de ninguna tabla ni recrear nada. Esto
> funciona sin superusuario en Supabase porque la extensión `supautils` (que Supabase instala en
> todos sus proyectos) mantiene su propia lista de parámetros que roles no-superusuario sí pueden
> fijar (`supautils.privileged_role_allowed_configs`), y `session_replication_role` para
> `postgres` figura ahí — confirmado por el orquestador en `App_dev`, en una transacción revertida
> (`begin; set local session_replication_role = replica; rollback;`, sin dejar ningún cambio),
> aunque `select has_parameter_privilege('postgres', 'session_replication_role', 'SET')` devuelva
> `false` (esa función solo conoce el mecanismo estándar de PostgreSQL 15+,
> `GRANT SET ON PARAMETER ... TO ...`, no el mecanismo propio de `supautils`). Como el parámetro
> vale por conexión, cada carga arma el `SET` junto con el SQL que genera `pg_restore -f -` y
> manda todo por la misma tubería a un único `psql --single-transaction` — nunca `PGOPTIONS`,
> porque el Session pooler de Supabase puede no reenviar opciones de arranque al servidor real, y
> `supautils` valida el permiso en el momento del `SET` explícito dentro de la sesión, no en el
> arranque de la conexión. Con `replica` ya no hace falta el paso que vaciaba `public` por segunda
> vez (el trigger que crea `profiles` tampoco se dispara), así que la secuencia quedó con un paso
> menos. Validado de nuevo en Docker, esta vez con roles sin superusuario en `public` y en `auth`
> (`auth.users` con dueño distinto de `postgres`, igual que en Supabase). Detalle completo, con
> los números de las dos rondas de validación, en el reporte de la tarea
> `fix/TEST-024-restore-sequence`.

**Decisión de Mike:** la restauración de prueba es un workflow de GitHub
(así los secretos de R2/Supabase nunca salen de Actions) y se ejecuta
cuando `App` (producción) ya tenga las tablas de F4 — hoy `supabase/migrations`
no tiene ninguna, así que no habría nada real que restaurar. `restore-test.yml`
queda escrito, validado y listo en P03.7, pero **no corre todavía**: pasa a
`main` con un pase futuro y se dispara a mano recién entonces (además,
`workflow_dispatch` solo aparece en la pestaña **Actions** de GitHub para
workflows que ya existen en la rama por defecto — sección 13).

**Solo `App_dev`.** Ni el workflow ni el script leen `SUPABASE_DB_URL_PROD`
en ningún lado: estructuralmente no pueden apuntar a `App` (producción) ni
por accidente ni por una variable mal cargada. Restaurar producción es un
procedimiento manual y excepcional aparte, para `docs/runbook-produccion.md`
(F20, todavía no existe).

**Decisiones de Mike (19 sep 2026, corrección de P03.7):**

1. **Se restaura `App_dev` con usuarios reales de producción.** No solo el
   esquema `public`: también `auth.users` y `auth.identities` (lo mínimo
   para que las referencias de `public` hacia `auth.users` cierren, por
   ejemplo si `public.profiles.id` termina con una clave foránea hacia
   `auth.users(id)` — el patrón habitual de Supabase,
   `04_Modelo_de_Datos.md` sección 2.1: "= `auth.users.id`"). Motivo: sin
   los usuarios reales, esas filas de `public` quedarían huérfanas y la
   prueba no sería representativa. Mike aceptó que datos personales y
   hashes de contraseña de producción pasen por `App_dev` durante la
   prueba.
2. **La prueba limpia lo que restauró antes de terminar, siempre.**
   `App_dev` tiene que quedar sin los datos reales apenas termina la
   prueba, corra lo que corra durante la restauración: `dev.` sirve desde
   `App_dev`, así que mientras los usuarios restaurados sigan ahí,
   cualquier empleado real podría iniciar sesión en staging con su
   contraseña de producción, y los emails de Auth de `App_dev` podrían
   llegarle a gente real. **Mientras dura la prueba (unos minutos),
   `dev.` no es un entorno seguro.**

**Alcance en `public`:** todas las tablas, vistas, funciones, índices y
datos que crean las migraciones propias. **No se toca la estructura de
`auth`** (ni `storage` ni `extensions`): nunca se hace `DROP` ni `ALTER`
sobre `auth.users`/`auth.identities`, tablas que administra Supabase
(`supabase_auth_admin` es su dueño, no el rol de conexión) — solo se
reemplazan sus filas (`DELETE` + `INSERT` vía `pg_restore --data-only`). El
`pg_dump` de `backup.yml` sigue siendo completo (todos los esquemas): el
recorte es solo al restaurar.

**Secuencia** (validada de punta a punta, ver el recuadro de arriba; el
detalle completo está en los comentarios de `scripts/restore-from-r2.sh`):

0. Verifica que `App_dev` tenga las mismas migraciones aplicadas que el
   volcado (`supabase_migrations.schema_migrations`, la tabla de control
   de la CLI de Supabase) — si no coinciden, **aborta antes de tocar
   nada**, con un mensaje claro. Esto es lo que garantiza que la
   ESTRUCTURA de `public` es idéntica en los dos lados: el resto de la
   secuencia confía en eso para no tener que recrear nada.
1. Vacía `public` (`TRUNCATE ... CASCADE`) por si `App_dev` tenía datos de
   antes. `TRUNCATE` no necesita `session_replication_role` ni deshabilitar
   nada: alcanza con ser dueño de la tabla, y `CASCADE` ya se encarga de
   las tablas dependientes.
2. Reemplaza `auth.users`/`auth.identities`, todo en **una única conexión**:
   borra lo que haya (primero `identities`, después `users`) **antes** de
   fijar `session_replication_role = replica`, porque con `replica` activo
   tampoco se disparan los `ON DELETE CASCADE` y quedarían huérfanas las
   filas de `auth.sessions`, `auth.refresh_tokens`, `auth.mfa_factors` y
   demás (comprobado en Docker el 23 sep 2026); después fija `replica` y
   restaura los datos
   del volcado (`pg_restore --data-only -n auth -t users`/`-t identities`,
   primero `users`, después `identities` — nunca `-t auth.users`, ver el
   recuadro de arriba, defecto 3). Con `replica` activo, el trigger que F4
   agrega sobre `auth.users` (crea la fila de `profiles`, según
   `04_Modelo_de_Datos.md`) **no se dispara** — ya no hace falta un paso
   aparte para limpiar ese efecto secundario.
3. Carga los datos de `public` (`--section=data`), también con
   `session_replication_role = replica` fijado en esa misma conexión: ni
   los triggers de usuario ni los internos de las claves foráneas se
   disparan, así que el orden de carga entre tablas no importa.
4. Verifica (cantidad de tablas del volcado contra las de `App_dev`, más
   filas por tabla) — nunca contenido.
5. **Limpieza, siempre** (por un `trap` de bash: corre aunque cualquiera de
   los pasos de arriba falle): vacía `public` y borra los usuarios de auth
   restaurados, y confirma que quedaron vacíos. El workflow además corre
   un paso `if: always()` aparte (`scripts/restore-from-r2.sh
--confirmar-vacio`) como segunda confirmación independiente, visible en
   el log de la corrida. Validado forzando una falla a mitad de camino
   (después del paso 1): la limpieza dejó `App_dev` vacío igual.

Cada paso de la secuencia corre en su propia transacción (`begin`/`commit`
explícito en los bloques de `psql`, incluidos los que arman
`session_replication_role = replica` junto con el SQL que genera
`pg_restore -f -` y los mandan juntos a un único `psql
--single-transaction`): si algo falla a mitad de un paso, ESE paso se
revierte solo. No hay una única transacción global para toda la secuencia
(el paso 3 necesita ver ya confirmados los datos del paso 2, escritos en una
conexión distinta) — la garantía de "nunca dejar nada a medias" la da la
limpieza del paso 5, que corre siempre.

**Por qué cada carga usa su propia conexión.** `session_replication_role`
vale por conexión, no por rol ni de forma global: fijarlo en un `psql`
aparte y restaurar después con un `pg_restore --dbname ...` (que abre OTRA
conexión) no serviría de nada. Por eso los pasos 2 y 3 arman el `SET` más el
SQL que genera `pg_restore -f -` y lo mandan todo por la misma tubería a un
único `psql`, que abre una sola conexión para las dos cosas.

**Ningún dato personal se imprime en ningún log.** La verificación (paso 6)
y la limpieza (paso 7) solo cuentan filas (números); nunca hacen `SELECT *`
ni imprimen contenido de ninguna tabla ni de `auth.users`/`auth.identities`.

**Permisos del rol `postgres` sobre `auth`, sin confirmar.** La
documentación pública de Supabase describe a `postgres` (el rol que usa
este script, vía el Session pooler) como _"the default Postgres role. This
has admin privileges"_, pero no confirma ni niega privilegios de
`INSERT`/`DELETE` sobre `auth.users`/`auth.identities` — y en otra página
recomienda explícitamente no escribir en `auth.users` a mano ("may change
at any time", usar la Auth Admin API en su lugar). No se pudo confirmar
esto en vivo (esta capa no inicia sesión en ningún servicio). El diseño de
arriba está pensado para fallar rápido y sin dejar nada a medias si el
permiso no está (cada paso en su propia transacción, limpieza que corre
siempre). **Antes de la primera corrida real** (después de F4), Mike puede
confirmarlo sin arriesgar nada, desde el SQL Editor de `App_dev`. La
consulta pide cada permiso por separado (`has_table_privilege` con una
lista de privilegios separados por coma, como `'INSERT, DELETE'`, devuelve
`true` si el rol tiene CUALQUIERA de los dos, no los dos a la vez — no
sirve para confirmar que están los dos):

```sql
select has_table_privilege('postgres', 'auth.users', 'INSERT') as auth_users_insert,
       has_table_privilege('postgres', 'auth.users', 'DELETE') as auth_users_delete,
       has_table_privilege('postgres', 'auth.identities', 'INSERT') as auth_identities_insert,
       has_table_privilege('postgres', 'auth.identities', 'DELETE') as auth_identities_delete;
```

Los cuatro tienen que dar `true`.

Si alguno de los dos da `false`, el paso 2 de la secuencia va a fallar con
un error de permisos claro (y la limpieza igual va a dejar `App_dev`
vacío) — en ese caso, la alternativa (no construida en este encargo) es
recrear los usuarios con la Auth Admin API en vez de SQL directo, que
exige un script bastante más grande.

**Después de la prueba: `App_dev` queda vacío, a propósito.** Ni el seed de
prueba que tuviera antes ni los datos restaurados sobreviven a una corrida
de `restore-test.yml`. Volver a cargar datos de prueba es un paso aparte:
correr de nuevo el seed de `App_dev` contra ese proyecto (desde F4,
`scripts/seed-dev.ts` según `README.md`/`scripts/README.md`; hasta que F4
exista, no hay seed que restaurar). No lo hace este workflow ni este
script: mezclar "restaurar un respaldo real" con "volver a poner datos
ficticios" en el mismo mecanismo sería confuso y más difícil de auditar.

**Verificación con resultado claro:** después de restaurar (antes de
limpiar), el script compara la cantidad de tablas que lista `pg_restore -l
--schema=public` contra la cantidad de tablas que efectivamente quedaron en
`information_schema.tables` de `App_dev` (esquema `public`) — si no
coinciden, el script termina en error. Además imprime, tabla por tabla, un
`SELECT count(*)` real (no una estimación de `pg_stat_user_tables`), más el
conteo de `auth.users`/`auth.identities` — siempre números, nunca
contenido.

Uso (workflow, cuando corresponda dispararlo):

```bash
gh workflow run restore-test.yml --repo extendiendoservicios/extendiendoservicios-app \
  -f confirmacion=restaurar-app-dev
# Opcional: -f objeto_r2=diarios/App_20260101_030000.dump.gpg (si no se indica, usa el más
# reciente de diarios/)
```

Uso (a mano, para una restauración manual fuera del workflow):

```bash
# 1. Listar los respaldos disponibles en el bucket (más recientes primero)
R2_ACCESS_KEY_ID=<...> R2_SECRET_ACCESS_KEY=<...> R2_BUCKET=es-backups \
  CLOUDFLARE_ACCOUNT_ID=<...> \
  scripts/restore-from-r2.sh --listar

# 2. Restaurar uno elegido (pide confirmación interactiva además del
#    segundo argumento si la terminal es interactiva)
SUPABASE_DB_URL_DEV=<...> R2_ACCESS_KEY_ID=<...> R2_SECRET_ACCESS_KEY=<...> \
  R2_BUCKET=es-backups CLOUDFLARE_ACCOUNT_ID=<...> BACKUP_PASSPHRASE=<...> \
  scripts/restore-from-r2.sh diarios/App_20260101_030000.dump.gpg restaurar-app-dev

# 2b. O, para no elegir la clave a mano, restaurar el más reciente de diarios/
SUPABASE_DB_URL_DEV=<...> R2_ACCESS_KEY_ID=<...> R2_SECRET_ACCESS_KEY=<...> \
  R2_BUCKET=es-backups CLOUDFLARE_ACCOUNT_ID=<...> BACKUP_PASSPHRASE=<...> \
  scripts/restore-from-r2.sh --ultimo restaurar-app-dev

# 3. Confirmar que App_dev quedó vacío (la corrida de arriba ya limpia sola; esto es una
#    segunda confirmación independiente, por ejemplo si algo se cortó antes de la limpieza)
SUPABASE_DB_URL_DEV=<...> scripts/restore-from-r2.sh --confirmar-vacio
```

Las variables son las mismas que documenta `docs/environments.md` sección 4
para `SUPABASE_DB_URL_DEV`, `R2_*` y `BACKUP_PASSPHRASE`: se pegan a mano en
la sesión de quien restaura (nunca en un archivo ni en un commit).

**`BACKUP_PASSPHRASE` es indispensable y no se puede recuperar:** sin la
frase exacta que se usó para cifrar un volcado, ese volcado queda
inservible para siempre (cifrado simétrico, sin puerta trasera). Por eso
`docs/environments.md` sección 4 insiste en guardarla también fuera de
GitHub.

## 7. Cloudflare Pages y R2 (INFRA-012, INFRA-020, ADR-013, ADR-015)

Creados con `wrangler` en la cuenta de Cloudflare `extserviciosapp@gmail.com`
(P03.4; verificado antes con `wrangler whoami`, `03` sección 3.2):

- **Pages** `extendiendoservicios-app` (`wrangler pages project
create extendiendoservicios-app --production-branch=main`): sin proyecto
  de Git conectado a propósito (el build lo hace GitHub Actions, sección 11
  de este documento explica por qué). Dominios personalizados conectados en
  P03.6 (INFRA-013): `dev.extendiendoservicios.com` → rama `develop`
  (`dev` es un `CNAME` a `develop.extendiendoservicios-app.pages.dev`, con
  proxy de Cloudflare) y `app.extendiendoservicios.com` → rama `main`
  (conectado como dominio propio de Pages, con proxy). Los dos migraron
  desde GitHub Pages **sin corte**: se creó el proyecto, se verificó en
  `*.pages.dev`, se cambió el CNAME/dominio y recién después se desactivó
  GitHub Pages (`README.md` conserva el detalle histórico de esa migración
  mientras estuvo vigente, en el control de versiones). GitHub Pages quedó
  desactivado y la rama `gh-pages-legacy` que lo servía, borrada.
- **R2** `es-backups` (`wrangler r2 bucket create es-backups`, clase
  Standard): sin acceso público (`r2 bucket dev-url get` confirma que el
  acceso `r2.dev` está deshabilitado) y sin dominios personalizados. Reglas
  de ciclo de vida ya creadas: `Default Multipart Abort Rule` (aborta cargas
  multiparte incompletas a los 7 días), `retencion-diaria` (expira
  `diarios/` a los 30 días) y `retencion-mensual` (expira `mensuales/` a los
  370 días) — sección 6.1. Primer objeto real desde P03.7 (sección 6.2).

Los dos tienen su token de API cargado desde P03.5 (`docs/environments.md`
sección 4), con permisos mínimos (Pages: solo **Cloudflare Pages · Edit**
sobre la cuenta; R2: **Object Read & Write** acotado al bucket
`es-backups`).

## 8. Rollback (`03` sección 16)

|               | Staging                                                                                                                                                                                        | Producción                                                                                                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend      | Re-desplegar la versión anterior en Cloudflare Pages (cada despliegue queda como una entrada separada en el panel de Pages; `wrangler pages deployment list` / el botón "Rollback" del panel). | Igual que en staging.                                                                                                                                                            |
| Base de datos | Migración correctiva nueva (nunca se edita una migración ya aplicada, `03` sección 3.5).                                                                                                       | Igual, más — solo si una migración dañó datos — restaurar el volcado más reciente de R2 a `App`. Procedimiento detallado: `docs/runbook-produccion.md` (F20, todavía no existe). |

Restaurar un volcado de R2 sobre `App` (producción) es destructivo y no está
automatizado por diseño: es una acción manual y excepcional de Mike, nunca
un paso de un workflow ni de `scripts/restore-from-r2.sh` (que, a
diferencia de esto, solo apunta a `App_dev` — sección 6.3).

## 9. Sentry (INFRA-021)

- Organización `extendiendo-servicios`, proyecto `extendiendoservicios-app`,
  región de datos **Unión Europea**. La región importa para dos cosas
  distintas:
  - El **DSN** (`VITE_SENTRY_DSN`) que usa el SDK del navegador para mandar
    errores ya apunta al host de ingesta correcto de la región (algo como
    `https://<clave>@o<org>.ingest.de.sentry.io/<proyecto>`); Mike lo copia
    tal cual del panel de Sentry, no hace falta construirlo a mano.
  - La **API** que usan la CLI y los plugins de build (para crear
    releases y subir source maps) es distinta por región: `sentry.io` es la
    de EE. UU. (el valor por omisión de `@sentry/vite-plugin`); la de la
    Unión Europea es **`de.sentry.io`**. `vite.config.ts` fija
    `url: 'https://de.sentry.io/'` explícitamente en la configuración del
    plugin — verificado contra la documentación de Sentry sobre
    almacenamiento de datos por región, y confirmado en la práctica: un
    build local con un token inválido contra ese host devolvió un 401 real
    de la API (no un error de DNS ni de timeout), confirmando que el host
    es correcto y está accesible.
- `src/lib/sentry.ts` inicializa el SDK (`@sentry/react`) **solo si existe
  `VITE_SENTRY_DSN`**; sin esa variable (todo build local, y cualquier build
  en CI antes de que Mike cargue el secreto) no se ejecuta ni una llamada
  de red. Test: `src/lib/sentry.test.ts`.
- `environment` = `VITE_APP_ENV`, `release` = `VITE_APP_VERSION` (la misma
  versión de `package.json`, ADR-020). `sendDefaultPii: false` explícito
  (`03` sección 15: nunca se manda información personal identificable
  además de la del propio error). Sin Session Replay ni tracing de
  rendimiento: no se agregan las integraciones `browserTracingIntegration`
  ni `replayIntegration`, y no se declara `tracesSampleRate` — el plan pide
  solo captura de errores.
- **Source maps**: `vite.config.ts` agrega `sentryVitePlugin` (de
  `@sentry/vite-plugin`) **solo si hay `SENTRY_AUTH_TOKEN`** en el entorno
  del build (secreto de CI, nunca en local). Sin el token, `build.sourcemap`
  también queda en `false`: no se generan `.map` en absoluto, así que no hay
  nada que pueda terminar publicado sin querer. Con el token, el plugin:
  1. Genera los `.map` (`build.sourcemap: true`).
  2. Los sube a Sentry junto con la release (`release.name` = versión de
     `package.json`, la misma que ve el SDK en runtime).
  3. Los borra de `dist/` en el mismo paso del build
     (`sourcemaps.filesToDeleteAfterUpload: ['dist/**/*.map']`) — verificado
     en local: incluso forzando una subida que falla (token inválido,
     org inexistente, 401 de Sentry), el plugin igual borra el `.map` local
     antes de terminar el build. Además, `errorHandler` atrapa cualquier
     error de la subida y solo lo advierte por consola (`console.warn`) sin
     hacer fallar el build: una falla de Sentry (red, token vencido, límite
     de cuota) no tiene que bloquear un despliegue.
  4. Como respaldo — por si en algún escenario el paso anterior no llegara
     a correr — `deploy-staging.yml` y `deploy-production.yml` tienen
     además un paso propio `find dist -name '*.map' -delete` justo antes de
     publicar en Pages. Es idempotente: si ya no hay ningún `.map`, no hace
     nada.
- El host de ingesta EU de Sentry ya está en el `connect-src` de
  `public/_headers` (`https://*.ingest.de.sentry.io`, sección 10.3): sin
  esto el navegador bloquea las llamadas del SDK y los errores no llegan a
  Sentry en ningún entorno. El comodín cubre cualquier `o<org>` sin conocer
  todavía el número exacto de organización (Sentry no está creado aún,
  P03.5); si el DSN real usa un host distinto de `*.ingest.de.sentry.io` va
  a haber que ajustar esta línea cuando Mike lo cree.

## 10. `public/_headers` (INFRA-018), `robots.txt` y `noindex` (INFRA-022)

### 10.1 `robots.txt`

`public/robots.txt` bloquea todo (`Disallow: /`) y es **el mismo archivo en
los tres entornos** (local, staging, producción): la aplicación es una
herramienta interna con login (administración, empleados, supervisores), no
un sitio público — el sitio público de la empresa vive aparte
(`extendiendoservicios.com`, repositorio `extendiendoservicios-web`) y ese sí
se indexa normalmente. No hay contenido en `app.`/`dev.` que aporte valor de
búsqueda, y sí hay una razón para no exponer la estructura de rutas de una
herramienta interna a un buscador.

Esto es una **recomendación, no una decisión cerrada** (el plan solo dice
"robots por entorno" para producción, sin más detalle) — si en algún momento
la aplicación suma alguna página realmente pública, este archivo tiene que
dejar de bloquear esa ruta puntual.

### 10.2 `public/_headers`

Un único bloque `/*` (aplica a todo el sitio, en los tres entornos) con las
cabeceras de `03` sección 3.6:

| Cabecera                    | Valor                                                                                                                                     | Motivo                                                                                                                                                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains`                                                                                                     | Fuerza HTTPS dos años, incluidas subdominios de `app.`/`dev.`. Sin `preload`: es una decisión más grande (alta a una lista fija del navegador, difícil de revertir) que queda abierta para Mike si la quiere más adelante. |
| `X-Content-Type-Options`    | `nosniff`                                                                                                                                 | Evita que el navegador adivine el tipo de contenido.                                                                                                                                                                       |
| `Referrer-Policy`           | `strict-origin-when-cross-origin`                                                                                                         | Pedido explícito de `03` sección 3.6.                                                                                                                                                                                      |
| `X-Frame-Options`           | `DENY`                                                                                                                                    | Protección contra framing, redundante a propósito con `frame-ancestors 'none'` de la CSP (defensa en profundidad, navegadores viejos).                                                                                     |
| `Permissions-Policy`        | `geolocation=(self), camera=(), microphone=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=(), midi=(), sync-xhr=()` | Solo geolocalización propia (ADR-009, fichada con posición); el resto de las funciones sensibles reconocidas, en cero.                                                                                                     |
| `Content-Security-Policy`   | ver 10.3                                                                                                                                  | —                                                                                                                                                                                                                          |

### 10.3 `Content-Security-Policy`

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
font-src 'self';
img-src 'self' data: https://anesttvrnpsaaaxaquce.supabase.co https://fysuppdadwvabrjpnnoh.supabase.co https://tile.openstreetmap.org https://*.tile.openstreetmap.org;
connect-src 'self' https://anesttvrnpsaaaxaquce.supabase.co https://fysuppdadwvabrjpnnoh.supabase.co https://*.ingest.de.sentry.io https://nominatim.openstreetmap.org;
base-uri 'self';
form-action 'self';
frame-ancestors 'none';
object-src 'none'
```

(en el archivo real va todo en una sola línea, formato que exige `_headers`).

- **`connect-src`**: los dos proyectos de Supabase por su host único
  (`<ref>.supabase.co` sirve REST, Auth y Storage bajo el mismo origen —
  `anesttvrnpsaaaxaquce` es `App_dev`, `fysuppdadwvabrjpnnoh` es `App`,
  `docs/environments.md` sección 2); la ingesta de Sentry región UE
  (sección 9); Nominatim (`nominatim.openstreetmap.org`, ADR-017, para el
  buscador de direcciones del `MapPicker`, todavía no implementado). Sin
  `wss://`: el plan usa polling, no Supabase Realtime (ADR-012), así que no
  hace falta abrir WebSockets.
- **`img-src`**: `'self'` (logo e íconos propios de `public/`), `data:`
  (por si algún componente necesita un placeholder inline, hoy ninguno lo
  usa), los dos hosts de Supabase (Storage: buckets `avatars` y `branding`
  de ADR-016) y los tiles de OpenStreetMap — se listan las dos formas
  (`tile.openstreetmap.org` y `*.tile.openstreetmap.org`) porque Leaflet
  puede pedirlos con o sin el esquema de subdominios `a/b/c` según la
  configuración final del mapa (ADR-017, todavía sin implementar).
- **`style-src 'self' 'unsafe-inline'`**: **probado**, no supuesto. Con
  `style-src 'self'` a secas (sin `'unsafe-inline'`), sonner (el `Toaster`
  de `src/components/ui/sonner.tsx`, dependencia real del proyecto) inyecta
  su hoja de estilos con `document.createElement('style')` +
  `appendChild(document.createTextNode(...))`: el navegador la bloquea y lo
  reporta como violación de `style-src-elem` (verificado con Playwright
  contra un build real servido con `wrangler pages dev`, ver "Cómo lo
  verifiqué" del reporte del encargo). El posicionamiento dinámico de
  Radix/Floating UI (`Popover`, `Select`, `Tooltip`, etc. — todos via
  `@radix-ui/react-popper`), en cambio, **no** necesitó `'unsafe-inline'`:
  asigna sus estilos de posición vía CSSOM (`style.setProperty(...)` y el
  `style` de React, que React aplica propiedad por propiedad, no como
  `setAttribute('style', ...)` ni `.cssText`), algo que los navegadores
  actuales no tratan como "estilo en línea" a los efectos de la CSP. Con
  `'unsafe-inline'` agregado, cero violaciones para ambos casos.
- **`script-src 'self'`**: sin `'unsafe-inline'` ni `'unsafe-eval'` — nada
  en el proyecto necesita scripts inline ni `eval` (Vite compila todo a
  módulos con `<script type="module" src="...">`).
- **`default-src 'self'`**: sirve de resguardo para cualquier directiva de
  "fetch" no listada arriba (por ejemplo `manifest-src`/`worker-src` del
  manifest/service worker de la PWA, F17 — todavía no existen); como todo
  lo que sirve la app hoy es de origen propio, no bloquea nada.
- **`frame-ancestors 'none'` / `object-src 'none'` / `base-uri 'self'` /
  `form-action 'self'`**: variantes de defensa en profundidad estándar,
  seguras porque la app no necesita ser embebida en un `<iframe>` ajeno, no
  usa plugins/`<object>`, y no tiene ninguna razón para que se inyecte un
  `<base>` ni un formulario que apunte a otro origen.

### 10.4 `X-Robots-Tag: noindex` en staging, sin pisar el resto

`deploy-staging.yml` agrega una línea más **dentro del mismo bloque `/*`**
de `dist/_headers` (que ya trae el build, porque Vite copia `public/` tal
cual): `sed -i '/^\/\*$/a\  X-Robots-Tag: noindex' dist/_headers`. Se eligió
insertar en el mismo bloque, no agregar un segundo bloque `/*` aparte,
porque aunque Cloudflare Pages documenta que combina cabeceras de reglas
distintas que matchean el mismo path ("an incoming request which matches
multiple rules' URL patterns will inherit all rules' headers"), esa
combinación entre bloques no se pudo verificar en local: `wrangler pages
dev` (versión instalada, 4.99.0) mostró un comportamiento inconsistente al
combinar dos bloques `/*` separados (algunas cabeceras del primer bloque no
aparecían en la respuesta), mientras que insertar la línea dentro de un
único bloque sí se verificó funcionando de punta a punta. Producción no
lleva esta cabecera (`robots.txt` alcanza como base ahí).

### 10.5 Verificar `_headers` en local con `wrangler pages dev`

Dos detalles de esta versión de `wrangler` (4.99.0) que no son evidentes:

- Hace falta pasar `--compatibility-date` explícito y no más nuevo que el
  que soporta el binario instalado (por ejemplo
  `--compatibility-date=2026-06-16`): sin el flag, `wrangler` usa la fecha
  de hoy por defecto y el runtime local (`workerd`) puede rechazarla si es
  más nueva que la que soporta esa versión del paquete, con un error
  "requires compatibility date ... but the newest date supported by this
  server binary is ...".
- En Windows, `wrangler pages dev` corre bajo `workerd.exe` como proceso
  hijo separado del que reporta la terminal: matar el proceso de la
  terminal (`kill $!`/Ctrl+C) no siempre lo termina. Si un puerto queda
  "pegado" o las cabeceras de una corrida anterior parecen no actualizarse
  después de reconstruir, conviene revisar `tasklist | findstr workerd` y
  `netstat -ano | findstr <puerto>` y terminar esos procesos con
  `taskkill //F //IM workerd.exe //T` antes de reintentar.

## 11. Secretos y variables por workflow

Nombres completos, de dónde salen y para qué exactamente en `docs/environments.md`
sección 4. Resumen de qué usa cada workflow:

| Workflow                | Secretos / variables                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`                | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF_DEV`, `SUPABASE_DB_URL_DEV` — los tres solo se leen en los pasos condicionados de `db:types`/pgTAP (hoy no se ejecutan).                                                                                                                                                                                                                                                          |
| `deploy-staging.yml`    | `vars.STAGING_DEPLOY_ENABLED`; `SUPABASE_DB_URL_DEV`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF_DEV`; `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` (secretos del `environment: staging`); `VITE_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`; `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.                                                                                                                                          |
| `deploy-production.yml` | `vars.PRODUCTION_DEPLOY_ENABLED`; `SUPABASE_DB_URL_PROD`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF_PROD`; `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET`/`CLOUDFLARE_ACCOUNT_ID`/`BACKUP_PASSPHRASE` (volcado previo, sección 6.1); `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` (secretos del `environment: production`); `VITE_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`; `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`. |
| `backup.yml`            | `vars.BACKUP_ENABLED`; `SUPABASE_DB_URL_PROD`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `CLOUDFLARE_ACCOUNT_ID`, `BACKUP_PASSPHRASE` — todos secretos de **repositorio**, no de `environment` (sección 4): un cron diario no puede depender de una aprobación manual.                                                                                                                                            |
| `keepalive.yml`         | `SUPABASE_DB_URL_DEV`.                                                                                                                                                                                                                                                                                                                                                                                                           |
| `restore-test.yml`      | `SUPABASE_DB_URL_DEV`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `CLOUDFLARE_ACCOUNT_ID`, `BACKUP_PASSPHRASE` — nunca `SUPABASE_DB_URL_PROD` (sección 6.3).                                                                                                                                                                                                                                                       |

**Nota sobre `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` / `VITE_SENTRY_DSN`:**
`docs/environments.md` (P03.2) las documentó como "variable de Pages por
rama", asumiendo que Cloudflare Pages construía el sitio a partir del
repositorio conectado por Git. Este encargo (INFRA-016/017) resolvió el
despliegue distinto: **el build lo hace GitHub Actions** (`pnpm build`) y
`wrangler pages deploy` solo sube el `dist/` ya construido — Cloudflare no
ejecuta ningún build propio (confirmado también en P03.4: el proyecto de
Pages se creó sin conectar ningún repositorio de Git). Por eso estas
variables también tienen que existir como **secretos de GitHub**, no solo
como variables del panel de Pages: `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`
difieren entre `App_dev` y `App`, así que se cargan como secretos de cada
`environment` (`staging` / `production`) con el mismo nombre en los dos,
en vez de dos pares de secretos con sufijo `_DEV`/`_PROD`. `VITE_SENTRY_DSN`
es el mismo proyecto de Sentry en ambos entornos (el plan usa un solo
proyecto, diferenciado por `environment` dentro de Sentry), así que alcanza
con un secreto de repositorio, sin scoping por `environment`. Queda
anotado también en `docs/environments.md`.

## 12. Qué falta para que esto corra de verdad

**Estado al cierre de F3 (P03.7).** Todo lo de la sección 1 corrió de verdad
contra un proyecto remoto salvo `restore-test.yml` (sección 6.3, pendiente
de F4 a propósito). En orden:

- P03.5 (Mike): tokens con permisos mínimos (Cloudflare, R2, Sentry) y todos
  los secretos de GitHub y de cada `environment` cargados
  (`docs/environments.md` sección 4), incluida `BACKUP_PASSPHRASE` guardada
  también fuera de GitHub (sección 6.3). Hecho.
- P03.6 (infra-devops + Orq, con OK explícito de Mike): primer despliegue a
  Pages y verificación en `*.pages.dev`, alta de `dev.`, cambio del CNAME de
  `app.` y desactivación de GitHub Pages (INFRA-013, INFRA-014, sin corte —
  sección 7); `environment` `production` con revisor obligatorio (sección
  4); protección de ramas con `CI` como verificación obligatoria (sección
  2); interruptores de staging y producción activados (sección 3). Hecho.
- P03.7 (infra-devops): INFRA-024 (alertas de uso de Supabase y de fallos de
  workflows, `docs/environments.md` sección 7), interruptor de respaldo
  activado y primer respaldo real verificado (sección 6.2), y
  `restore-test.yml` escrito y listo, sin ejecutar todavía (sección 6.3).
  Hecho, con esa única restauración real pendiente de F4.

Lo único que queda pendiente del alcance de F3 es disparar `restore-test.yml`
por primera vez, y eso es a propósito (sección 6.3): recién tiene sentido
cuando `App` tenga datos reales de F4 para restaurar en `App_dev`.

## 13. Pase de `develop` a `main` y `workflow_dispatch` desde `main`

**El pase a producción es un PR de `develop` a `main`, fusionado con merge
commit** (decisión de Mike, 19 sep 2026) — no squash. Motivo: las ramas de
tarea siguen yendo a `develop` con squash merge (`README.md`, "Flujo de
ramas"); si el pase de `develop` a `main` también fuera squash, el segundo
pase quedaría bloqueado porque GitHub ve historiales distintos entre las dos
ramas y no encuentra un ancestro común limpio para el siguiente PR. Con
merge commit, `main` conserva el historial real de `develop` y cada pase
siguiente es un fast-forward o un merge sin conflictos de historial. En
`main`, la protección de rama exige solo "por PR" y `CI` en verde (sin
"historial lineal" ni "al día con el destino": esas dos reglas son las que
un merge commit no puede cumplir a la vez que un squash en `develop`).

Cada pase corre así:

1. PR de `develop` a `main` (lo abre el orquestador).
2. `ci.yml` corre igual que en cualquier PR (verificación obligatoria).
3. Al fusionar (merge commit), `deploy-production.yml` se dispara por el
   push a `main`: volcado previo a R2 (sección 5), migraciones a `App` si
   las hay, build, publicación en Pages y smoke test — todo eso **esperando
   la aprobación de Mike** en el `environment` `production` (sección 4).
4. Una vez en `main`, el orquestador crea la etiqueta de versión que
   corresponda (`08_Fases_y_Backlog.md` sección 5).

**`workflow_dispatch` solo funciona con workflows que ya estén en `main`.**
GitHub solo ofrece el botón "Run workflow" en la pestaña **Actions**, y solo
acepta `gh workflow run`, para un workflow cuyo archivo `.yml` ya existe en
la **rama por defecto del repositorio** (`main`), aunque después se elija
correr ese workflow apuntando a otra rama. Un workflow con `workflow_dispatch`
que solo existe en `develop` no aparece como opción para disparar a mano
hasta que llegue a `main`. Esto ya se comprobó en la práctica en P03.6:
`keepalive.yml` se había fusionado en `develop` en P03.2, pero recién pudo
dispararse a mano una vez que el primer pase `develop → main` lo llevó
también a la rama por defecto — el orquestador lo disparó desde `main`
apenas se pudo (la consulta a `App_dev` anduvo). Es exactamente lo que le
pasa hoy a `restore-test.yml` (sección 6.3): existe en `develop` desde
P03.7, pero no se puede disparar hasta que un pase futuro lo lleve a `main`.
