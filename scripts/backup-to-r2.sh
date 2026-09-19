#!/usr/bin/env bash
set -euo pipefail

# scripts/backup-to-r2.sh — INFRA-018 (ADR-015): respaldo diario cifrado de App (producción) a
# Cloudflare R2.
#
# Reutilizado por:
#   - .github/workflows/backup.yml (cron diario 03:00 Argentina / 06:00 UTC)
#   - .github/workflows/deploy-production.yml (volcado previo obligatorio antes de cualquier
#     migración en producción, ADR-015: nunca migrar App sin un respaldo fresco)
#
# Variables de entorno requeridas (ninguna se imprime en ningún momento):
#   SUPABASE_DB_URL_PROD   Cadena de conexión de App (producción), Session pooler (IPv4).
#   R2_ACCESS_KEY_ID       Access key S3 del token de R2 con permisos sobre R2_BUCKET.
#   R2_SECRET_ACCESS_KEY   Secret key S3 del mismo token.
#   R2_BUCKET              Nombre del bucket privado de respaldos (es-backups).
#   CLOUDFLARE_ACCOUNT_ID  Id de cuenta de Cloudflare: arma el endpoint S3 de R2.
#   BACKUP_PASSPHRASE      Frase de cifrado simétrico (gpg, AES256). Sin ella ningún respaldo se
#                          puede descifrar: se guarda también fuera de GitHub (docs/deployment.md).
#
# Qué hace: pg_dump --format=custom -> cifra con gpg (AES256 simétrico) -> sube el archivo
# cifrado a R2 por su API S3. El volcado sin cifrar nunca toca el disco más que en un directorio
# temporal que se borra al salir (`trap`), y nunca se sube.
#
# Nombre y prefijo (retención de ADR-015, reglas de ciclo de vida del bucket es-backups):
#   diarios/App_<fecha_hora_argentina>.dump.gpg    todos los días salvo el 1º de cada mes
#   mensuales/App_<fecha_hora_argentina>.dump.gpg  el 1º de cada mes
# El bucket expira solo los objetos de "diarios/" a los 30 días y los de "mensuales/" a los
# ~12 meses (370 días): no hace falta que este script borre nada.

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/dependencias-ci.sh"

required_vars=(
  SUPABASE_DB_URL_PROD
  R2_ACCESS_KEY_ID
  R2_SECRET_ACCESS_KEY
  R2_BUCKET
  CLOUDFLARE_ACCOUNT_ID
  BACKUP_PASSPHRASE
)
for var in "${required_vars[@]}"; do
  if [ -z "${!var:-}" ]; then
    echo "Falta la variable de entorno $var. Ver docs/deployment.md / docs/environments.md." >&2
    exit 1
  fi
done

asegurar_pg17
asegurar_aws_cli

timestamp="$(TZ=America/Argentina/Buenos_Aires date +%Y%m%d_%H%M%S)"
dia_del_mes="$(TZ=America/Argentina/Buenos_Aires date +%d)"

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

dump_file="$workdir/App_${timestamp}.dump"
encrypted_file="${dump_file}.gpg"

echo "Generando volcado de App con pg_dump --format=custom..."
"$PG_BIN_DIR/pg_dump" --format=custom --no-owner --no-privileges \
  --file "$dump_file" --dbname "$SUPABASE_DB_URL_PROD"

echo "Cifrando el volcado (gpg, AES256 simétrico)..."
printf '%s' "$BACKUP_PASSPHRASE" | gpg --batch --yes --pinentry-mode loopback \
  --passphrase-fd 0 --cipher-algo AES256 --symmetric \
  --output "$encrypted_file" "$dump_file"
rm -f "$dump_file" # el volcado sin cifrar nunca se sube; ya no hace falta en disco

if [ "$dia_del_mes" = "01" ]; then
  prefijo="mensuales"
else
  prefijo="diarios"
fi
object_key="${prefijo}/App_${timestamp}.dump.gpg"

export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="auto"
endpoint="https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com"

echo "Subiendo ${object_key} a R2 (bucket ${R2_BUCKET})..."
aws s3 cp "$encrypted_file" "s3://${R2_BUCKET}/${object_key}" \
  --endpoint-url "$endpoint" --only-show-errors

echo "Respaldo subido: ${object_key}"
