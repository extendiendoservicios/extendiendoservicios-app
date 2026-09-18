#!/usr/bin/env bash
set -euo pipefail

# scripts/restore-from-r2.sh — INFRA-018 (ADR-015): baja un respaldo de R2, lo descifra y lo
# restaura con pg_restore en App_dev. El paso a paso completo, con las advertencias del caso,
# está en docs/deployment.md ("Restauración de un respaldo"). La prueba real de restauración
# (TEST-024) es un encargo aparte (según el backlog, F18); este script queda listo para esa
# prueba y para cualquier restauración manual futura.
#
# SOLO App_dev. Este script no lee SUPABASE_DB_URL_PROD en ningún lado: estructuralmente no
# puede apuntar a App (producción) por accidente ni por variable mal cargada. Restaurar
# producción es un procedimiento manual y excepcional aparte (docs/runbook-produccion.md, F20),
# nunca este script.
#
# ES DESTRUCTIVO: pg_restore corre con --clean --if-exists, así que borra y recrea todo lo que
# ya exista en App_dev antes de restaurar el contenido del volcado. Nunca correr esto contra una
# base que tenga algo que no se pueda perder.
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

echo "Restaurando en App_dev con pg_restore --clean --if-exists (reemplaza lo que había)..."
"$PG_BIN_DIR/pg_restore" --clean --if-exists --no-owner --no-privileges --exit-on-error \
  --dbname "$SUPABASE_DB_URL_DEV" "$dump_file"

echo "Restauración completa: ${object_key} -> App_dev."
