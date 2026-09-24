#!/usr/bin/env bash
set -euo pipefail

# scripts/restore-from-r2.sh — INFRA-018/INFRA-024 (ADR-015, TEST-024): baja un respaldo de R2,
# lo descifra, restaura en App_dev el esquema "public" MÁS los usuarios de "auth" (auth.users,
# auth.identities), verifica el resultado y borra todo lo restaurado antes de terminar. Lo usa
# .github/workflows/restore-test.yml (workflow_dispatch, todavía sin correr: se dispara recién
# cuando App tenga las tablas de F4, ver docs/deployment.md sección 6.3) y sirve también para una
# restauración manual siguiendo el paso a paso de ese mismo documento.
#
# SOLO App_dev. Este script no lee SUPABASE_DB_URL_PROD en ningún lado: estructuralmente no
# puede apuntar a App (producción) por accidente ni por variable mal cargada. Restaurar
# producción es un procedimiento manual y excepcional aparte (docs/runbook-produccion.md, F20),
# nunca este script.
#
# DECISIONES DE MIKE (19 sep 2026), corrección de P03.7 — docs/deployment.md sección 6.3 tiene el
# detalle completo:
#   1. Se restaura App_dev CON usuarios reales de producción: el esquema "public" completo más
#      auth.users y auth.identities (lo mínimo para que las referencias de "public" hacia
#      auth.users cierren). Mike aceptó que datos personales y hashes de contraseña de
#      producción pasen por App_dev durante la prueba.
#   2. La prueba LIMPIA lo que restauró antes de terminar (siempre, incluso si algo falla a
#      mitad de camino): App_dev tiene que quedar sin los datos reales apenas termina, porque
#      "dev." sirve desde App_dev y mientras los usuarios restaurados sigan ahí, cualquier
#      empleado real podría iniciar sesión en staging con su contraseña de producción, y los
#      emails de Auth de App_dev podrían llegarle a gente real.
#
# CORRECCIÓN (23 sep 2026, fix/TEST-024-restore-sequence, primer intento — validada de punta a
# punta contra Postgres 17 local en Docker, docs/deployment.md sección 6.3): la versión anterior
# recreaba "public" desde cero (DROP TABLE + CREATE TABLE, --section=pre-data/post-data) y eso
# traía DOS defectos reales:
#   a. El DROP TABLE podía fallar por objetos de post-data (claves foráneas, políticas RLS) que
#      dependen de la tabla y que --clean de pre-data no toca, y probando la solución "borrar
#      antes las FK/políticas" apareció un problema más de fondo: recrear la estructura puede
#      cascadear a objetos de OTRO esquema (por ejemplo, `app.log_security_event` devuelve
#      `public.security_events`, así que `drop table ... cascade` se llevaría puesta una función
#      de "app" que este script no tiene que tocar).
#   b. `--no-privileges` (necesario porque `backup-to-r2.sh` tampoco graba privilegios en el
#      volcado) dejaba las tablas recreadas con el ACL por defecto de Supabase (más abierto que
#      `0017_grants.sql`).
#   Los dos defectos comparten la misma causa: recrear la ESTRUCTURA de "public" es innecesario.
#   El paso 0 (más abajo) YA garantiza que App_dev tiene exactamente las mismas migraciones que el
#   volcado, así que la estructura (tablas, columnas, restricciones, índices, políticas, ACL) es
#   IDÉNTICA en los dos lados: alcanza con reemplazar los DATOS, sin tocar nunca la estructura.
#   Nunca se toca un GRANT, un REVOKE ni una política: quedan exactamente como los dejaron las
#   migraciones, siempre.
#   Además, en la validación local aparecieron dos defectos más, independientes de los dos de
#   arriba, los dos de PostgreSQL 17.11 (el cliente que instala `asegurar_pg17` en el runner):
#   c. `pg_restore -t auth.users` (con el esquema pegado al nombre de la tabla) no matcheaba
#      NINGÚN objeto del volcado (falla silenciosa: pg_restore no imprime error, pero tampoco
#      restaura una sola fila) -- confirmado también contra `public.clients` con el mismo patrón:
#      `--table=esquema.tabla` no encuentra nada, `--table=tabla` sí. Se corrige usando
#      `-n <esquema> -t <tabla>` (dos argumentos separados), que sí matchea.
#   d. `pg_restore --data-only -t <tabla>` sin `--dbname` NI `--file` (para leer el volcado sin
#      tocar ninguna base, paso 0 de más abajo) ahora corta con el error "one of -d/--dbname and
#      -f/--file must be specified": esta versión ya no imprime a la salida estándar por defecto
#      como hacían versiones anteriores. Se corrige agregando `-f -` (salida estándar explícita).
#   El primer intento resolvía el orden de carga entre tablas (para que las claves foráneas no
#   fallaran por ese motivo) con `alter table ... disable trigger all` en todas las tablas de
#   "public". ESO TENÍA UN DEFECTO BLOQUEANTE, corregido en el segundo intento (ver el bloque
#   siguiente): `disable trigger all` incluye a los triggers internos de las claves foráneas
#   (`RI_ConstraintTrigger_*`), y deshabilitar ESOS puntualmente exige superusuario -- no alcanza
#   con ser dueño de la tabla. La validación del primer intento no lo detectó porque corrió como
#   superusuario de un Postgres vainilla en Docker, y en Supabase "postgres" NO es superusuario
#   (confirmado en App_dev: `select rolsuper from pg_roles where rolname = 'postgres'` da `false`).
#   El error real en un rol sin superusuario es: `ERROR: permission denied: "RI_ConstraintTrigger_
#   c_..." is a system trigger`.
#
# CORRECCIÓN 2 (23 sep 2026, fix/TEST-024-restore-sequence, segundo intento -- revisión del
# orquestador, validada de nuevo en Docker con un rol dueño de las tablas SIN superusuario, ver el
# reporte de la tarea): en vez de deshabilitar triggers tabla por tabla, cada carga de datos fija
# `session_replication_role = replica` en su propia conexión ANTES de correr el `pg_restore`/
# `psql` que inserta filas. Con `replica` activo, ni los triggers de usuario (incluido el que F4
# agrega sobre auth.users para crear la fila de "profiles") ni los triggers internos de las claves
# foráneas se disparan -- así el orden de carga entre tablas deja de importar, sin necesidad de
# tocar ningún trigger de ninguna tabla ni de recrear nada.
#   Por qué funciona sin superusuario en Supabase: `session_replication_role` es un parámetro que
#   por defecto solo puede cambiar un superusuario, pero Supabase instala la extensión
#   `supautils`, que mantiene una lista propia de parámetros que roles no-superusuario SÍ pueden
#   fijar (`supautils.privileged_role_allowed_configs`) -- "postgres" figura ahí para
#   `session_replication_role`. Confirmado por el orquestador en App_dev, en una transacción
#   revertida (`begin; set local session_replication_role = replica; rollback;`, sin dejar ningún
#   cambio): el `set local` no da error, aunque
#   `select has_parameter_privilege('postgres', 'session_replication_role', 'SET')` devuelva
#   `false` (esa función solo conoce el mecanismo estándar de PostgreSQL 15+,
#   `GRANT SET ON PARAMETER ... TO ...`, no el mecanismo propio de `supautils`).
#   Por qué cada carga usa SU PROPIA conexión: `session_replication_role` vale por conexión, no
#   por rol ni de forma global -- fijarlo en una conexión de `psql` y después correr un
#   `pg_restore --dbname ...` aparte (que abre OTRA conexión) no serviría de nada. Por eso cada
#   paso que necesita `replica` arma el SQL completo (el `SET` más el contenido que genera
#   `pg_restore -f -`) y lo manda TODO por la misma tubería a un único `psql`, que abre una sola
#   conexión para las dos cosas. No se usa `PGOPTIONS="-c session_replication_role=replica"`
#   porque el Session pooler de Supabase puede no reenviar opciones de arranque de conexión al
#   servidor real, y `supautils` valida el permiso en el momento del `SET` explícito, no en el
#   arranque de la conexión -- confirmado que hay que fijarlo con un `SET` dentro de la sesión.
#   Con "replica" ya no hace falta el paso que vaciaba "public" por segunda vez (el trigger que
#   crea "profiles" tampoco se dispara al restaurar auth.users): la secuencia de abajo quedó con
#   un paso menos.
#
# PERMISOS SIN CONFIRMAR: la documentación pública de Supabase describe al rol "postgres" (el que
# usa este script, vía el Session pooler) como "the default Postgres role. This has admin
# privileges", pero en ningún lado confirma ni niega privilegios de INSERT/DELETE sobre
# auth.users/auth.identities, y recomienda explícitamente NO escribir en auth.users a mano ("may
# change at any time", usar la Auth Admin API). No pude confirmar esto en vivo (esta capa no
# inicia sesión en ningún servicio). El diseño de abajo falla rápido y sin dejar nada a medias si
# el permiso no está (cada paso corre en su propia transacción, y la limpieza final corre siempre
# por `trap`). Antes de la primera corrida real (después de F4), Mike puede confirmarlo sin
# arriesgar nada, desde el SQL Editor de App_dev:
#   select has_table_privilege('postgres', 'auth.users', 'INSERT') as auth_users_insert,
#          has_table_privilege('postgres', 'auth.users', 'DELETE') as auth_users_delete,
#          has_table_privilege('postgres', 'auth.identities', 'INSERT') as auth_identities_insert,
#          has_table_privilege('postgres', 'auth.identities', 'DELETE') as auth_identities_delete;
#
# ALCANCE en "public": todas las tablas, vistas, funciones, índices y datos que crean las
# migraciones propias. No se toca la ESTRUCTURA de "auth" (solo sus filas): nunca se hace DROP ni
# ALTER sobre auth.users/auth.identities, esquemas/tablas que administra Supabase
# (supabase_auth_admin es su dueño, no "postgres").
#
# SECUENCIA (segundo intento, validada de nuevo en Docker con un rol sin superusuario, ver el
# reporte de la tarea para los números):
#   0. Verifica que App_dev tenga las mismas migraciones aplicadas que el volcado
#      (supabase_migrations.schema_migrations) -- si no coinciden, aborta ANTES de tocar nada.
#      Esto es lo que garantiza que la ESTRUCTURA de "public" es idéntica en los dos lados: el
#      resto de la secuencia confía en eso para no tener que recrear nada.
#   1. Vacía "public" (TRUNCATE ... CASCADE) por si App_dev tenía datos de antes. TRUNCATE no
#      necesita `session_replication_role` ni deshabilitar nada: alcanza con ser dueño de la
#      tabla, y CASCADE ya se encarga de las tablas dependientes.
#   2. Reemplaza auth.users/auth.identities, en una única conexión con `session_replication_role
#      = replica` fijado al principio: borra lo que haya (identities antes que users) y restaura
#      los datos del volcado (users antes que identities, con `-n auth -t <tabla>`, ver la nota de
#      arriba sobre `-t esquema.tabla`). Con "replica" activo, el trigger que F4 agrega sobre
#      auth.users (crea la fila de "profiles", 04_Modelo_de_Datos.md) NO se dispara -- ya no hace
#      falta un paso aparte para limpiar ese efecto secundario.
#   3. Carga los datos de "public" (--section=data), también con `session_replication_role =
#      replica` fijado en esa misma conexión: ni los triggers de usuario ni los internos de las
#      claves foráneas se disparan, así que el orden de carga entre tablas no importa.
#   4. Verifica (cantidad de tablas y filas por tabla, nunca contenido: nada de emails, nombres
#      ni otras columnas).
#   5. Limpieza (siempre, por `trap`, corra lo que corra arriba): vacía "public" y borra los
#      usuarios de auth restaurados, y confirma que quedaron vacíos.
#
# Cada paso de la secuencia corre en su propia transacción (`begin`/`commit` explícito en los
# bloques de psql, incluidos los que arman `session_replication_role = replica` + el SQL que
# genera `pg_restore -f -` y lo mandan junto a un único `psql --single-transaction`): si algo
# falla a mitad de un paso, ESE paso se revierte solo. No hay una única transacción global para
# toda la secuencia (el paso 3 necesita ver ya confirmados los datos del paso 2, escritos en una
# conexión distinta) -- la garantía de "nunca dejar nada a medias" la da la limpieza del paso 5,
# que corre siempre.
#
# NO SE IMPRIME NINGÚN DATO PERSONAL: la verificación cuenta filas (números), nunca imprime
# contenido de ninguna tabla ni de auth.users/auth.identities.
#
# ES DESTRUCTIVO, dos veces: primero reemplaza el contenido de App_dev por el del volcado, después
# lo borra todo de nuevo al terminar. Nunca correr esto contra una base que tenga algo que no se
# pueda perder, ni asumir que App_dev conserva datos entre una corrida y la siguiente: la prueba
# lo deja vacío a propósito. Volver a cargar datos de prueba después es un paso aparte (ver
# docs/deployment.md sección 6.3, "Después de la prueba").
#
# Uso:
#   scripts/restore-from-r2.sh --listar
#     Lista las claves disponibles en el bucket es-backups (más recientes primero), para elegir
#     cuál restaurar.
#
#   scripts/restore-from-r2.sh <clave-del-objeto> restaurar-app-dev
#     Por ejemplo: scripts/restore-from-r2.sh diarios/App_20260101_030000.dump.gpg restaurar-app-dev
#     Baja <clave-del-objeto>, la descifra y corre la secuencia completa de arriba contra
#     App_dev. El segundo argumento tiene que ser exactamente la palabra "restaurar-app-dev": es
#     la confirmación explícita que exige ADR-015 antes de un paso destructivo. Si la entrada
#     estándar es una terminal interactiva, además pide escribir la misma palabra una segunda vez
#     antes de tocar nada.
#
#   scripts/restore-from-r2.sh --ultimo restaurar-app-dev
#     Igual que arriba, pero en vez de indicar una clave elige sola el respaldo más reciente con
#     prefijo "diarios/". La usa restore-test.yml cuando no se indica el input "objeto_r2".
#
#   scripts/restore-from-r2.sh --confirmar-vacio
#     Solo verifica y reporta si "public" y auth.users/auth.identities están vacíos en App_dev
#     (números, sin datos). No restaura ni borra nada. La usa restore-test.yml como paso final
#     `if: always()`, además de la limpieza automática de este script, para dejar constancia en
#     el log de la corrida.
#
# Variables de entorno requeridas (ninguna se imprime en ningún momento):
#   SUPABASE_DB_URL_DEV    Cadena de conexión de App_dev, Session pooler (IPv4).
#   R2_ACCESS_KEY_ID       Access key S3 del token de R2 con permisos sobre R2_BUCKET.
#   R2_SECRET_ACCESS_KEY   Secret key S3 del mismo token.
#   R2_BUCKET              Nombre del bucket privado de respaldos (es-backups).
#   CLOUDFLARE_ACCOUNT_ID  Id de cuenta de Cloudflare: arma el endpoint S3 de R2.
#   BACKUP_PASSPHRASE      La misma frase de cifrado que usó scripts/backup-to-r2.sh para este
#                          respaldo. Sin ella no se puede descifrar (docs/deployment.md).
# (--confirmar-vacio solo necesita SUPABASE_DB_URL_DEV.)

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/dependencias-ci.sh"

