#!/usr/bin/env bash
set -euo pipefail

# scripts/restore-from-r2.sh — INFRA-018/INFRA-024 (ADR-015, TEST-024): baja un respaldo de R2,
# lo descifra, lo restaura en App_dev y verifica el resultado. Lo usa
# .github/workflows/restore-test.yml (workflow_dispatch, todavía sin correr: se dispara recién
# cuando App tenga las tablas de F4, ver docs/deployment.md sección 6.3) y sirve también para una
# restauración manual siguiendo el paso a paso de ese mismo documento.
#
# SOLO App_dev. Este script no lee SUPABASE_DB_URL_PROD en ningún lado: estructuralmente no
# puede apuntar a App (producción) por accidente ni por variable mal cargada. Restaurar
# producción es un procedimiento manual y excepcional aparte (docs/runbook-produccion.md, F20),
# nunca este script.
#
# ALCANCE: solo el esquema "public" (--schema=public en el pg_restore de abajo), que es lo único
# que crean las migraciones propias y lo único de lo que el rol de conexión es dueño. No toca
# auth, storage, extensions ni ningún otro esquema administrado por Supabase: --clean fallaría
# ahí, porque ese rol no es su dueño. Consecuencia pendiente de una decisión de Mike (ver el
# reporte de P03.7): si alguna tabla de "public" (por ejemplo profiles) termina con una clave
# foránea hacia auth.users(id) -- el patrón habitual de Supabase -- y App_dev no tiene esos
# mismos usuarios, esta restauración puede fallar en el paso de datos por violación de esa
# restricción. Es un resultado esperado y visible (el job falla con un error claro), no datos
# corrompidos en silencio; no se lo fuerza con --disable-triggers porque ese flag exige
# superusuario, privilegio que el rol de conexión de Supabase no tiene.
#
# ES DESTRUCTIVO: pg_restore corre con --clean --if-exists, así que borra y recrea todo lo que
# ya exista en el esquema public de App_dev antes de restaurar el contenido del volcado. Nunca
# correr esto contra una base que tenga algo que no se pueda perder.
#
# Uso:
#   scripts/restore-from-r2.sh --listar
#     Lista las claves disponibles en el bucket es-backups (más recientes primero), para elegir
#     cuál restaurar.
#
#   scripts/restore-from-r2.sh <clave-del-objeto> restaurar-app-dev
#     Por ejemplo: scripts/restore-from-r2.sh diarios/App_20260101_030000.dump.gpg restaurar-app-dev
#     Baja <clave-del-objeto>, la descifra y la restaura en App_dev. El segundo argumento tiene
#     que ser exactamente la palabra "restaurar-app-dev": es la confirmación explícita que exige
#     ADR-015 antes de un paso destructivo. Si la entrada estándar es una terminal interactiva,
#     además pide escribir la misma palabra una segunda vez antes de tocar nada.
#
#   scripts/restore-from-r2.sh --ultimo restaurar-app-dev
#     Igual que arriba, pero en vez de indicar una clave elige sola el respaldo más reciente con
#     prefijo "diarios/". La usa restore-test.yml cuando no se indica el input "objeto_r2".
#
# Variables de entorno requeridas (ninguna se imprime en ningún momento):
#   SUPABASE_DB_URL_DEV    Cadena de conexión de App_dev, Session pooler (IPv4).
#   R2_ACCESS_KEY_ID       Access key S3 del token de R2 con permisos sobre R2_BUCKET.
#   R2_SECRET_ACCESS_KEY   Secret key S3 del mismo token.
#   R2_BUCKET              Nombre del bucket privado de respaldos (es-backups).
#   CLOUDFLARE_ACCOUNT_ID  Id de cuenta de Cloudflare: arma el endpoint S3 de R2.
#   BACKUP_PASSPHRASE      La misma frase de cifrado que usó scripts/backup-to-r2.sh para este
#                          respaldo. Sin ella no se puede descifrar (docs/deployment.md).

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/dependencias-ci.sh"

uso() {
  cat >&2 <<'USO'
Uso:
  scripts/restore-from-r2.sh --listar
  scripts/restore-from-r2.sh <clave-del-objeto> restaurar-app-dev
  scripts/restore-from-r2.sh --ultimo restaurar-app-dev
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
  echo "Esto va a BORRAR y reemplazar todo lo que hoy tenga App_dev con el contenido de:"
  echo "  ${object_key}"
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
trap 'rm -rf "$workdir"' EXIT

encrypted_file="$workdir/respaldo.dump.gpg"
dump_file="$workdir/respaldo.dump"

echo "Bajando ${object_key} de R2 (bucket ${R2_BUCKET})..."
aws s3 cp "s3://${R2_BUCKET}/${object_key}" "$encrypted_file" \
  --endpoint-url "$endpoint" --only-show-errors

echo "Descifrando el volcado (gpg)..."
printf '%s' "$BACKUP_PASSPHRASE" | gpg --batch --yes --pinentry-mode loopback \
  --passphrase-fd 0 --decrypt --output "$dump_file" "$encrypted_file"
rm -f "$encrypted_file" # el volcado cifrado ya no hace falta en disco

echo "Restaurando en App_dev (esquema public) con pg_restore --clean --if-exists..."
"$PG_BIN_DIR/pg_restore" --schema=public --clean --if-exists --no-owner --no-privileges \
  --exit-on-error --dbname "$SUPABASE_DB_URL_DEV" "$dump_file"

echo ""
echo "Verificando la restauración: tablas listadas en el volcado (esquema public) vs. tablas"
echo "que quedaron en App_dev..."

tablas_volcado="$("$PG_BIN_DIR/pg_restore" --schema=public -l "$dump_file" \
  | grep -cE '^[0-9]+; [0-9]+ [0-9]+ TABLE public ' || true)"
tablas_app_dev="$("$PG_BIN_DIR/psql" "$SUPABASE_DB_URL_DEV" -X -q -A -t -c \
  "select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE';")"

echo "  Tablas en el volcado (pg_restore -l, esquema public): ${tablas_volcado}"
echo "  Tablas en App_dev (esquema public):                   ${tablas_app_dev}"

if [ "$tablas_volcado" != "$tablas_app_dev" ]; then
  echo "VERIFICACION FALLIDA: la cantidad de tablas restauradas no coincide con la del volcado." >&2
  exit 1
fi
echo "Verificación OK: coincide la cantidad de tablas (${tablas_app_dev})."

echo ""
echo "Filas por tabla en App_dev (esquema public), para revisión manual:"
"$PG_BIN_DIR/psql" "$SUPABASE_DB_URL_DEV" -X -q -A -t -c \
  "select table_name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'
     order by table_name;" \
  | while IFS= read -r tabla; do
      [ -z "$tabla" ] && continue
      filas="$("$PG_BIN_DIR/psql" "$SUPABASE_DB_URL_DEV" -X -q -A -t -c \
        "select count(*) from public.\"${tabla}\";")"
      echo "  ${tabla}: ${filas} filas"
    done

echo ""
echo "Restauración completa: ${object_key} -> App_dev (esquema public)."
