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
# Tandas en paralelo (30 oct 2026): la suite completa son ~87 archivos y casi todo el tiempo es
# latencia de red contra App_dev (~24 min de a uno). Sin argumentos, el script reparte los
# archivos en 3 tandas balanceadas por duración y lanza 3 `supabase test db` en paralelo
# (procesos en segundo plano + `wait`), cada uno con su salida en un archivo que se imprime
# entero al terminar. Falla si falla cualquier tanda. Con argumentos
# (`pnpm db:test supabase/tests/xxxx.test.sql ...`) corre solo esos archivos, sin tandas: es
# lo que usan los agentes de backend para probar lo que tocan. Como los archivos corren a la
# vez contra la misma base, NINGÚN archivo puede repetir una clave única (ids, emails, dni,
# legajos, códigos, nombres únicos) ni el nombre de su esquema auxiliar con otro archivo:
# dos transacciones que insertan la misma clave se esperan hasta que la otra termina. Ver
# supabase/tests/README.md.
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
  DESTINO=(--db-url "$SUPABASE_DB_URL_DEV")
else
  echo "db:test — local: corriendo contra el proyecto vinculado (--linked)."
  DESTINO=(--linked)
  # Con --linked la CLI entra con un rol temporal (cli_login_postgres) cuya contraseña regenera
  # cada proceso: tres `supabase test db --linked` a la vez se invalidan entre sí ("password
  # authentication failed") y, por los reintentos, el pooler los frena con ECIRCUITBREAKER. Las
  # tandas en paralelo solo funcionan con --db-url (CI); en local la suite corre en una sola tanda.
  if [ "${DB_TEST_TANDAS:-1}" -gt 1 ]; then
    echo "db:test — aviso: con --linked no se puede paralelizar (ver el comentario del script); se usa 1 tanda." >&2
  fi
  DB_TEST_TANDAS=1
fi

supabase db query "${DESTINO[@]}" "$SQL_SECUENCIA"

# Con argumentos: solo esos archivos, en una única corrida (sin tandas).
if [ "$#" -gt 0 ]; then
  echo "db:test — archivos sueltos ($#), sin tandas."
  exec supabase test db "$@" "${DESTINO[@]}"
fi

TANDAS="${DB_TEST_TANDAS:-3}"
# Segundos de espera entre el arranque de una tanda y la siguiente (por defecto 0).
ESCALONADO="${DB_TEST_ESCALONADO:-0}"
DIR_TESTS="supabase/tests"

mapfile -t ARCHIVOS < <(find "$DIR_TESTS" -maxdepth 1 -name '*.sql' | LC_ALL=C sort)
if [ "${#ARCHIVOS[@]}" -eq 0 ]; then
  echo "db:test — no hay archivos .sql en $DIR_TESTS."
  exit 0
fi

# Control previo: dos archivos que crean el mismo esquema auxiliar se bloquean entre sí al correr
# en paralelo (y `tests` a secas, el nombre viejo, lo compartían 64). Cada archivo usa el suyo.
REPETIDOS="$(grep -HoiE 'create schema if not exists [a-z0-9_]+' "${ARCHIVOS[@]}" |
  awk -F: '{ n = $2; sub(/^.* /, "", n); a[n] = a[n] " " $1; c[n]++ } END { for (n in c) if (c[n] > 1) print n ":" a[n] }')"
if [ -n "$REPETIDOS" ]; then
  echo "db:test — ERROR: hay esquemas auxiliares repetidos entre archivos (corren en paralelo y se bloquearían):" >&2
  echo "$REPETIDOS" >&2
  echo "Cada archivo tiene que crear un esquema propio (tests_<NNNN>, ver supabase/tests/README.md)." >&2
  exit 1
fi

# Duración aproximada en segundos de los archivos más lentos (corrida del 29 oct 2026 contra
# App_dev); el resto se estima en 14 s (la mediana). Solo sirve para repartir: un archivo nuevo
# cae solo en la tanda menos cargada, sin tocar esta tabla.
PESOS='60 0070_p25_1_insumos_movimientos.test.sql
58 0033_p19_5a_ajustes_reunion.test.sql
41 0070_p25_1_insumos_permisos.test.sql
41 0063_p24_1_jornada_coordinador.test.sql
38 0027_rpc_notices_admin_attendance.test.sql
31 0037_p19_6b_tope_de_horas_y_a_terminar.test.sql
29 0024_rpc_assignments.test.sql
29 0052_p22_1_geolocalizacion_correcciones.test.sql
29 0030_p18_6_permisos_y_rendimiento.test.sql
29 0063_p24_1_supervision_libre.test.sql'

