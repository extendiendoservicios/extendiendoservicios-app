#!/usr/bin/env bash
set -euo pipefail

# scripts/db-test.sh — DB-022 (08_Fases_y_Backlog.md, F4): corre los tests pgTAP de
# supabase/tests/*.sql con `supabase test db`, la subcomanda de la CLI que monta esa carpeta en
# un contenedor y ejecuta pg_prove adentro (Docker como herramienta de pruebas, ADR-023;
# ADR-014: sin Supabase local, App_dev es el único Postgres real).
#
# Dos modos, según de dónde se invoque (mismo runner para los dos):
#   - Local (`pnpm db:test`): contra el proyecto vinculado, con --linked. Requiere Docker
#     Desktop prendido (`docker version` tiene que responder) y `supabase link` ya hecho
#     (docs/environments.md). Si Docker no responde, la CLI de Supabase falla sola con un
#     mensaje claro; este script no intenta ningún otro camino (ADR-023).
#   - CI (variable de entorno SUPABASE_DB_URL_DEV presente, ver .github/workflows/ci.yml):
#     con --db-url, sin necesidad de vincular el proyecto en el runner. Los runners de GitHub
#     Actions ya traen Docker.
#
# App_dev también sirve de staging (ADR-014): ningún archivo de supabase/tests puede dejar
# cambios. Este script no hace limpieza porque no la necesita: la convención (documentada en
# supabase/tests/README.md) es que cada archivo abre su propia transacción y termina en
# `rollback`, incluida la creación de la extensión pgtap con `create extension if not exists`.

if [ -n "${SUPABASE_DB_URL_DEV:-}" ]; then
  echo "db:test — CI: corriendo contra SUPABASE_DB_URL_DEV."
  exec supabase test db --db-url "$SUPABASE_DB_URL_DEV"
fi

echo "db:test — local: corriendo contra el proyecto vinculado (--linked)."
exec supabase test db --linked
