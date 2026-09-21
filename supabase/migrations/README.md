# `supabase/migrations`

Migraciones numeradas (`0001_...sql`, `0002_...sql`, ...) según el orden de
`04_Modelo_de_Datos.md` sección 11, un bloque por archivo. Una vez aplicada una migración en
`App_dev` no se edita más: un cambio posterior es una migración nueva.

`pnpm db:push` (`supabase db push`, proyecto vinculado) las aplica contra `App_dev`. Nunca contra
`App` (producción) salvo encargo explícito de F20 (`ADR-014`).

Cada migración trae su/s test/s pgTAP en `supabase/tests/` (ver `supabase/tests/README.md`) y,
si cambia el esquema público, exige regenerar `src/lib/database.types.ts` con `pnpm db:types`.

## Aplicadas hasta ahora

| Archivo                              | Tarea  | Contenido                                                                                                                    |
| ------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `0001_extensions_and_schema_app.sql` | DB-001 | Extensión `btree_gist`; esquema `app`; `app.set_updated_at()`, `app.local_ts(date, time)`, `app.valid_weekdays(smallint[])`. |
| `0002_enums.sql`                     | DB-002 | Las 15 enumeraciones de `04_Modelo_de_Datos.md` sección 3.                                                                   |