uso() {
  cat >&2 <<'USO'
Uso:
  scripts/restore-from-r2.sh --listar
  scripts/restore-from-r2.sh <clave-del-objeto> restaurar-app-dev
  scripts/restore-from-r2.sh --ultimo restaurar-app-dev
  scripts/restore-from-r2.sh --confirmar-vacio
USO
}

requerir_vars() {
  for var in "$@"; do
    if [ -z "${!var:-}" ]; then
      echo "Falta la variable de entorno $var. Ver docs/deployment.md / docs/environments.md." >&2
      exit 1
    fi
  done
}

configurar_credenciales_r2() {
  export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
  export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
  export AWS_DEFAULT_REGION="auto"
  endpoint="https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com"
}

# Cuenta filas totales de "public" (todas las tablas) y de auth.users/auth.identities. Solo
# números: nunca imprime contenido.
contar_filas_app_dev() {
  filas_public="$("$PG_BIN_DIR/psql" "$SUPABASE_DB_URL_DEV" -X -q -A -t -v ON_ERROR_STOP=1 -c "
    select coalesce(sum(
      (xpath('/row/c/text()',
        query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text::bigint
    ), 0)
    from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE';
  ")"
  filas_auth_users="$("$PG_BIN_DIR/psql" "$SUPABASE_DB_URL_DEV" -X -q -A -t -v ON_ERROR_STOP=1 -c \
    "select count(*) from auth.users;")"
  filas_auth_identities="$("$PG_BIN_DIR/psql" "$SUPABASE_DB_URL_DEV" -X -q -A -t -v ON_ERROR_STOP=1 -c \
    "select count(*) from auth.identities;")"
}

# Vacía TODAS las tablas de "public" (TRUNCATE ... CASCADE, dentro de su propia transacción). No
# hace falta deshabilitar ni habilitar ningún trigger para esto: TRUNCATE es una operación por
# tabla completa (no dispara triggers por fila) y CASCADE ya se encarga de las tablas
# dependientes. Se usa tanto en el paso 1 de la secuencia normal como en la limpieza del paso 5.
vaciar_public() {
  "$PG_BIN_DIR/psql" "$SUPABASE_DB_URL_DEV" -X -q -v ON_ERROR_STOP=1 -f - <<'SQL'
begin;
do $do$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('truncate table public.%I cascade', r.tablename);
  end loop;
end
$do$;
commit;
SQL
}

if [ "${1:-}" = "--listar" ]; then
  requerir_vars R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET CLOUDFLARE_ACCOUNT_ID
  asegurar_aws_cli
  configurar_credenciales_r2
  echo "Objetos en s3://${R2_BUCKET} (más recientes primero):"
  aws s3api list-objects-v2 --bucket "$R2_BUCKET" --endpoint-url "$endpoint" \
    --query 'reverse(sort_by(Contents, &LastModified))[].{Fecha:LastModified,Clave:Key,Bytes:Size}' \
    --output table
  exit 0
fi

if [ "${1:-}" = "--confirmar-vacio" ]; then
  requerir_vars SUPABASE_DB_URL_DEV
  asegurar_pg17
  echo "Confirmando que App_dev (esquema public y usuarios de auth) quedó vacío..."
  contar_filas_app_dev
  echo "  Filas en public (todas las tablas): ${filas_public}"
  echo "  Filas en auth.users:                ${filas_auth_users}"
  echo "  Filas en auth.identities:           ${filas_auth_identities}"
  if [ "$filas_public" != "0" ] || [ "$filas_auth_users" != "0" ] || [ "$filas_auth_identities" != "0" ]; then
    echo "ADVERTENCIA: App_dev no quedó vacío. dev. no es seguro mientras esto no se resuelva: revisar a mano (docs/deployment.md sección 6.3)." >&2
    exit 1
  fi
  echo "OK: App_dev quedó vacío."
  exit 0
fi

object_key="${1:-}"
confirmacion="${2:-}"

if [ -z "$object_key" ] || [ "$confirmacion" != "restaurar-app-dev" ]; then
  uso
  exit 1
fi

requerir_vars SUPABASE_DB_URL_DEV R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET \
  CLOUDFLARE_ACCOUNT_ID BACKUP_PASSPHRASE

if [ "$object_key" = "--ultimo" ]; then
  asegurar_aws_cli
  configurar_credenciales_r2
  echo "Buscando el respaldo más reciente en diarios/..."
  object_key="$(aws s3api list-objects-v2 --bucket "$R2_BUCKET" --prefix "diarios/" \
    --endpoint-url "$endpoint" \
    --query 'reverse(sort_by(Contents, &LastModified))[0].Key' --output text)"
  if [ -z "$object_key" ] || [ "$object_key" = "None" ]; then
    echo "No hay ningún respaldo en diarios/ todavía: no hay nada para restaurar." >&2
    exit 1
  fi
  echo "Respaldo más reciente: ${object_key}"
fi

if [ -t 0 ]; then
  echo "Esto va a reemplazar durante unos minutos TODO el esquema public y los usuarios de auth"
  echo "de App_dev con el contenido de:"
  echo "  ${object_key}"
  echo "Van a pasar datos personales y hashes de contraseña reales de producción por App_dev"
  echo "mientras dura la prueba (decisión de Mike, 19 sep 2026). Al final se borra todo de nuevo."
  read -r -p "Escribí de nuevo 'restaurar-app-dev' para confirmar: " confirmacion_interactiva
  if [ "$confirmacion_interactiva" != "restaurar-app-dev" ]; then
    echo "Confirmación no coincide: abortado, no se tocó nada." >&2
    exit 1
  fi
else
  echo "Entrada no interactiva: se toma como confirmación suficiente el segundo argumento." >&2
fi

asegurar_pg17
asegurar_aws_cli
configurar_credenciales_r2

workdir="$(mktemp -d)"
restauracion_iniciada=false

limpiar_app_dev() {
  local rc=$?
  if [ "$restauracion_iniciada" = true ]; then
    echo ""
    echo "Limpiando App_dev (dejando public y los usuarios de auth restaurados vacíos -- siempre" \
      "corre esto, haya salido bien o mal lo de arriba)..."
    if vaciar_public && "$PG_BIN_DIR/psql" "$SUPABASE_DB_URL_DEV" -X -q -v ON_ERROR_STOP=1 -c "
      begin;
      delete from auth.identities;
      delete from auth.users;
      commit;
    "
    then
      contar_filas_app_dev
      echo "  Filas en public (todas las tablas): ${filas_public}"
      echo "  Filas en auth.users:                ${filas_auth_users}"
      echo "  Filas en auth.identities:           ${filas_auth_identities}"
      if [ "$filas_public" != "0" ] || [ "$filas_auth_users" != "0" ] || [ "$filas_auth_identities" != "0" ]; then
        echo "ADVERTENCIA: la limpieza corrió pero App_dev no quedó vacío. dev. NO es seguro: revisar a mano ya mismo (docs/deployment.md sección 6.3)." >&2
        rc=1
      else
        echo "OK: App_dev quedó vacío."
      fi
    else
      echo "ADVERTENCIA: la limpieza automática de App_dev encontró un error. dev. puede NO ser seguro: revisar a mano ya mismo, y correr 'scripts/restore-from-r2.sh --confirmar-vacio' (docs/deployment.md sección 6.3)." >&2
      rc=1
    fi
  fi
  rm -rf "$workdir"
  exit "$rc"
}
trap limpiar_app_dev EXIT

encrypted_file="$workdir/respaldo.dump.gpg"
dump_file="$workdir/respaldo.dump"

echo "Bajando ${object_key} de R2 (bucket ${R2_BUCKET})..."
aws s3 cp "s3://${R2_BUCKET}/${object_key}" "$encrypted_file" \
  --endpoint-url "$endpoint" --only-show-errors

echo "Descifrando el volcado (gpg)..."
printf '%s' "$BACKUP_PASSPHRASE" | gpg --batch --yes --pinentry-mode loopback \
  --passphrase-fd 0 --decrypt --output "$dump_file" "$encrypted_file"
rm -f "$encrypted_file" # el volcado cifrado ya no hace falta en disco

echo ""
echo "Verificando que App_dev tenga las mismas migraciones aplicadas que el volcado" \
  "(supabase_migrations.schema_migrations)..."
# "version" es la clave primaria de esta tabla de control de Supabase CLI: se busca su posición
# en la lista de columnas del propio COPY en vez de asumir que es la primera, por si el orden
# cambiara. No toca ninguna base de datos: pg_restore sin --dbname solo imprime el SQL.
versiones_volcado="$("$PG_BIN_DIR/pg_restore" --data-only -n supabase_migrations -t schema_migrations -f - "$dump_file" \
  | awk '
      /^COPY supabase_migrations\.schema_migrations \(/ {
        line = $0
        sub(/^COPY supabase_migrations\.schema_migrations \(/, "", line)
        sub(/\) FROM stdin;$/, "", line)
        n = split(line, cols, ", ")
        idx = 0
        for (i = 1; i <= n; i++) if (cols[i] == "version") idx = i
        flag = 1
        next
      }
      /^\\\.$/ { flag = 0 }
      flag && idx > 0 {
        split($0, f, "\t")
        print f[idx]
      }
    ' | sort)"

if [ -z "$versiones_volcado" ]; then
  echo "ABORTADO: no se pudo extraer la lista de migraciones del volcado (supabase_migrations.schema_migrations vino vacía o no se pudo leer). No se toca App_dev." >&2
  exit 1
fi

versiones_app_dev="$("$PG_BIN_DIR/psql" "$SUPABASE_DB_URL_DEV" -X -q -A -t -v ON_ERROR_STOP=1 -c \
  "select version from supabase_migrations.schema_migrations order by version;" | sort)"

if [ "$versiones_volcado" != "$versiones_app_dev" ]; then
  echo "ABORTADO: App_dev no está en la misma versión de migraciones que el volcado. No se toca nada." >&2
  echo "Versiones en el volcado:" >&2
  echo "$versiones_volcado" >&2
  echo "Versiones en App_dev:" >&2
  echo "$versiones_app_dev" >&2
  echo "Corré 'pnpm db:push' contra App_dev (o esperá a que deploy-staging.yml lo haga) y reintentá." >&2
  exit 1
fi
echo "OK: App_dev tiene las mismas migraciones que el volcado (${versiones_app_dev})."
echo "Como la estructura es idéntica a la del volcado, esta secuencia solo reemplaza DATOS: nunca" \
  "hace falta recrear tablas, restricciones, políticas ni permisos (docs/deployment.md sección 6.3)."

restauracion_iniciada=true

echo ""
echo "1/3 - Vaciando public, por si App_dev tenía datos de antes..."
vaciar_public

echo ""
echo "2/3 - Reemplazando los usuarios de auth (auth.users, auth.identities), con" \
  "session_replication_role = replica fijado en esta misma conexión (así el trigger que crea" \
  "profiles al insertar en auth.users no se dispara, y el orden entre auth.users y" \
  "auth.identities deja de importar)..."
# Todo el SQL de este paso (el SET, los DELETE y el contenido que genera pg_restore -f -) va por
# una sola tubería a un único psql: session_replication_role vale por conexión, así que fijarlo en
# un psql aparte y restaurar con un pg_restore --dbname (que abriría OTRA conexión) no serviría de
# nada. `-n <esquema> -t <tabla>` (dos argumentos), NO `-t esquema.tabla`: verificado en la
# validación local (ver el comentario del encabezado) que `pg_restore -t esquema.tabla` no
# matchea ningún objeto del volcado en PostgreSQL 17.11 -- termina sin error pero sin restaurar
# una sola fila.
# Los DELETE van ANTES del SET, a propósito: con `replica` tampoco se disparan los ON DELETE
# CASCADE, y borrar auth.users así dejaría huérfanas las filas de auth.sessions,
# auth.refresh_tokens, auth.mfa_factors y demás tablas que dependen de ella (comprobado por el
# orquestador en Docker el 23 sep 2026). Si después se recrearan usuarios con los mismos id,
# esas sesiones viejas volverían a quedar asociadas a ellos.
{
  printf 'delete from auth.identities;\n'
  printf 'delete from auth.users;\n'
  printf 'set session_replication_role = replica;\n'
  "$PG_BIN_DIR/pg_restore" --data-only -n auth -t users --no-owner --no-privileges -f - "$dump_file"
  "$PG_BIN_DIR/pg_restore" --data-only -n auth -t identities --no-owner --no-privileges -f - "$dump_file"
} | "$PG_BIN_DIR/psql" "$SUPABASE_DB_URL_DEV" -X -q -v ON_ERROR_STOP=1 --single-transaction -f -

echo ""
echo "3/3 - Cargando los datos de public (--section=data), también con session_replication_role" \
  "= replica fijado en esta conexión: ni los triggers de usuario ni los internos de las claves" \
  "foráneas se disparan, así que el orden de carga entre tablas no importa..."
{
  printf 'set session_replication_role = replica;\n'
  "$PG_BIN_DIR/pg_restore" --schema=public --data-only --no-owner --no-privileges \
    --section=data -f - "$dump_file"
} | "$PG_BIN_DIR/psql" "$SUPABASE_DB_URL_DEV" -X -q -v ON_ERROR_STOP=1 --single-transaction -f -

echo ""
echo "Restauración completa. Verificando (solo cantidades, nunca contenido)..."

tablas_volcado="$("$PG_BIN_DIR/pg_restore" --schema=public -l "$dump_file" \
  | grep -cE '^[0-9]+; [0-9]+ [0-9]+ TABLE public ' || true)"
tablas_app_dev="$("$PG_BIN_DIR/psql" "$SUPABASE_DB_URL_DEV" -X -q -A -t -v ON_ERROR_STOP=1 -c \
  "select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE';")"

echo "  Tablas en el volcado (pg_restore -l, esquema public): ${tablas_volcado}"
echo "  Tablas en App_dev (esquema public):                   ${tablas_app_dev}"

if [ "$tablas_volcado" != "$tablas_app_dev" ]; then
  echo "VERIFICACION FALLIDA: la cantidad de tablas restauradas no coincide con la del volcado." >&2
  exit 1
fi
echo "Verificación OK: coincide la cantidad de tablas (${tablas_app_dev})."

echo ""
echo "Filas por tabla en App_dev (esquema public), para revisión manual (solo conteos, nunca" \
  "contenido):"
"$PG_BIN_DIR/psql" "$SUPABASE_DB_URL_DEV" -X -q -A -t -v ON_ERROR_STOP=1 -c \
  "select table_name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'
     order by table_name;" \
  | while IFS= read -r tabla; do
      [ -z "$tabla" ] && continue
      filas="$("$PG_BIN_DIR/psql" "$SUPABASE_DB_URL_DEV" -X -q -A -t -v ON_ERROR_STOP=1 -c \
        "select count(*) from public.\"${tabla}\";")"
      echo "  ${tabla}: ${filas} filas"
    done

filas_auth_users_verif="$("$PG_BIN_DIR/psql" "$SUPABASE_DB_URL_DEV" -X -q -A -t -v ON_ERROR_STOP=1 -c \
  "select count(*) from auth.users;")"
filas_auth_identities_verif="$("$PG_BIN_DIR/psql" "$SUPABASE_DB_URL_DEV" -X -q -A -t -v ON_ERROR_STOP=1 -c \
  "select count(*) from auth.identities;")"
echo "  auth.users: ${filas_auth_users_verif} filas"
echo "  auth.identities: ${filas_auth_identities_verif} filas"

echo ""
echo "Restauración y verificación completas: ${object_key} -> App_dev. Limpiando a continuación" \
  "(ver más abajo): esto no debe interpretarse como que App_dev quedó con estos datos."
