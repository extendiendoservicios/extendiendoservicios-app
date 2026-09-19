# `supabase/tests`

Tests pgTAP (`*.sql`), uno por tabla, política RLS o RPC según corresponda:
existencia y restricciones de columnas, exclusiones, y para cada rol
(owner, admin, supervisor, employee) qué filas devuelve cada política.

`pnpm db:test` los corre contra `App_dev` en un esquema de prueba que se
recrea en cada ejecución (DB-022, F4). Hasta esa tarea, el script solo
informa que todavía no está implementado. Carpeta vacía hasta F4.
