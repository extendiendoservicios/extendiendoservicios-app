#!/usr/bin/env bash
set -euo pipefail

# scripts/ensayo-restauracion-local.sh — TEST-024 (ADR-015, ADR-023): ensaya en Docker, de punta a
# punta y SIN credenciales de producción ni de App_dev, la misma secuencia que corre
# `restore-test.yml`: respaldo (backup-to-r2.sh) -> restauración (restore-from-r2.sh) ->
# recuperación (recuperar-app-dev.ts). Sirve para validar cualquier cambio en esos scripts antes de
# tocar App_dev, y es el ensayo que respalda a docs/restore-test.md.
#
# Qué levanta: un Supabase local propio (CLI de Supabase, base + Auth + Storage + PostgREST) con
# un `project_id` y puertos propios (57xxx), para no chocar con `supabase start` ni con
# `pnpm db:test` de nadie. Trabaja en una copia de `supabase/` dentro de una carpeta temporal:
# no toca `supabase/config.toml` del repo. R2 se simula con una carpeta y un `aws` de mentira; el
# cliente de Postgres 17 (el mismo que usa el runner) corre en un contenedor `postgres:17`.
#
# Qué comprueba:
#   1. Con las migraciones reales y datos de muestra (usuarios por la Admin API, supabase/seed.sql,
#      un ingreso real), el respaldo se restaura: filas idénticas tabla por tabla, huella de
#      permisos idéntica a la de una base recién migrada (sin el GRANT ALL de Supabase) y App_dev
#      (acá, la base local) queda vacío.
#   2. Casos que tienen que fallar bien (salvo con --rapido): un permiso de más para anon aborta
#      sin tocar nada; una falla a mitad de la carga igual deja todo vacío; un error de SQL dentro
#      de una verificación se informa como FALLA.
#   3. recuperar-app-dev.ts deja la base utilizable (ingreso del dueño con el hook de Auth).
# Al terminar baja todo lo que levantó (trap) y borra la carpeta temporal.
#
# Uso (desde la raíz de app/, con Docker Desktop prendido y `pnpm install` hecho):
#   bash scripts/ensayo-restauracion-local.sh            # completo
#   bash scripts/ensayo-restauracion-local.sh --rapido   # sin los casos que tienen que fallar
#
# Tarda unos 5 minutos la primera vez. Antes de levantar nada mira `docker ps`: si hay otros
# contenedores de Supabase corriendo (de otro proyecto) avisa pero sigue, porque los puertos y el
# `project_id` de este ensayo son propios.

raiz="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rapido=false
[ "${1:-}" = "--rapido" ] && rapido=true

PROJECT_ID="es-ensayo-restauracion"
CONTENEDOR_DB="supabase_db_${PROJECT_ID}"
RED="supabase_network_${PROJECT_ID}"
export MSYS_NO_PATHCONV=1
# En Git Bash (Windows) el acceso directo de pnpm a la CLI solo resuelve bien rutas de estilo
# Windows (C:/...): `pwd -W` las da; en Linux o macOS `pwd -W` no existe y alcanza con `pwd`.
ruta_docker() { (cd "$1" && (pwd -W 2>/dev/null || pwd)); }
raiz_docker="$(ruta_docker "$raiz")"
CLI="$raiz_docker/node_modules/.bin/supabase"

if ! docker info >/dev/null 2>&1; then
  echo "Docker no responde: prendé Docker Desktop y reintentá." >&2
  exit 1
fi
if [ ! -x "$CLI" ]; then
  echo "Falta la CLI de Supabase: corré 'pnpm install' en la raíz de app/." >&2
  exit 1
fi

echo "Contenedores corriendo ahora (para que sepas con qué convive el ensayo):"
docker ps --format '  {{.Names}}  {{.Ports}}' | head -20 || true
if docker ps -a --format '{{.Names}}' | grep -q "_${PROJECT_ID}\$"; then
  echo "Ya hay contenedores de un ensayo anterior (${PROJECT_ID}). Bajalos con:" >&2
  echo "  $CLI stop --no-backup --project-id ${PROJECT_ID}" >&2
  exit 1
fi

