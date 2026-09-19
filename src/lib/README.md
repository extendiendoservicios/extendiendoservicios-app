# `src/lib`

Utilidades transversales que no son componentes ni llamadas de dominio a la
API:

- `appVersion.ts` — versión de la app inyectada desde `package.json`
  (ADR-020, INFRA-002).
- `supabase.ts` — cliente de Supabase, desde F6.
- `database.types.ts` — tipos generados por `pnpm db:types` (no se edita a
  mano), desde F4.
- `geolocation.ts` — helpers de geoposición, desde F13.
- `format.ts` — formato de fechas y horas en español de Argentina, desde F5.
- `errors.ts` — traducción de errores de Postgres/PostgREST a mensajes en
  voseo, desde F8.
