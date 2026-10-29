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

#
# Única excepción: antes de las pruebas se adelanta employee_number_seq hasta el legajo más alto.
# Desde P26.7 la app asigna el legajo como max + 1 (o el que se carga a mano) y no usa la
# secuencia, que queda atrás; los archivos que dan de alta empleados con el legajo por defecto
# chocaban con legajos reales de App_dev (#257, 29 oct 2026). setval solo adelanta el contador.
SQL_SECUENCIA="select setval('public.employee_number_seq', greatest((select coalesce(max(employee_number), 1) from public.employees), (select last_value from public.employee_number_seq)))"

if [ -n "${SUPABASE_DB_URL_DEV:-}" ]; then
  echo "db:test — CI: corriendo contra SUPABASE_DB_URL_DEV."
  supabase db query --db-url "$SUPABASE_DB_URL_DEV" "$SQL_SECUENCIA"
  exec supabase test db --db-url "$SUPABASE_DB_URL_DEV"
fi

echo "db:test — local: corriendo contra el proyecto vinculado (--linked)."
supabase db query --linked "$SQL_SECUENCIA"
exec supabase test db --linked
