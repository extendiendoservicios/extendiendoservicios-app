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
- `import-initial.ts` — importación de la planilla de carga inicial del
  cliente, desde F19.

`db-test.sh` (DB-022) y `backup-to-r2.sh`/`restore-from-r2.sh` (INFRA-018)
son scripts de shell, no de Node/TypeScript: quedan fuera de esta lista,
documentados en su propio encabezado. Lo mismo pasa con:

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