tmp="$(mktemp -d)"
tmp_docker="$(ruta_docker "$tmp")"

limpiar() {
  local rc=$?
  echo ""
  echo "Bajando el Supabase local del ensayo y borrando lo temporal..."
  "$CLI" stop --no-backup --workdir "$tmp_docker" >/dev/null 2>&1 || true
  # Por si la CLI no alcanzó a bajar algo: solo contenedores y volúmenes de ESTE ensayo.
  docker ps -aq --filter "name=_${PROJECT_ID}" | xargs -r docker rm -f >/dev/null 2>&1 || true
  docker volume ls -q --filter "name=${PROJECT_ID}" | xargs -r docker volume rm >/dev/null 2>&1 || true
  rm -rf "$tmp"
  restos="$(docker ps -a --format '{{.Names}}' | grep -c "_${PROJECT_ID}\$" || true)"
  echo "Contenedores del ensayo que quedaron: ${restos}"
  if [ "$rc" = "0" ]; then echo "ENSAYO COMPLETO: todo salió como se esperaba."; else echo "EL ENSAYO FALLÓ (código ${rc})." >&2; fi
  exit "$rc"
}
trap limpiar EXIT

verificar() { # <descripción> <comando...>
  local descripcion="$1"
  shift
  if "$@"; then
    echo "  [OK] ${descripcion}"
  else
    echo "  [FALLA] ${descripcion}" >&2
    exit 1
  fi
}

psql_db() { docker exec -e PGOPTIONS="-c client_min_messages=warning" -i "$CONTENEDOR_DB" psql -U postgres -X -q -A -t -v ON_ERROR_STOP=1 "$@"; }

# ---- 1. Proyecto propio en la carpeta temporal --------------------------------------------------
echo ""
echo "1. Armando la copia de supabase/ con project_id y puertos propios..."
mkdir -p "$tmp/supabase" "$tmp/bin" "$tmp/fake-r2" "$tmp/volcados"
cp -r "$raiz/supabase/migrations" "$raiz/supabase/templates" "$raiz/supabase/seed.sql" "$tmp/supabase/"
# Quita las secciones [remotes.*] (refs de proyectos reales) y apaga el seed automático.
awk '/^\[remotes/ { exit } { print }' "$raiz/supabase/config.toml" \
  | sed -e "s/^project_id = .*/project_id = \"${PROJECT_ID}\"/" \
        -e 's/^port = 54321/port = 57321/' -e 's/^port = 54322/port = 57322/' \
        -e 's/^shadow_port = 54320/shadow_port = 57320/' -e 's/^port = 54329/port = 57329/' \
        -e 's/^port = 54323/port = 57323/' -e 's/^port = 54324/port = 57324/' \
        -e 's/^port = 54327/port = 57327/' -e 's/^inspector_port = 8083/inspector_port = 58183/' \
  | awk '/^\[db.seed\]/ { s = 1 } s && /^enabled = true/ { sub(/true/, "false"); s = 0 } { print }' \
  >"$tmp/supabase/config.toml"
export RESEND_API_KEY="no-se-usa-en-el-ensayo"

