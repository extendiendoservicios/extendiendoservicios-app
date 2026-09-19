# `src/features`

Una carpeta por dominio (`clients`, `employees`, `shifts`, `auth`, etc.) con
tres piezas por feature:

- `schemas.ts` — validación con zod, espejo de las restricciones que ya
  aplica el servidor (RLS, RPC, constraints).
- `queries.ts` — hooks de TanStack Query sobre `src/api/<dominio>.ts`.
- `components/` — componentes de UI propios del dominio (formularios,
  listados, drawers) que no son de uso general.

Carpeta vacía hasta F6 (primer dominio: autenticación).
