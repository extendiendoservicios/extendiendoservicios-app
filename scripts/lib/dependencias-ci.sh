#!/usr/bin/env bash
# scripts/lib/dependencias-ci.sh — INFRA-018: instalación perezosa de herramientas que
# necesitan los scripts de respaldo/restauración en el runner de GitHub Actions (Ubuntu).
#
# Se usa con `source`, nunca se ejecuta directo. Asume que el script que lo importa ya declaró
# `set -euo pipefail`. No instala nada en la máquina de un desarrollador: estos scripts corren
# solo en CI (`backup.yml`, el volcado previo de `deploy-production.yml`) o, para la
# restauración, en la sesión de quien la ejecuta a mano siguiendo docs/deployment.md.
#
# Expone:
#   asegurar_pg17     Deja PG_BIN_DIR apuntando a un directorio con pg_dump/pg_restore >= 17.
#                     Los proyectos de Supabase corren Postgres 17.6: un cliente más viejo
#                     falla al volcar o restaurar. Si el runner no lo trae, lo instala desde el
#                     repositorio oficial de PostgreSQL (PGDG), nunca desde un paquete de
#                     terceros.
#   asegurar_aws_cli  Instala la AWS CLI si no está (se usa para hablar con la API S3 de R2).

PG_MIN_MAJOR=17
PG_BIN_DIR=""

_pg17_version_de() {
  "$1" --version 2>/dev/null | grep -oE '[0-9]+' | head -n1
}

_pg17_buscar_binario() {
  if command -v pg_dump >/dev/null 2>&1; then
    local ruta ver
    ruta="$(command -v pg_dump)"
    ver="$(_pg17_version_de "$ruta")"
    if [ -n "$ver" ] && [ "$ver" -ge "$PG_MIN_MAJOR" ]; then
      dirname "$ruta"
      return 0
    fi
  fi
  if [ -x "/usr/lib/postgresql/${PG_MIN_MAJOR}/bin/pg_dump" ]; then
    echo "/usr/lib/postgresql/${PG_MIN_MAJOR}/bin"
    return 0
  fi
  return 1
}

asegurar_pg17() {
  if PG_BIN_DIR="$(_pg17_buscar_binario)"; then
    echo "Cliente de PostgreSQL >= ${PG_MIN_MAJOR} encontrado en ${PG_BIN_DIR}."
    return 0
  fi
  echo "Cliente de PostgreSQL >= ${PG_MIN_MAJOR} no encontrado: instalando desde PGDG..."
  sudo install -d -m 0755 /usr/share/postgresql-common/pgdg
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
  # shellcheck source=/dev/null
  . /etc/os-release
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
    | sudo tee /etc/apt/sources.list.d/pgdg.list >/dev/null
  sudo apt-get update -qq
  sudo apt-get install -y -qq "postgresql-client-${PG_MIN_MAJOR}"
  PG_BIN_DIR="/usr/lib/postgresql/${PG_MIN_MAJOR}/bin"
}

asegurar_aws_cli() {
  if command -v aws >/dev/null 2>&1; then
    return 0
  fi
  echo "AWS CLI no encontrada: instalando (hace falta para hablar con la API S3 de R2)..."
  sudo apt-get update -qq
  sudo apt-get install -y -qq awscli
}
