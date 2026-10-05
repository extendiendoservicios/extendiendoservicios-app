#!/usr/bin/env bash
set -euo pipefail

# scripts/restore-from-r2.sh — INFRA-018/INFRA-024 (ADR-015, TEST-024): baja un respaldo de R2 (o
# toma un volcado local), lo descifra, restaura en App_dev el esquema "public" MÁS los usuarios de
# "auth" (auth.users, auth.identities), verifica el resultado y borra todo lo restaurado antes de
# terminar. Lo usa .github/workflows/restore-test.yml (workflow_dispatch) y sirve también para una
# restauración manual. La guía para quien lo dispara, con el acta de la prueba y la recuperación
# de App_dev, es docs/restore-test.md; el diseño completo y su historia, docs/deployment.md
# sección 6.3.
#
# SOLO App_dev. Este script no lee SUPABASE_DB_URL_PROD en ningún lado: estructuralmente no
# puede apuntar a App (producción) por accidente ni por variable mal cargada. Restaurar
# producción es un procedimiento manual y excepcional aparte (docs/runbook-produccion.md), nunca
# este script.
#
# DECISIONES DE MIKE (19 sep 2026):
#   1. Se restaura App_dev CON usuarios reales de producción: el esquema "public" completo más
#      auth.users y auth.identities (lo mínimo para que las referencias de "public" hacia
#      auth.users cierren). Datos personales y HASHES DE CONTRASEÑA de producción pasan por
#      App_dev mientras dura la prueba.
#   2. La prueba LIMPIA lo que restauró antes de terminar (siempre, incluso si algo falla a mitad
#      de camino): "dev." sirve desde App_dev, y mientras los usuarios restaurados sigan ahí,
#      cualquier empleado real podría iniciar sesión en staging con su contraseña de producción.
#
# POR QUÉ SOLO SE REEMPLAZAN DATOS (corrección del 23 sep 2026, validada en Docker, y de nuevo en
# el ensayo de TEST-024 del 3 oct 2026 con las 29 migraciones): recrear la estructura de "public"
# fallaba por claves foráneas y políticas de post-data, podía cascadear a funciones de otro
# esquema y, con `--no-privileges`, dejaba el ACL por defecto de Supabase (más abierto que
# 0017_grants.sql). El paso 0 garantiza que App_dev tiene las MISMAS migraciones que el volcado,
# así que la estructura, los permisos y las políticas ya son idénticos: se reemplazan datos y
# nunca se toca un GRANT, un REVOKE, una política ni un trigger. Además, en PostgreSQL 17.11:
#   - `pg_restore -t esquema.tabla` no matchea nada: se usa `-n <esquema> -t <tabla>`.
#   - `pg_restore --data-only` sin `--dbname` ni `--file` corta: se usa `-f -`.
#   - Deshabilitar triggers tabla por tabla exige superusuario (en Supabase `postgres` no lo es):
#     cada carga fija `set session_replication_role = replica` en SU PROPIA conexión (supautils lo
#     permite para `postgres`), por la misma tubería que el SQL de `pg_restore -f -`. No se usa
#     PGOPTIONS: el Session pooler puede no reenviar opciones de arranque.
#
# SECUENCIA:
#   0. Antes de tocar nada (si algo falla acá, App_dev queda intacto):
#        a. el volcado trae lo que tiene que traer un respaldo completo (usuarios, migraciones,
#           hook de Auth, triggers sobre auth, políticas de Storage, políticas de public);
#        b. App_dev tiene las mismas migraciones aplicadas que el volcado;
#        c. las columnas de auth.users/auth.identities del volcado existen en App_dev (Supabase
#           actualiza GoTrue por proyecto: un esquema de auth distinto rompería la carga);
#        d. la estructura y los permisos de App_dev son los esperados (scripts/lib/verificar-
#           estructura.sql) y se toma su huella (scripts/lib/huella-permisos.sql).
#   1. Vacía "public" (TRUNCATE ... CASCADE).
#   2. Reemplaza auth.users/auth.identities (DELETE antes del `replica`, para que el ON DELETE
#      CASCADE limpie sesiones y tokens; después carga el volcado con `replica`).
#   3. Carga los datos de "public" (--section=data) con `replica`.
#   4. Verifica: cantidad de filas de CADA tabla contra el volcado, claves foráneas sin huérfanas
#      (que `replica` no comprueba), estructura y permisos otra vez, huella idéntica a la de antes,
#      y una sesión simulada de una persona owner/admin (hook de Auth + RLS) si hay usuarios.
#   5. Limpieza (siempre, por `trap`): vacía "public" y borra los usuarios de auth restaurados, y
#      confirma que quedaron vacíos. Termina con un resumen (y, en GitHub Actions, lo escribe en
#      la pestaña Summary de la corrida: es el insumo del acta de docs/restore-test.md).
#
# NO SE IMPRIME NINGÚN DATO PERSONAL: solo cantidades y nombres de objetos de la base.
#
# ES DESTRUCTIVO, dos veces: reemplaza el contenido de App_dev por el del volcado y después lo
# borra de nuevo. App_dev queda VACÍO a propósito (sin usuarios ni datos de prueba): volver a
# dejarlo utilizable es un paso aparte, scripts/recuperar-app-dev.ts (docs/restore-test.md).
# Tampoco toca Storage: los archivos de avatars/branding de App_dev quedan, aunque sus perfiles
# ya no existan.
#
# Uso:
#   scripts/restore-from-r2.sh --listar
#     Lista las claves del bucket (más recientes primero).
#   scripts/restore-from-r2.sh <clave-del-objeto> restaurar-app-dev
#     Baja <clave>, la descifra y corre la secuencia. El segundo argumento tiene que ser
#     exactamente "restaurar-app-dev" (ADR-015); en una terminal interactiva pide escribirlo de
#     nuevo.
#   scripts/restore-from-r2.sh --ultimo restaurar-app-dev
#     Igual, con el respaldo más reciente de "diarios/".
#   scripts/restore-from-r2.sh --archivo <ruta> restaurar-app-dev
#     Igual, pero con un volcado local (.dump, o .dump.gpg si se define BACKUP_PASSPHRASE) en vez
#     de bajarlo de R2. Sirve para ensayar en una base local (TEST-024) o restaurar a mano.
#   scripts/restore-from-r2.sh --confirmar-vacio
#     Solo informa si "public" y auth.users/auth.identities están vacíos. No toca nada.
#
# Variables de entorno (ninguna se imprime):
#   SUPABASE_DB_URL_DEV    Cadena de conexión de App_dev, Session pooler (IPv4).
#   R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, CLOUDFLARE_ACCOUNT_ID
#                          Solo para --listar, --ultimo y <clave> (bucket es-backups).
#   BACKUP_PASSPHRASE      La frase de cifrado de scripts/backup-to-r2.sh. Sin ella no se puede
#                          descifrar (docs/deployment.md).
#   GITHUB_STEP_SUMMARY    Si existe (GitHub Actions), se le agrega el resumen en Markdown.

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/lib/dependencias-ci.sh"