# Archivos que escriben una fila global compartida (company_settings es de una sola fila, sin
# clave por archivo): en paralelo se esperan hasta el rollback y, combinados con el lock de
# aviso de app.next_client_calendar_color (que toma cada alta de clientes), se cruzan en un
# deadlock. Se detectan por contenido, así un archivo nuevo entra solo, y van todos juntos en la
# misma tanda, que corre de a un archivo.
mapfile -t SERIALES < <(grep -lE 'company_settings|set_media_retention|set_geofence_radius' "${ARCHIVOS[@]}" || true)

# Reparto determinístico: de mayor a menor peso (empate por nombre), cada archivo a la tanda con
# menos carga acumulada (la de menor número si empatan). Salida: "<tanda> <archivo>".
REPARTO="$(
  awk -v n="$TANDAS" -v pesos="$PESOS" '
    BEGIN {
      m = split(pesos, l, "\n")
      for (i = 1; i <= m; i++) { split(l[i], p, " "); w[p[2]] = p[1] }
    }
    {
      b = $0; sub(/^.*\//, "", b)
      printf "%d %s\n", (b in w) ? w[b] : 14, $0
    }' < <(printf '%s\n' "${ARCHIVOS[@]}") |
    LC_ALL=C sort -k1,1nr -k2,2 |
    awk -v n="$TANDAS" -v seriales="${SERIALES[*]:-}" '
      BEGIN {
        for (i = 1; i <= n; i++) carga[i] = 0
        m = split(seriales, s, " ")
        for (i = 1; i <= m; i++) serial[s[i]] = 1
        juntos = 0
      }
      {
        if (($2 in serial) && juntos > 0) t = juntos
        else {
          t = 1
          for (i = 2; i <= n; i++) if (carga[i] < carga[t]) t = i
          if ($2 in serial) juntos = t
        }
        carga[t] += $1
        print t, $2
      }'
)"

# DB_TEST_SOLO_REPARTO=1: imprime "<tanda> <archivo>" y termina (para revisar el balance).
if [ -n "${DB_TEST_SOLO_REPARTO:-}" ]; then
  echo "$REPARTO"
  exit 0
fi

SALIDA="$(mktemp -d)"
trap 'rm -rf "$SALIDA"' EXIT

PIDS=()
CANTIDAD=()
for ((t = 1; t <= TANDAS; t++)); do
  mapfile -t DE_LA_TANDA < <(awk -v t="$t" '$1 == t { print $2 }' <<<"$REPARTO" | LC_ALL=C sort)
  CANTIDAD[t]="${#DE_LA_TANDA[@]}"
  if [ "${#DE_LA_TANDA[@]}" -eq 0 ]; then
    PIDS[t]=""
    continue
  fi
  [ "$t" -gt 1 ] && [ "$ESCALONADO" -gt 0 ] && sleep "$ESCALONADO"
  (
    inicio=$SECONDS
    rc=0
    supabase test db "${DE_LA_TANDA[@]}" "${DESTINO[@]}" >"$SALIDA/tanda-$t.log" 2>&1 || rc=$?
    echo "$rc $((SECONDS - inicio))" >"$SALIDA/tanda-$t.fin"
  ) &
  PIDS[t]=$!
done

echo "db:test — ${#ARCHIVOS[@]} archivos en $TANDAS tanda(s) en paralelo (${CANTIDAD[*]:1})."
INICIO_TOTAL=$SECONDS
for ((t = 1; t <= TANDAS; t++)); do
  [ -n "${PIDS[t]}" ] && wait "${PIDS[t]}" || true
done

FALLARON=0
for ((t = 1; t <= TANDAS; t++)); do
  [ -f "$SALIDA/tanda-$t.fin" ] || continue
  read -r rc seg <"$SALIDA/tanda-$t.fin"
  estado="OK"
  if [ "$rc" -ne 0 ]; then
    estado="FALLÓ (código $rc)"
    FALLARON=$((FALLARON + 1))
  fi
  echo
  echo "================ Tanda $t/$TANDAS — ${CANTIDAD[t]} archivos — $estado en ${seg} s ================"
  cat "$SALIDA/tanda-$t.log"
done

echo
echo "db:test — total $((SECONDS - INICIO_TOTAL)) s; tandas con fallas: $FALLARON de $TANDAS."
[ "$FALLARON" -eq 0 ]
