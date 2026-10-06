# `scripts`

Scripts de Node/TypeScript que se corren a mano o desde CI, fuera de la app:

- `seed-dev.ts` — DB-019 (P04.6): crea (o reutiliza, si ya existen) los
  usuarios de prueba de `App_dev` vía la Admin API de Supabase (los
  usuarios de `auth.users` no se insertan a mano). Uso:
  `node --env-file=.env.local scripts/seed-dev.ts` (o `pnpm db:seed:users`).
  Detalle completo en `docs/database.md`.
- `gen-types.ts` — wrapper de `pnpm db:types` si hace falta lógica extra.
  **No hizo falta** en P04.6: `supabase gen types --linked > ...` alcanza
  solo (decisión menor, ver el reporte de esa tarea). Queda pendiente por
  si una fase futura necesita algo más que ese comando directo.
- `import-initial.ts` — DATA-003, DATA-004, DATA-005 (P19.1): importador de la
  planilla de carga inicial de la empresa. Valida todo, informa por hoja, fila y
  columna, y solo si no hay errores carga en el entorno elegido con
  `IMPORT_ENTORNO` (`app_dev`; `app` solo con `--permitir-produccion-f20`). Uso:
  `pnpm import:initial <planilla.xlsx> --dry-run --salida <carpeta>` (validar),
  sin `--dry-run` (cargar) y con `--resume` (reintentar). La lógica vive en
  `scripts/import-initial/`; los tests unitarios corren en `pnpm test` y la
  prueba de integración contra `App_dev` con `pnpm test:import`. Procedimiento
  completo en `docs/carga-inicial.md`.

- `recuperar-app-dev.ts` — TEST-024 (P18.5): deja a `App_dev` utilizable
  después de una corrida de `restore-test.yml`, que lo deja sin usuarios y
  sin datos. En orden y validando cada paso: migraciones, Auth, usuarios de
  prueba (`seed-dev.ts`), `supabase/seed.sql`, cuentas fijas de P18.1
  (`pnpm test:fixtures:setup`) y validación final. Uso:
  `pnpm db:recuperar-dev` (o `node --env-file=.env.local
scripts/recuperar-app-dev.ts`). Detalle en `docs/restore-test.md`
  sección 8.

`db-test.sh` (DB-022) y `backup-to-r2.sh`/`restore-from-r2.sh` (INFRA-018)
son scripts de shell, no de Node/TypeScript: quedan fuera de esta lista,
documentados en su propio encabezado. Lo mismo pasa con:

- `ensayo-restauracion-local.sh` (TEST-024, P18.5) — ensaya en Docker, con un
  Supabase local propio y un R2 simulado, la secuencia completa de
  respaldo, restauración y recuperación, sin credenciales de nadie. Hay que
  correrlo cada vez que se cambie un script o un `.sql` de esta carpeta:
  `bash scripts/ensayo-restauracion-local.sh` (o `--rapido`).
- `lib/dependencias-ci.sh`, `lib/verificar-estructura.sql`,
  `lib/verificar-datos.sql` y `lib/huella-permisos.sql` — lo que usan los
  scripts de respaldo y restauración: instalación de herramientas en el
  runner y las comprobaciones de estructura, permisos y datos. Ver
  `docs/restore-test.md`.

- `generar-plantilla-carga-inicial.py` (DATA-001, DATA-002, P04.8) — script
  Python (no Node) que genera `docs/plantilla-carga-inicial.xlsx` con
  `openpyxl`. No es parte del stack de la app (no se instala con `pnpm`):
  para correrlo hace falta Python 3 y `pip install openpyxl` (si no lo
  tenés instalado). Uso, desde la raíz de `app/`:
  `python scripts/generar-plantilla-carga-inicial.py`. Sobrescribe el
  `.xlsx` cada vez que corre, así que cualquier cambio a la planilla se
  hace en el script, nunca a mano en el Excel. Detalle de qué respalda
  cada columna (qué `check` o qué enumeración de la base) en los
  comentarios del propio script y en el reporte de la tarea P04.8.