uso() {
  cat >&2 <<'USO'
Uso:
  scripts/restore-from-r2.sh --listar
  scripts/restore-from-r2.sh <clave-del-objeto> restaurar-app-dev
  scripts/restore-from-r2.sh --ultimo restaurar-app-dev
  scripts/restore-from-r2.sh --archivo <ruta> restaurar-app-dev
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

# psql contra App_dev, siempre con ON_ERROR_STOP. Los argumentos se pasan tal cual.
psql_dev() {
  "$PG_BIN_DIR/psql" "$SUPABASE_DB_URL_DEV" -X -q -v ON_ERROR_STOP=1 "$@"
}

# Cuenta filas totales de "public" (todas las tablas) y de auth.users/auth.identities. Solo
# números: nunca imprime contenido.
contar_filas_app_dev() {
  filas_public="$(psql_dev -A -t -c "
    select coalesce(sum(
      (xpath('/row/c/text()',
        query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text::bigint
    ), 0)
    from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE';
  ")"
  filas_auth_users="$(psql_dev -A -t -c "select count(*) from auth.users;")"
  filas_auth_identities="$(psql_dev -A -t -c "select count(*) from auth.identities;")"
}

# Vacía TODAS las tablas de "public" (TRUNCATE ... CASCADE, en su propia transacción). TRUNCATE no
# dispara triggers por fila y CASCADE se ocupa de las dependientes. Se usa en el paso 1 y en la
# limpieza del paso 5.
vaciar_public() {
  psql_dev -f - <<'SQL'
begin;
set local client_min_messages = warning;
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
    echo "ADVERTENCIA: App_dev no quedó vacío. dev. no es seguro mientras esto no se resuelva: revisar a mano (docs/restore-test.md, sección de problemas)." >&2
    resumen_vacio="NO quedó vacío (public: ${filas_public}, auth.users: ${filas_auth_users}, auth.identities: ${filas_auth_identities})"
    if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
      printf '\n### Confirmación independiente de App_dev vacío\n\nFALLA: %s\n' "$resumen_vacio" >>"$GITHUB_STEP_SUMMARY"
    fi
    exit 1
  fi
  echo "OK: App_dev quedó vacío."
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    printf '\n### Confirmación independiente de App_dev vacío\n\nOK: public, auth.users y auth.identities con 0 filas.\n' >>"$GITHUB_STEP_SUMMARY"
  fi
  exit 0
fi

# ---- Restauración -------------------------------------------------------------------------------
origen="${1:-}"
archivo_local=""
if [ "$origen" = "--archivo" ]; then
  archivo_local="${2:-}"
  confirmacion="${3:-}"
  if [ -z "$archivo_local" ] || [ ! -f "$archivo_local" ]; then
    echo "No existe el archivo '${archivo_local}'." >&2
    uso
    exit 1
  fi
  object_key="archivo local: $(basename "$archivo_local")"
else
  object_key="$origen"
  confirmacion="${2:-}"
fi

if [ -z "$origen" ] || [ "$confirmacion" != "restaurar-app-dev" ]; then
  uso
  exit 1
fi

if [ -n "$archivo_local" ]; then
  requerir_vars SUPABASE_DB_URL_DEV
  case "$archivo_local" in *.gpg) requerir_vars BACKUP_PASSPHRASE ;; esac
else
  requerir_vars SUPABASE_DB_URL_DEV R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET \
    CLOUDFLARE_ACCOUNT_ID BACKUP_PASSPHRASE
fi

if [ "$origen" = "--ultimo" ]; then
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
if [ -z "$archivo_local" ]; then
  asegurar_aws_cli
  configurar_credenciales_r2
fi

workdir="$(mktemp -d)"
resumen_tsv="$workdir/resumen.tsv"
tiempos_tsv="$workdir/tiempos.tsv"
: >"$resumen_tsv"
: >"$tiempos_tsv"
restauracion_iniciada=false
hubo_fallas=false
inicio_total=$SECONDS
etapa_nombre=""
etapa_inicio=0

# --- Resumen y tiempos (insumo del acta de docs/restore-test.md) ---------------------------------

# registrar <comprobación> <OK|FALLA|OMITIDA|INFO> <detalle>
registrar() {
  printf '%s\t%s\t%s\n' "$1" "$2" "$3" >>"$resumen_tsv"
  if [ "$2" = "FALLA" ]; then
    hubo_fallas=true
  fi
}

# etapa <nombre>: cierra la etapa anterior (si había) y abre la siguiente, midiendo segundos.
etapa() {
  if [ -n "$etapa_nombre" ]; then
    printf '%s\t%s\n' "$etapa_nombre" "$((SECONDS - etapa_inicio))" >>"$tiempos_tsv"
  fi
  etapa_nombre="${1:-}"
  etapa_inicio=$SECONDS
}

imprimir_resumen() {
  etapa ""
  echo ""
  echo "================ RESUMEN DE LA PRUEBA DE RESTAURACIÓN ================"
  echo "Respaldo: ${object_key}"
  echo "Tiempo total: $((SECONDS - inicio_total)) s"
  echo ""
  echo "Tiempos por etapa:"
  while IFS=$'\t' read -r nombre seg; do
    printf '  %-58s %5s s\n' "$nombre" "$seg"
  done <"$tiempos_tsv"
  echo ""
  echo "Resultado de cada comprobación:"
  while IFS=$'\t' read -r nombre estado detalle; do
    printf '  [%s] %s: %s\n' "$estado" "$nombre" "$detalle"
  done <"$resumen_tsv"
  echo "======================================================================"

  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    {
      echo "## Prueba de restauración (TEST-024)"
      echo ""
      echo "- **Respaldo restaurado:** \`${object_key}\`"
      echo "- **Tiempo total:** $((SECONDS - inicio_total)) s"
      echo ""
      echo "| Etapa | Segundos |"
      echo "| --- | ---: |"
      while IFS=$'\t' read -r nombre seg; do
        echo "| ${nombre} | ${seg} |"
      done <"$tiempos_tsv"
      echo ""
      echo "| Comprobación | Estado | Detalle |"
      echo "| --- | --- | --- |"
      while IFS=$'\t' read -r nombre estado detalle; do
        echo "| ${nombre} | ${estado} | ${detalle//|/\\|} |"
      done <"$resumen_tsv"
    } >>"$GITHUB_STEP_SUMMARY"
  fi
}

# correr_sql_de_verificacion <archivo.sql> <prefijo> [agrupar]: corre un archivo de scripts/lib/ que
# imprime `comprobación|estado|detalle`, muestra cada línea y la registra. Con "agrupar", las que
# dan OK se registran como una sola línea de resumen (las FALLA y OMITIDA siempre van aparte).
# Devuelve 1 si hubo alguna FALLA.
correr_sql_de_verificacion() {
  local archivo="$1" prefijo="$2" agrupar="${3:-}" salida rc=0 n_ok=0
  # Dentro de una función llamada con `if` o `||`, `set -e` no corta: hay que mirar el código de
  # salida de psql a mano, o un error de SQL pasaría por una verificación sin fallas.
  if ! salida="$(psql_dev -A -t -F '|' -f "$script_dir/lib/$archivo")"; then
    echo "  [FALLA] ${prefijo}${archivo}: psql terminó con error (ver el mensaje de arriba)" >&2
    registrar "${prefijo}${archivo}" "FALLA" "psql terminó con error al correr ${archivo}"
    return 1
  fi
  if [ -z "$salida" ]; then
    echo "  [FALLA] ${prefijo}${archivo}: no devolvió ninguna comprobación" >&2
    registrar "${prefijo}${archivo}" "FALLA" "${archivo} no devolvió ninguna comprobación"
    return 1
  fi
  while IFS='|' read -r comprobacion estado detalle; do
    [ -z "$comprobacion" ] && continue
    echo "  [${estado}] ${prefijo}${comprobacion}: ${detalle}"
    if [ -n "$agrupar" ] && [ "$estado" = "OK" ]; then
      n_ok=$((n_ok + 1))
    else
      registrar "${prefijo}${comprobacion}" "$estado" "$detalle"
    fi
    if [ "$estado" = "FALLA" ]; then
      rc=1
    fi
  done <<<"$salida"
  if [ -n "$agrupar" ] && [ "$n_ok" -gt 0 ]; then
    registrar "${prefijo}${agrupar}" "OK" "${n_ok} comprobaciones OK"
  fi
  return "$rc"
}

# --- Limpieza (siempre) -----------------------------------------------------------------------------

limpiar_app_dev() {
  local rc=$?
  if [ "$restauracion_iniciada" = true ]; then
    etapa "Limpieza de App_dev"
    echo ""
    echo "Limpiando App_dev (dejando public y los usuarios de auth restaurados vacíos -- siempre" \
      "corre esto, haya salido bien o mal lo de arriba)..."
    if vaciar_public && psql_dev -c "
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
        echo "ADVERTENCIA: la limpieza corrió pero App_dev no quedó vacío. dev. NO es seguro: revisar a mano ya mismo (docs/restore-test.md, sección de problemas)." >&2
        registrar "limpieza_app_dev_vacio" "FALLA" "public: ${filas_public}, auth.users: ${filas_auth_users}, auth.identities: ${filas_auth_identities}"
        rc=1
      else
        echo "OK: App_dev quedó vacío."
        registrar "limpieza_app_dev_vacio" "OK" "public, auth.users y auth.identities con 0 filas"
      fi
    else
      echo "ADVERTENCIA: la limpieza automática de App_dev encontró un error. dev. puede NO ser seguro: revisar a mano ya mismo, y correr 'scripts/restore-from-r2.sh --confirmar-vacio' (docs/restore-test.md, sección de problemas)." >&2
      registrar "limpieza_app_dev_vacio" "FALLA" "la limpieza automática terminó con error"
      rc=1
    fi
  fi
  if [ "$rc" != "0" ]; then
    registrar "resultado_general" "FALLA" "la corrida terminó con error (código ${rc})"
  elif [ "$hubo_fallas" = true ]; then
    registrar "resultado_general" "FALLA" "alguna comprobación falló"
    rc=1
  else
    registrar "resultado_general" "OK" "todas las comprobaciones pasaron"
  fi
  imprimir_resumen
  rm -rf "$workdir"
  exit "$rc"
}
trap limpiar_app_dev EXIT

# --- Obtener el volcado -----------------------------------------------------------------------------

dump_file="$workdir/respaldo.dump"

if [ -n "$archivo_local" ]; then
  etapa "Descifrar o tomar el volcado local"
  case "$archivo_local" in
    *.gpg)
      echo "Descifrando ${archivo_local} (gpg)..."
      printf '%s' "$BACKUP_PASSPHRASE" | gpg --batch --yes --pinentry-mode loopback \
        --passphrase-fd 0 --decrypt --output "$dump_file" "$archivo_local"
      ;;
    *)
      dump_file="$archivo_local"
      ;;
  esac
else
  encrypted_file="$workdir/respaldo.dump.gpg"
  etapa "Bajar el respaldo de R2"
  echo "Bajando ${object_key} de R2 (bucket ${R2_BUCKET})..."
  aws s3 cp "s3://${R2_BUCKET}/${object_key}" "$encrypted_file" \
    --endpoint-url "$endpoint" --only-show-errors

  etapa "Descifrar el volcado"
  echo "Descifrando el volcado (gpg)..."
  printf '%s' "$BACKUP_PASSPHRASE" | gpg --batch --yes --pinentry-mode loopback \
    --passphrase-fd 0 --decrypt --output "$dump_file" "$encrypted_file"
  rm -f "$encrypted_file" # el volcado cifrado ya no hace falta en disco
fi
tam_volcado="$(wc -c <"$dump_file" | tr -d ' ')"
registrar "volcado_descifrado" "OK" "${tam_volcado} bytes"

# --- Paso 0: comprobaciones previas (no tocan nada) -----------------------------------------------------

etapa "Paso 0: comprobaciones previas"
echo ""
echo "0a. Contenido del volcado (¿es un respaldo completo?)..."
lista_volcado="$workdir/volcado.toc"
"$PG_BIN_DIR/pg_restore" -l "$dump_file" >"$lista_volcado"

requerir_en_volcado() { # <descripción> <patrón extendido>
  if grep -qE "$2" "$lista_volcado"; then
    echo "  [OK] El volcado trae: $1"
    elementos_ok=$((elementos_ok + 1))
  else
    echo "  [FALLA] El volcado NO trae: $1" >&2
    registrar "volcado_trae_$1" "FALLA" "falta en el volcado"
    contenido_incompleto=true
  fi
}
contenido_incompleto=false
elementos_ok=0
requerir_en_volcado "datos de auth.users" '^[0-9]+; [0-9]+ [0-9]+ TABLE DATA auth users '
requerir_en_volcado "datos de auth.identities" '^[0-9]+; [0-9]+ [0-9]+ TABLE DATA auth identities '
requerir_en_volcado "migraciones aplicadas" '^[0-9]+; [0-9]+ [0-9]+ TABLE DATA supabase_migrations schema_migrations '
requerir_en_volcado "hook de Auth" '^[0-9]+; [0-9]+ [0-9]+ FUNCTION app custom_access_token_hook\('
requerir_en_volcado "trigger de perfiles sobre auth.users" ' TRIGGER auth users trg_handle_new_user '
requerir_en_volcado "trigger de ingresos sobre auth.sessions" ' TRIGGER auth sessions trg_log_sign_in '
requerir_en_volcado "buckets de Storage (datos)" '^[0-9]+; [0-9]+ [0-9]+ TABLE DATA storage buckets '
for politica in avatars_select_own_or_admin avatars_insert_own_or_admin avatars_update_own_or_admin \
  avatars_delete_own_or_admin branding_select_public branding_write_admin; do
  requerir_en_volcado "política de Storage ${politica}" " POLICY storage objects ${politica} "
done
if [ "$contenido_incompleto" = true ]; then
  echo "ABORTADO: el volcado no es un respaldo completo. No se toca App_dev." >&2
  exit 1
fi
registrar "volcado_es_un_respaldo_completo" "OK" "${elementos_ok} elementos esperados presentes (usuarios, migraciones, hook, triggers de auth, buckets y políticas de Storage)"

politicas_volcado="$(grep -cE '^[0-9]+; [0-9]+ [0-9]+ POLICY public ' "$lista_volcado" || true)"
politicas_app_dev="$(psql_dev -A -t -c "select count(*) from pg_policies where schemaname = 'public';")"
if [ "$politicas_volcado" = "$politicas_app_dev" ] && [ "$politicas_volcado" != "0" ]; then
  echo "  [OK] Políticas RLS de public: ${politicas_volcado} en el volcado y en App_dev"
  registrar "politicas_rls_public_volcado_vs_app_dev" "OK" "${politicas_volcado} y ${politicas_app_dev}"
else
  echo "  [FALLA] Políticas RLS de public: ${politicas_volcado} en el volcado, ${politicas_app_dev} en App_dev" >&2
  registrar "politicas_rls_public_volcado_vs_app_dev" "FALLA" "${politicas_volcado} en el volcado, ${politicas_app_dev} en App_dev"
  echo "ABORTADO: el volcado y App_dev no tienen las mismas políticas. No se toca App_dev." >&2
  exit 1
fi

echo ""
echo "0b. Migraciones (supabase_migrations.schema_migrations): volcado contra App_dev..."
# "version" es la clave primaria de esta tabla de control de Supabase CLI: se busca su posición
# en la lista de columnas del propio COPY en vez de asumir que es la primera. No toca ninguna
# base: pg_restore con -f - solo imprime el SQL.
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

versiones_app_dev="$(psql_dev -A -t -c \
  "select version from supabase_migrations.schema_migrations order by version;" | sort)"

if [ "$versiones_volcado" != "$versiones_app_dev" ]; then
  echo "ABORTADO: App_dev no está en la misma versión de migraciones que el volcado. No se toca nada." >&2
  echo "Versiones en el volcado:" >&2
  echo "$versiones_volcado" >&2
  echo "Versiones en App_dev:" >&2
  echo "$versiones_app_dev" >&2
  echo "Corré 'pnpm db:push' contra App_dev (o esperá a que deploy-staging.yml lo haga) y reintentá." >&2
  registrar "migraciones_volcado_vs_app_dev" "FALLA" "no coinciden"
  exit 1
fi
cantidad_migraciones="$(printf '%s\n' "$versiones_app_dev" | wc -l | tr -d ' ')"
ultima_migracion="$(printf '%s\n' "$versiones_app_dev" | tail -n 1)"
echo "  [OK] App_dev tiene las mismas ${cantidad_migraciones} migraciones que el volcado (la última, ${ultima_migracion})."
registrar "migraciones_volcado_vs_app_dev" "OK" "${cantidad_migraciones} migraciones iguales, la última ${ultima_migracion}"

echo ""
echo "0c. Columnas de auth.users y auth.identities: volcado contra App_dev..."
for tabla in users identities; do
  columnas_volcado="$("$PG_BIN_DIR/pg_restore" --data-only -n auth -t "$tabla" -f - "$dump_file" \
    | sed -n "s/^COPY auth\.${tabla} (\(.*\)) FROM stdin;\$/\1/p" | tr ',' '\n' | tr -d ' "' | sort)"
  columnas_app_dev="$(psql_dev -A -t -c "select column_name from information_schema.columns
      where table_schema = 'auth' and table_name = '${tabla}' and is_generated = 'NEVER' order by 1;" | sort)"
  if [ -z "$columnas_volcado" ]; then
    echo "ABORTADO: no se pudieron leer las columnas de auth.${tabla} del volcado. No se toca App_dev." >&2
    registrar "columnas_auth_${tabla}" "FALLA" "no se pudieron leer del volcado"
    exit 1
  fi
  faltan_en_app_dev="$(comm -23 <(printf '%s\n' "$columnas_volcado") <(printf '%s\n' "$columnas_app_dev") | paste -sd, -)"
  sobran_en_app_dev="$(comm -13 <(printf '%s\n' "$columnas_volcado") <(printf '%s\n' "$columnas_app_dev") | paste -sd, -)"
  if [ -n "$faltan_en_app_dev" ]; then
    echo "ABORTADO: auth.${tabla} de App_dev no tiene estas columnas del volcado: ${faltan_en_app_dev}. Supabase actualizó el servicio de Auth en un proyecto y en el otro no. No se toca App_dev." >&2
    registrar "columnas_auth_${tabla}" "FALLA" "faltan en App_dev: ${faltan_en_app_dev}"
    exit 1
  fi
  if [ -n "$sobran_en_app_dev" ]; then
    echo "  [OK] auth.${tabla}: todas las columnas del volcado existen en App_dev (App_dev tiene además: ${sobran_en_app_dev}, quedan con su valor por defecto)"
    registrar "columnas_auth_${tabla}" "OK" "todas existen; App_dev tiene además ${sobran_en_app_dev}"
  else
    echo "  [OK] auth.${tabla}: las columnas del volcado y las de App_dev coinciden"
    registrar "columnas_auth_${tabla}" "OK" "coinciden"
  fi
done

echo ""
echo "0d. Estructura y permisos de App_dev antes de restaurar..."
if ! correr_sql_de_verificacion verificar-estructura.sql "antes_" "estructura_y_permisos"; then
  echo "ABORTADO: App_dev no tiene la estructura o los permisos esperados (ver [FALLA] arriba). No se toca nada." >&2
  exit 1
fi
huella_antes="$(psql_dev -A -t -F '|' -f "$script_dir/lib/huella-permisos.sql")"
echo "  Huella de permisos tomada: $(printf '%s\n' "$huella_antes" | wc -l | tr -d ' ') componentes."

restauracion_iniciada=true

# --- Pasos 1 a 3: reemplazar los datos -----------------------------------------------------------------

etapa "Paso 1: vaciar public"
echo ""
echo "1/3 - Vaciando public, por si App_dev tenía datos de antes..."
vaciar_public

etapa "Paso 2: reemplazar auth.users y auth.identities"
echo ""
echo "2/3 - Reemplazando los usuarios de auth (auth.users, auth.identities), con" \
  "session_replication_role = replica fijado en esta misma conexión (así el trigger que crea" \
  "profiles al insertar en auth.users no se dispara, y el orden entre auth.users y" \
  "auth.identities deja de importar)..."
# Todo el SQL de este paso (los DELETE, el SET y el contenido que genera pg_restore -f -) va por
# una sola tubería a un único psql: session_replication_role vale por conexión. Los DELETE van
# ANTES del SET, a propósito: con `replica` tampoco se disparan los ON DELETE CASCADE, y borrar
# auth.users así dejaría huérfanas las filas de auth.sessions, auth.refresh_tokens,
# auth.mfa_factors y demás.
{
  printf 'delete from auth.identities;\n'
  printf 'delete from auth.users;\n'
  printf 'set session_replication_role = replica;\n'
  "$PG_BIN_DIR/pg_restore" --data-only -n auth -t users --no-owner --no-privileges -f - "$dump_file"
  "$PG_BIN_DIR/pg_restore" --data-only -n auth -t identities --no-owner --no-privileges -f - "$dump_file"
} | psql_dev -o /dev/null --single-transaction -f -

etapa "Paso 3: cargar los datos de public"
echo ""
echo "3/3 - Cargando los datos de public (--section=data), también con session_replication_role" \
  "= replica fijado en esta conexión: ni los triggers de usuario ni los internos de las claves" \
  "foráneas se disparan, así que el orden de carga entre tablas no importa..."
{
  printf 'set session_replication_role = replica;\n'
  "$PG_BIN_DIR/pg_restore" --schema=public --data-only --no-owner --no-privileges \
    --section=data -f - "$dump_file"
} | psql_dev -o /dev/null --single-transaction -f -

# --- Paso 4: verificación ---------------------------------------------------------------------------------

etapa "Paso 4: verificación"
echo ""
echo "Restauración completa. Verificando (solo cantidades y nombres de objetos, nunca contenido)..."

echo ""
echo "4a. Filas por tabla: volcado contra App_dev (tienen que ser idénticas)..."
filas_volcado="$workdir/filas_volcado.tsv"
filas_app_dev="$workdir/filas_app_dev.tsv"
{
  "$PG_BIN_DIR/pg_restore" --data-only --schema=public -f - "$dump_file"
  "$PG_BIN_DIR/pg_restore" --data-only -n auth -t users -f - "$dump_file"
  "$PG_BIN_DIR/pg_restore" --data-only -n auth -t identities -f - "$dump_file"
} | awk '
    /^COPY / { tabla = $2; n[tabla] = 0; dentro = 1; next }
    /^\\\.$/ { dentro = 0; next }
    dentro { n[tabla]++ }
    END { for (t in n) printf "%s\t%d\n", t, n[t] }
  ' | LC_ALL=C sort >"$filas_volcado"
psql_dev -A -t -F $'\t' -c "
  select table_schema || '.' || table_name,
         (xpath('/row/c/text()',
           query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
  from information_schema.tables
  where (table_schema = 'public' and table_type = 'BASE TABLE')
     or (table_schema = 'auth' and table_name in ('users', 'identities'));
" | LC_ALL=C sort >"$filas_app_dev"

tablas_volcado="$(wc -l <"$filas_volcado" | tr -d ' ')"
tablas_app_dev="$(wc -l <"$filas_app_dev" | tr -d ' ')"
echo "  Tablas con datos en el volcado (public + auth.users + auth.identities): ${tablas_volcado}"
echo "  Tablas en App_dev:                                                      ${tablas_app_dev}"
printf '  %-42s %10s %10s\n' "tabla" "volcado" "App_dev"
LC_ALL=C join -a1 -a2 -e FALTA -t $'\t' -o 0,1.2,2.2 "$filas_volcado" "$filas_app_dev" \
  | while IFS=$'\t' read -r tabla en_volcado en_app_dev; do
      marca=""
      [ "$en_volcado" != "$en_app_dev" ] && marca="   <-- NO COINCIDE"
      printf '  %-42s %10s %10s%s\n' "$tabla" "$en_volcado" "$en_app_dev" "$marca"
    done
if diff -q "$filas_volcado" "$filas_app_dev" >/dev/null; then
  total_filas="$(awk -F'\t' '{ s += $2 } END { print s + 0 }' "$filas_app_dev")"
  echo "  [OK] Las ${tablas_app_dev} tablas tienen exactamente las mismas filas que el volcado (${total_filas} filas en total)."
  registrar "filas_por_tabla_volcado_vs_app_dev" "OK" "${tablas_app_dev} tablas idénticas, ${total_filas} filas en total"
else
  echo "  [FALLA] Hay tablas cuyas filas no coinciden con el volcado (ver la columna marcada arriba)." >&2
  registrar "filas_por_tabla_volcado_vs_app_dev" "FALLA" "hay tablas con cantidades distintas (ver el log)"
fi
registrar "usuarios_de_auth_restaurados" "INFO" "auth.users: $(awk -F'\t' '$1 == "auth.users" { print $2 }' "$filas_app_dev"), auth.identities: $(awk -F'\t' '$1 == "auth.identities" { print $2 }' "$filas_app_dev")"

echo ""
echo "4b. Integridad referencial y sesión simulada (claves foráneas sin huérfanas; hook de Auth y RLS)..."
correr_sql_de_verificacion verificar-datos.sql "" || true

echo ""
echo "4c. Estructura y permisos otra vez, y huella de permisos contra la de antes de restaurar..."
correr_sql_de_verificacion verificar-estructura.sql "despues_" "estructura_y_permisos" || true
huella_despues="$(psql_dev -A -t -F '|' -f "$script_dir/lib/huella-permisos.sql")"
if [ "$huella_antes" = "$huella_despues" ]; then
  echo "  [OK] La huella de permisos (tablas, columnas, funciones, esquemas, privilegios por defecto, políticas y triggers) es idéntica a la de antes de restaurar."
  registrar "huella_de_permisos_igual_a_la_de_antes" "OK" "7 componentes idénticos"
else
  distintos="$(diff <(printf '%s\n' "$huella_antes") <(printf '%s\n' "$huella_despues") | sed -n 's/^> \([^|]*\)|.*/\1/p' | paste -sd, -)"
  echo "  [FALLA] La huella de permisos cambió después de restaurar. Componentes distintos: ${distintos}" >&2
  registrar "huella_de_permisos_igual_a_la_de_antes" "FALLA" "cambió: ${distintos}"
fi

etapa ""
echo ""
if [ "$hubo_fallas" = true ]; then
  echo "VERIFICACION FALLIDA: alguna comprobación dio [FALLA] (ver arriba). Limpiando a continuación." >&2
  exit 1
fi
echo "Restauración y verificación completas: ${object_key} -> App_dev. Limpiando a continuación" \
  "(ver más abajo): esto no debe interpretarse como que App_dev quedó con estos datos."