cat >"$tmp/bin/aws" <<'AWS'
#!/usr/bin/env bash
# aws de mentira: simula R2 con la carpeta /fake-r2 (solo lo que usan los scripts de respaldo).
set -euo pipefail
raiz=/fake-r2
if [ "$1" = "s3" ] && [ "$2" = "cp" ]; then
  origen="$3"; destino="$4"
  if [[ "$origen" == s3://* ]]; then
    cp "$raiz/${origen#s3://*/}" "$destino"
  else
    clave="${destino#s3://*/}"
    mkdir -p "$(dirname "$raiz/$clave")"
    cp "$origen" "$raiz/$clave"
  fi
  exit 0
fi
if [ "$1" = "s3api" ] && [ "$2" = "list-objects-v2" ]; then
  prefijo=""
  while [ $# -gt 0 ]; do [ "$1" = "--prefix" ] && prefijo="$2"; shift; done
  ultimo="$(cd "$raiz" && ls -t ${prefijo}* 2>/dev/null | head -n 1 || true)"
  if [ -z "$ultimo" ]; then echo None; else echo "$ultimo"; fi
  exit 0
fi
echo "aws de mentira: comando no soportado: $*" >&2
exit 2
AWS
chmod +x "$tmp/bin/aws"

# ---- 2. Supabase local ----------------------------------------------------------------------------
echo ""
echo "2. Levantando Supabase local (puede tardar unos minutos la primera vez)..."
"$CLI" start --workdir "$tmp_docker" \
  -x studio,imgproxy,realtime,logflare,vector,edge-runtime,postgres-meta,mailpit,supavisor >"$tmp/start.log" 2>&1 \
  || { echo "No levantó el Supabase local. Últimas líneas de la CLI:" >&2; tail -15 "$tmp/start.log" >&2; exit 1; }
eval "$("$CLI" status --workdir "$tmp_docker" -o env 2>/dev/null | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"

verificar "las 29 migraciones (o las que haya) quedaron aplicadas" \
  test "$(psql_db -c 'select count(*) from supabase_migrations.schema_migrations')" = "$(find "$raiz/supabase/migrations" -name '*.sql' | wc -l | tr -d ' ')"

huella_base="$(psql_db -F '|' -f - <"$raiz/scripts/lib/huella-permisos.sql")"

# ---- 3. Datos de muestra ---------------------------------------------------------------------------
echo ""
echo "3. Cargando usuarios (Admin API), seed.sql y un ingreso real..."
(cd "$raiz" && VITE_SUPABASE_URL="$API_URL" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
  SEED_DEV_PASSWORD="ensayo-local-123" node scripts/seed-dev.ts >/dev/null)
psql_db -o /dev/null -f - <"$tmp/supabase/seed.sql"
curl -s -X POST "${API_URL}/auth/v1/token?grant_type=password" -H "apikey: ${ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"email":"extserviciosapp@gmail.com","password":"ensayo-local-123"}' >/dev/null
filas_origen="$(psql_db -c "select (select count(*) from auth.users) || '/' || (select count(*) from public.shifts) || '/' || (select count(*) from auth.sessions)")"
echo "  usuarios/turnos/sesiones en el origen: ${filas_origen}"

# ---- 4. Respaldo y restauración ---------------------------------------------------------------------
en_contenedor() {
  local url="postgresql://postgres:postgres@${CONTENEDOR_DB}:5432/postgres"
  docker run --rm --network "$RED" \
    -v "${raiz_docker}:/work:ro" -v "${tmp_docker}/bin:/fakebin:ro" -v "${tmp_docker}/fake-r2:/fake-r2" \
    -e "PATH=/fakebin:/usr/lib/postgresql/17/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
    -e "SUPABASE_DB_URL_PROD=${url}" -e "SUPABASE_DB_URL_DEV=${url}" \
    -e R2_ACCESS_KEY_ID=x -e R2_SECRET_ACCESS_KEY=x -e R2_BUCKET=es-backups -e CLOUDFLARE_ACCOUNT_ID=x \
    -e BACKUP_PASSPHRASE=frase-de-ensayo-local -e GITHUB_STEP_SUMMARY=/fake-r2/summary.md \
    --entrypoint bash postgres:17 -c "$1"
}

echo ""
echo "4. Respaldo (backup-to-r2.sh) y restauración (restore-from-r2.sh --ultimo)..."
en_contenedor 'bash /work/scripts/backup-to-r2.sh' | tail -2
# Ensucia el destino para comprobar que la restauración lo reemplaza.
psql_db -c "insert into public.clients (legal_name, trade_name) values ('BASURA SA', 'Basura')"
en_contenedor 'bash /work/scripts/restore-from-r2.sh --ultimo restaurar-app-dev' >"$tmp/restauracion.log" 2>&1 \
  || { cat "$tmp/restauracion.log"; exit 1; }
sed -n '/RESUMEN DE LA PRUEBA/,$p' "$tmp/restauracion.log"
echo ""
echo "Resumen en Markdown (lo que aparece en la pestaña Summary de la corrida de GitHub):"
sed -n '1,14p' "$tmp/fake-r2/summary.md"
verificar "App_dev (la base local) quedó vacío" \
  test "$(psql_db -c "select (select count(*) from auth.users) + (select count(*) from public.shifts) + (select count(*) from public.clients)")" = "0"
verificar "la huella de permisos es idéntica a la de una base recién migrada" \
  test "$(psql_db -F '|' -f - <"$raiz/scripts/lib/huella-permisos.sql")" = "$huella_base"
verificar "el log dice que se restauraron las mismas filas que tenía el origen" \
  grep -q "tablas idénticas" "$tmp/restauracion.log"

# ---- 5. Casos que tienen que fallar bien ---------------------------------------------------------------
if [ "$rapido" = false ]; then
  echo ""
  echo "5. Casos que tienen que fallar bien..."
  psql_db -c "insert into public.clients (legal_name, trade_name) values ('MARCADOR', 'Marcador'); grant all on public.clients to anon"
  if en_contenedor 'bash /work/scripts/restore-from-r2.sh --ultimo restaurar-app-dev' >"$tmp/negativo1.log" 2>&1; then
    echo "  [FALLA] con un permiso de más para anon la restauración tendría que haber abortado" >&2
    exit 1
  fi
  verificar "con un GRANT ALL a anon aborta antes de tocar nada" grep -q "ABORTADO: App_dev no tiene la estructura" "$tmp/negativo1.log"
  verificar "y el dato que había sigue ahí" \
    test "$(psql_db -c "select count(*) from public.clients where legal_name = 'MARCADOR'")" = "1"
  psql_db -c "revoke all on public.clients from anon; alter table public.clients add constraint ensayo_falla check (false) not valid"
  if en_contenedor 'bash /work/scripts/restore-from-r2.sh --ultimo restaurar-app-dev' >"$tmp/negativo2.log" 2>&1; then
    echo "  [FALLA] con una restricción que rechaza filas la restauración tendría que haber fallado" >&2
    exit 1
  fi
  verificar "una falla a mitad de la carga igual deja todo vacío" \
    test "$(psql_db -c "select (select count(*) from auth.users) + (select count(*) from public.shifts) + (select count(*) from public.clients)")" = "0"
  verificar "y el log lo confirma" grep -q "OK: App_dev quedó vacío" "$tmp/negativo2.log"
  psql_db -c "alter table public.clients drop constraint ensayo_falla"

  # Un error de SQL dentro de una verificación no puede pasar por "sin fallas": se renombra una
  # vista que usa la sesión simulada (verificar-datos.sql) y esa verificación tiene que fallar.
  psql_db -c "alter view public.v_people_basic rename to v_people_basic_x"
  if en_contenedor 'bash /work/scripts/restore-from-r2.sh --ultimo restaurar-app-dev' >"$tmp/negativo3.log" 2>&1; then
    echo "  [FALLA] con la sesión simulada rota la restauración tendría que haber fallado" >&2
    exit 1
  fi
  psql_db -c "alter view public.v_people_basic_x rename to v_people_basic"
  verificar "un error de SQL en una verificación se informa como FALLA" grep -q "psql terminó con error" "$tmp/negativo3.log"
  verificar "y la limpieza igual deja todo vacío" grep -q "OK: App_dev quedó vacío" "$tmp/negativo3.log"
fi

# ---- 6. Recuperación --------------------------------------------------------------------------------------
echo ""
echo "6. Recuperación (recuperar-app-dev.ts --local)..."
(cd "$raiz" && VITE_SUPABASE_URL="$API_URL" VITE_SUPABASE_ANON_KEY="$ANON_KEY" \
  SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" SEED_DEV_PASSWORD="ensayo-local-123" \
  node scripts/recuperar-app-dev.ts --local --workdir "$tmp_docker" --contenedor-db "$CONTENEDOR_DB" \
  | sed -n '/RESUMEN DE LA RECUPERACI/,$p')
verificar "la base quedó con los usuarios y datos del seed" \
  test "$(psql_db -c "select (select count(*) from auth.users) >= 14 and (select count(*) from public.shifts) > 0")" = "t"
verificar "la huella de permisos sigue idéntica después de recuperar" \
  test "$(psql_db -F '|' -f - <"$raiz/scripts/lib/huella-permisos.sql")" = "$huella_base"
