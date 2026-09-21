# `supabase/migrations`

Migraciones numeradas (`0001_...sql`, `0002_...sql`, ...) según el orden de
`04_Modelo_de_Datos.md` sección 11, un bloque por archivo. Una vez aplicada una migración en
`App_dev` no se edita más: un cambio posterior es una migración nueva.

`pnpm db:push` (`supabase db push`, proyecto vinculado) las aplica contra `App_dev`. Nunca contra
`App` (producción) salvo encargo explícito de F20 (`ADR-014`).

Cada migración trae su/s test/s pgTAP en `supabase/tests/` (ver `supabase/tests/README.md`) y,
si cambia el esquema público, exige regenerar `src/lib/database.types.ts` con `pnpm db:types`.

## Aplicadas hasta ahora

| Archivo                                     | Tarea                  | Contenido                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0001_extensions_and_schema_app.sql`        | DB-001                 | Extensión `btree_gist`; esquema `app`; `app.set_updated_at()`, `app.local_ts(date, time)`, `app.valid_weekdays(smallint[])`.                                                                                                                                                                                                                                               |
| `0002_enums.sql`                            | DB-002                 | Las 15 enumeraciones de `04_Modelo_de_Datos.md` sección 3.                                                                                                                                                                                                                                                                                                                 |
| `0003_profiles_roles_capabilities.sql`      | DB-003, DB-004, DB-005 | `profiles`, `user_roles`, `admin_capabilities` (RLS habilitada, sin políticas todavía); triggers `app.handle_new_user()` y `app.prevent_last_owner_removal()`; funciones de permisos (`jwt_roles`, `jwt_capabilities`, `has_role`, `is_admin`, `has_capability`, `require_role`, `require_admin`, `require_capability`); hook `app.custom_access_token_hook` y sus grants. |
| `0004_company_holidays_security_events.sql` | DB-006                 | `company_settings` (singleton `id = 1`), `holidays`, `security_events` (RLS habilitada, sin políticas todavía); función `app.log_security_event(...)` (uso interno, `execute` revocado a `public`/`anon`/`authenticated`).                                                                                                                                                 |
| `0005_clients_sites.sql`                    | DB-007                 | `clients`, `client_contacts` (índice único parcial: un solo contacto principal por cliente), `sites` (nombre único por cliente, `unique (id, client_id)` para las FK compuestas de `services`/`shifts`); RLS habilitada, sin políticas todavía.                                                                                                                            |
| `0006_employees.sql`                        | DB-008                 | Secuencia `employee_number_seq` y `employees`, `employee_client_permissions`, `employee_availability` (check `end_time > start_time`), `employee_leaves` (check `ends_on >= starts_on` y restricción de exclusión sobre el rango de fechas con `btree_gist`); RLS habilitada, sin políticas todavía.                                                                       |
