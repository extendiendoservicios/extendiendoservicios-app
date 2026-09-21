-- DB-017 (08_Fases_y_Backlog.md, F4 · Modelo de datos y RLS base, P04.5 tramo B)
--
-- Revocaciones a `anon`, grants a `authenticated`, grants por columna, `execute` de las RPC de
-- `0013_rpc_users.sql` y `alter default privileges` para las tablas que nazcan de acá en
-- adelante (04 sección 7.2, cierre: "revoke all on all tables from anon; anon solo accede a
-- v_public_branding. authenticated con select en tablas y execute en las RPC listadas;
-- insert/update/delete directos solo donde la tabla lo indica").
--
-- Punto de partida verificado en `App_dev` antes de escribir este archivo (ver el reporte de la
-- tarea): `anon` y `authenticated` tienen hoy `DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,
-- UPDATE` sobre las 25 tablas de negocio Y sobre las diez vistas de `0011` -- el ACL por defecto
-- del esquema `public` que Supabase deja provisionado (nota de seguridad de
-- `0003_profiles_roles_capabilities.sql`), nunca tocado hasta ahora porque RLS (0012) ya negaba
-- el acceso real fila por fila. Esta migración cierra también el ACL de tabla/columna, capa
-- adicional de defensa en profundidad.

-- ---------------------------------------------------------------------------------------------
-- 1. Revoca todo, de los dos roles, sobre todo lo de `public` (tablas y vistas) -- se parte de
--    cero para otorgar después exactamente lo que corresponde, en vez de ir revocando privilegio
--    por privilegio sobre el ACL amplio actual.
-- ---------------------------------------------------------------------------------------------

revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. anon: únicamente v_public_branding (04 sección 7.2) -----------------------------------------
-- ---------------------------------------------------------------------------------------------

-- La vista en sí (objeto `public.v_public_branding`) necesita su propio grant -- el `revoke all`
-- de arriba también le quitó a `anon` el `select` que tenía sobre las vistas por el ACL por
-- defecto.
grant select on public.v_public_branding to anon;

-- company_settings: `anon` llega a esta tabla solo a través de la política
-- `company_settings_select_anon` (0012, `using (true)`, necesaria para que la vista de arriba
-- funcione bajo `security_invoker`) -- acá se recorta a las mismas tres columnas que la vista
-- proyecta. A diferencia de `profiles`/`clients` (04 sección 7.2: "solo columnas" para
-- compañeros/clientes de sus turnos, sección 0012_rls_policies.sql: riesgo residual aceptado
-- porque el mismo rol de Postgres necesita más columnas para OTRO caso, propio vs. compañero),
-- acá no hay ese conflicto: `company_settings` es un singleton (una sola fila para todo el
-- mundo) y `anon` no tiene ningún otro caso de uso que necesite más columnas por esta vía, así
-- que el grant de columna sí logra la restricción real (identificado como viable en el reporte
-- del tramo A).
-- `id` incluida además de las tres columnas públicas: v_public_branding (0011) y la consulta
-- directa filtran por `where id = 1` -- Postgres exige privilegio de select también sobre las
-- columnas del `where`, no solo las del `select` list (verificado en transacción de prueba).
grant select (id, name, logo_path, support_phone) on public.company_settings to anon;

-- ---------------------------------------------------------------------------------------------
-- 3. authenticated: select en todas las tablas y vistas (RLS decide qué filas ve cada quien) -----
-- ---------------------------------------------------------------------------------------------

grant select on all tables in schema public to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. authenticated: insert/update/delete, solo donde 04 sección 7.2 indica escritura directa
--    (no "RPC") -- mismo criterio que `0012_rls_policies.sql`, que no agregó política de
--    escritura para las tablas "RPC": sin el grant de tabla tampoco alcanzaría, pero así queda
--    documentado en el ACL además de en las políticas.
-- ---------------------------------------------------------------------------------------------

-- profiles: update de todas las columnas editables (04 sección 7.2: "O, A: todas las columnas").
-- El candado real para "propio, no admin: solo estas cinco columnas" NO lo puede dar un grant de
-- columna solo (ver el punto 5 más abajo, es una limitación real de Postgres, no una decisión de
-- diseño): el trigger `app.enforce_profile_self_update_columns` es el que aplica esa parte.
grant update (
  first_name, last_name, contact_email, phone, avatar_path, location_consent_at,
  last_seen_changes_at, is_active, deleted_at
) on public.profiles to authenticated;
-- insert: nunca (solo por el trigger app.handle_new_user, security definer). delete: nunca.

grant insert, update on public.employees to authenticated;
-- delete: nunca (baja lógica vía update).

grant insert, update, delete on public.employee_client_permissions to authenticated;
grant insert, update, delete on public.employee_availability to authenticated;
grant insert, update, delete on public.employee_leaves to authenticated;

grant insert, update, delete on public.clients to authenticated;
grant insert, update, delete on public.client_contacts to authenticated;
grant insert, update, delete on public.sites to authenticated;
grant insert, update, delete on public.services to authenticated;

-- assignments: update de notes únicamente (04 sección 7.2: "RPC. E: update de notes propia
-- mientras el turno no esté completed"). A diferencia de profiles, acá no hay ningún otro caso
-- (O, A siempre escriben por RPC, nunca por update directo) que necesite más columnas por esta
-- vía: el grant de columna sí alcanza solo, sin necesitar un trigger adicional -- cualquier
-- intento de tocar otra columna en el mismo update falla con "permission denied for column" sin
-- llegar siquiera a evaluar la política RLS.
grant update (notes) on public.assignments to authenticated;

grant insert, update, delete on public.checklist_templates to authenticated;
grant insert, update, delete on public.checklist_template_items to authenticated;

grant insert, update, delete on public.rating_criteria to authenticated;
grant insert, update, delete on public.holidays to authenticated;

-- company_settings: update de todas las columnas para O/A (04 sección 7.2, P-117), sin recorte
-- de columna -- el recorte de company_settings de este archivo es solo para `anon`.
grant update on public.company_settings to authenticated;

-- Tablas "RPC" (sin insert/update/delete directo para ningún rol, ni siquiera O/A): user_roles,
-- admin_capabilities, shifts, attendance_records, attendance_notices, shift_tasks, supervisions,
-- supervision_attendance, ratings, security_events. Solo tienen el `select` del punto 3.

-- ---------------------------------------------------------------------------------------------
-- 5. profiles: candado real de columnas para "propio, no admin" -----------------------------------
-- ---------------------------------------------------------------------------------------------

-- Por qué hace falta un trigger y no alcanza con el grant de columna del punto 4 (hallazgo del
-- tramo B, ver el reporte de la tarea): un `grant` de Postgres es por ROL DE SESIÓN
-- (`authenticated`), no por ROL DE APLICACIÓN ni por fila. `profiles_update_own` (0012) permite
-- la fila propia con cualquiera de esas columnas; `profiles_update_admin` (0012) permite CUALQUIER
-- fila con todas las columnas -- ambas políticas corren bajo el MISMO rol de Postgres
-- `authenticated`. Si el `grant update` se limitara a las cinco columnas de "propio"
-- (contact_email, phone, avatar_path, location_consent_at, last_seen_changes_at), un admin
-- editando la fila de OTRA persona tampoco podría tocar first_name/is_active/etc, porque el
-- grant de columna es la misma barrera para los dos casos. La única forma de que "O, A: todas las
-- columnas" funcione de verdad es que el grant sea amplio (punto 4); el candado para "propio, no
-- admin: solo esas cinco" lo tiene que aplicar un trigger, que sí puede mirar quién es el que
-- edita y actuar distinto según el rol de aplicación.
create function app.enforce_profile_self_update_columns()
returns trigger
language plpgsql
set search_path = public, app, pg_temp
as $$
begin
  if auth.uid() = old.id and not app.is_admin() then
    if new.first_name is distinct from old.first_name
      or new.last_name is distinct from old.last_name
      or new.is_active is distinct from old.is_active
      or new.created_at is distinct from old.created_at
      or new.created_by is distinct from old.created_by
      or new.updated_by is distinct from old.updated_by
      or new.deleted_at is distinct from old.deleted_at
    then
      raise exception using
        errcode = 'P0001',
        message = 'Desde tu perfil solo podés editar el email de contacto, el teléfono, la foto y el consentimiento de ubicación.',
        hint = 'FORBIDDEN';
    end if;
  end if;
  return new;
end;
$$;

comment on function app.enforce_profile_self_update_columns() is
  'Trigger BEFORE UPDATE en profiles: cuando quien edita es la propia persona (auth.uid() = old.id) y no es owner/admin, rechaza el update si cambió alguna columna fuera de contact_email/phone/avatar_path/location_consent_at/last_seen_changes_at (FORBIDDEN). Necesario porque el grant de columna (arriba) tiene que ser amplio para que O/A puedan editar cualquier columna de cualquier perfil -- ver el comentario del punto 5 de esta migración.';

-- Nombre elegido a propósito para que ordene ANTES que `trg_set_updated_at` (orden alfabético de
-- ejecución de triggers BEFORE del mismo evento en Postgres): así compara `new.updated_at` contra
-- `old.updated_at` antes de que `app.set_updated_at` lo pise, aunque en la práctica no importa
-- (esta columna no está en la lista de comparación de arriba).
create trigger trg_enforce_profile_self_update_columns
before update on public.profiles
for each row execute function app.enforce_profile_self_update_columns();

-- ---------------------------------------------------------------------------------------------
-- 6. execute de las RPC de 0013_rpc_users.sql -------------------------------------------------
-- ---------------------------------------------------------------------------------------------

-- Mismo patrón que el hook de 0003: revoke del execute que Postgres concede a PUBLIC por
-- defecto al crear una función (alcanza a anon y authenticated), después grant explícito solo a
-- authenticated (mark_changes_seen y set_user_roles/set_admin_capability ya verifican rol/
-- capacidad adentro, pero no tiene sentido que anon pueda siquiera intentar llamarlas).
revoke execute on function public.set_user_roles(uuid, public.app_role[]) from public, anon;
grant execute on function public.set_user_roles(uuid, public.app_role[]) to authenticated;

revoke execute on function public.set_admin_capability(uuid, public.admin_capability, boolean) from public, anon;
grant execute on function public.set_admin_capability(uuid, public.admin_capability, boolean) to authenticated;

revoke execute on function public.mark_changes_seen() from public, anon;
grant execute on function public.mark_changes_seen() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 7. alter default privileges: tablas y vistas que nazcan de acá en adelante ----------------------
-- ---------------------------------------------------------------------------------------------

-- Pregunta que dejó el reporte del tramo A, resuelta por Mike: "revocar lo de hoy no alcanza
-- para mañana" -- las tablas que creen las migraciones de F6 en adelante van a nacer con el
-- mismo ACL amplio de Supabase (nota de seguridad de 0003) hasta que la migración que las crea
-- agregue sus propios `revoke`/`grant`. La alternativa de "cada migración nueva se ocupa de sus
-- grants" es frágil: depende de que nadie se olvide, nunca, en ninguna migración futura -- un
-- solo olvido deja una tabla nueva completamente expuesta a `anon` (lectura Y escritura) hasta
-- que alguien lo note. Se agrega acá un `alter default privileges`, para que el olvido nunca
-- pase de "sin select para anon" (seguro) a "todo abierto" (inseguro): de acá en más, toda tabla
-- o vista nueva de `public` nace SIN ningún privilegio para `anon` y con `select` para
-- `authenticated` (RLS sigue siendo, como siempre, la que decide qué filas se ven -- este
-- default no reemplaza escribir la política de la tabla nueva, solo evita que quede expuesta
-- mientras tanto). Los privilegios de escritura (insert/update/delete) para `authenticated`
-- siguen siendo decisión explícita de cada migración nueva -- no tiene sentido un default ahí,
-- porque la mayoría de las tablas de negocio de los módulos futuros van a ser "RPC" (sin
-- escritura directa), igual que la mayoría de las de la Base.
-- `for role postgres`: es el dueño real de las tablas que crean las migraciones (verificado en
-- `App_dev`: `select tableowner from pg_tables` da `postgres` para las tablas existentes, aunque
-- la CLI se conecte con el rol temporal `cli_login_postgres`, miembro de `postgres`) -- sin
-- `for role`, el default se aplicaría solo a lo que cree el rol que ejecuta ESTA migración en
-- particular, no necesariamente el mismo que aplique las siguientes.
alter default privileges for role postgres in schema public
  revoke all on tables from anon;

-- El `revoke all` de authenticated es necesario antes del `grant select`: Supabase ya deja
-- provisionado, a nivel de default privileges, un "ALL" para authenticated (mismo origen que el
-- ACL amplio que tenían las tablas existentes antes de este archivo, nota de seguridad de 0003);
-- los default privileges de Postgres se acumulan (pueden convivir varias entradas para el mismo
-- rol), así que agregar directamente un `grant select` sin este `revoke` antes dejaría el
-- "select" nuevo sumado al "ALL" viejo, sin ningún efecto real (probado en transacción de
-- prueba: sin este revoke, una tabla nueva seguía naciendo con insert/update/delete para
-- authenticated).
alter default privileges for role postgres in schema public
  revoke all on tables from authenticated;

alter default privileges for role postgres in schema public
  grant select on tables to authenticated;
