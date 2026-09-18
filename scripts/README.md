# `scripts`

Scripts de Node/TypeScript que se corren a mano o desde CI, fuera de la app:

- `seed-dev.ts` — crea los usuarios de prueba vía Admin API de Supabase
  (los usuarios de `auth.users` no se insertan a mano), desde F4.
- `gen-types.ts` — wrapper de `pnpm db:types` si hace falta lógica extra,
  desde F4.
- `import-initial.ts` — importación de la planilla de carga inicial del
  cliente, desde F19.

Carpeta vacía hasta F4.
