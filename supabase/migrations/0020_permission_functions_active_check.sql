-- Sin tarea DB numerada -- encargo explícito de Mike, decidido el 23 sep 2026
-- (12_Registro_de_Progreso.md, "Antes de F7": ventana de revocación, alternativa (b), combinada
-- con (a) que baja `jwt_expiry` en `supabase/config.toml`), ejecutado en el paquete P07.1 junto
-- con USERS-001 a USERS-006 y USERS-017.
--
-- Contenido de este archivo, en orden:
--   1. `app.current_profile_active()`: una lectura por clave primaria de `profiles.is_active` y
--      `deleted_at` para `auth.uid()`, `stable` y `security definer`.
--   2. `app.has_role`/`app.has_capability` (y por herencia `app.is_admin`, `app.require_role`,
--      `app.require_admin`, `app.require_capability`, y toda política RLS que los usa) exigen
--      además que la sesión actual pertenezca a un perfil activo y no borrado.
--   3. `app.enforce_profile_self_update_columns` pasa a `security definer`: es el arreglo del
--      pendiente anotado desde P04.6 ("`service_role` no puede actualizar `profiles` por
--      PostgREST"), que la Edge Function `admin-users` (mismo paquete) necesita para
--      `deactivate_user`/`reactivate_user`.
--
-- Por qué hacía falta esto y no alcanzaba con lo que ya hizo `0016_hardening.sql`: el hook
-- (`app.custom_access_token_hook`) ya deja afuera del JWT los roles y capacidades de una persona
-- inactiva o borrada, pero solo actúa en el momento de EMITIR un token nuevo. Un `access_token`
-- ya emitido sigue siendo válido por firma y vencimiento hasta `jwt_expiry` (04 sección 7.1,
-- hallazgo de P06.2): con `jwt_expiry = 3600`, desactivar a alguien no le cortaba el acceso por
-- hasta una hora. Las funciones de esta migración cierran esa ventana para el caso más grave
-- (`is_active = false` o `deleted_at` no nulo) leyendo el estado real de `profiles` en cada
-- evaluación, no el que el JWT tenía al emitirse. El otro tramo de la decisión de Mike (que
-- quitar un rol sin desactivar a la persona tarde como mucho `jwt_expiry` en reflejarse) queda
-- cubierto bajando `jwt_expiry` a 900 en `config.toml`, no acá.
--
-- Por qué no hace falta reescribir las 69 políticas de `0012_rls_policies.sql` para que esto sea
-- barato: ninguna de ellas llama a `app.has_role`/`app.is_admin`/`app.has_capability` con un
-- argumento que dependa de la fila que se está evaluando (siempre son literales, por ejemplo
-- `app.has_role('supervisor')`) -- el propio Postgres reconoce esas llamadas como
-- "pseudo-constantes" (sin referencia a ninguna columna de la tabla escaneada) y las evalúa UNA
-- sola vez por consulta, como "One-Time Filter" o plegadas en el plan, en vez de una vez por
-- fila -- es el mismo motivo por el que nunca hizo falta el patrón `(select app.has_role(...))`
-- que sí hace falta con expresiones que si dependen de la fila (`auth.uid() = tabla.columna`).
-- Agregar `app.current_profile_active()' -- que tampoco depende de ninguna columna de la tabla
-- escaneada, solo de `auth.uid()` -- no cambia esa clasificación: se verifica más abajo, con
-- `explain analyze` antes y después sobre una consulta representativa del seed de `App_dev`
-- (medición en el reporte de la tarea, no repetida en el comentario para no quedar desactualizada
-- si se vuelve a correr).

-- ---------------------------------------------------------------------------------------------
-- 1. app.current_profile_active()
-- ---------------------------------------------------------------------------------------------

-- `security definer`: `authenticated` no tiene (ni necesita) política de select sobre filas
-- ajenas de `profiles` para todos los casos (0012 sí le da acceso a la propia y a la de
-- compañeros/equipo, pero esta función tiene que funcionar también para roles que no tienen
-- ninguna fila visible además de la propia, y no depende de RLS: lee directo, sin pasar por las
-- políticas, igual que el resto de las funciones de `app` con `security definer` de este
-- archivo y de `0003`). `stable`: mismo resultado dentro de la misma consulta/transacción, como
-- cualquier lectura basada en `auth.uid()`.
create function app.current_profile_active()
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select coalesce(
    (
      select p.is_active and p.deleted_at is null
      from public.profiles p
      where p.id = auth.uid()
    ),
    false
  );
$$;

comment on function app.current_profile_active() is
  'True si auth.uid() tiene una fila en profiles con is_active = true y deleted_at is null (false si la fila no existe). Lectura por clave primaria, para cerrar la ventana de revocación (04 sección 7.1, decisión de Mike del 23 sep 2026): sin esto, un access_token vigente de una persona recién desactivada seguía leyendo y escribiendo hasta que expiraba.';

-- ---------------------------------------------------------------------------------------------
-- 2. app.has_role / app.has_capability: exigen perfil activo
-- ---------------------------------------------------------------------------------------------

-- `create or replace`, misma firma exacta que 0003: conserva los grants existentes (EXECUTE a
-- PUBLIC, que ninguna migración revocó para estas dos funciones) y no exige recrear
-- `app.is_admin`/`app.require_role`/`app.require_admin`/`app.require_capability`, que llaman a
-- estas dos y heredan el chequeo sin cambiar su propio cuerpo.
create or replace function app.has_role(p_role public.app_role)
returns boolean
language sql
stable
set search_path = public, app, pg_temp
as $$
  select p_role = any(app.jwt_roles()) and app.current_profile_active();
$$;

comment on function app.has_role(public.app_role) is
  'True si la sesión actual tiene el rol indicado (04 sección 5) Y el perfil de auth.uid() sigue activo y no borrado (app.current_profile_active(), agregado el 23 sep 2026 para la ventana de revocación).';

create or replace function app.has_capability(p_capability public.admin_capability)
returns boolean
language sql
stable
set search_path = public, app, pg_temp
as $$
  select (app.has_role('owner') or p_capability::text = any(app.jwt_capabilities()))
    and app.current_profile_active();
$$;

comment on function app.has_capability(public.admin_capability) is
  'True para owner siempre; para admin, si la capacidad está habilitada en el JWT (04 sección 5). Y en los dos casos, solo si el perfil de auth.uid() sigue activo y no borrado (app.current_profile_active(), agregado el 23 sep 2026). La condición queda duplicada para el caso owner (app.has_role ya la exige) a propósito: así esta función no depende de que has_role la aplique primero, y sigue siendo correcta si algún día cambia.';

-- app.is_admin() no se toca: su cuerpo (`app.has_role('owner') or app.has_role('admin')`) ya
-- llama a la función de arriba y hereda el chequeo sin recrearse.

-- ---------------------------------------------------------------------------------------------
-- 3. app.enforce_profile_self_update_columns: pasa a security definer
-- ---------------------------------------------------------------------------------------------

-- Pendiente anotado desde P04.6 y confirmado en P04.7 (12_Registro_de_Progreso.md, "Pendiente"):
-- `service_role` no puede actualizar `profiles` por PostgREST porque este trigger (0017) no es
-- `security definer` y llama a `app.is_admin()` -- eso exige `usage on schema app`, que
-- `service_role` no tiene (solo lo tienen `authenticated` y `supabase_auth_admin`, 0003/0017).
-- El resultado era "permission denied for schema app" en cualquier `update` sobre `profiles`
-- hecho con la clave de servicio, aunque el rol de Postgres `service_role` sí tiene privilegio de
-- tabla sobre `profiles` (no lo tocó ningún `revoke` de 0017, que solo alcanzó a `anon`/
-- `authenticated`).
-- Menor cambio seguro: `alter function ... security definer`, sin tocar el cuerpo ni la firma.
-- Con esto, las llamadas internas a `app.is_admin()`/`app.has_role()` corren con los privilegios
-- de quien es dueño de la función (`postgres`, quien aplica las migraciones), no con los de quien
-- dispara el `update` -- mismo patrón que el resto de las funciones `security definer` de esta
-- base. No cambia el comportamiento para `authenticated`: `auth.uid() = old.id` sigue siendo la
-- condición que activa el candado, y para `service_role` (sin `auth.uid()`, porque no hay sesión
-- de usuario) esa condición ya daba `false` de por sí, así que el trigger seguía dejando pasar
-- cualquier columna -- lo único que fallaba era el paso intermedio de evaluar `app.is_admin()`
-- para decidirlo, no la decisión en sí.
alter function app.enforce_profile_self_update_columns() security definer;

comment on function app.enforce_profile_self_update_columns() is
  'Trigger BEFORE UPDATE en profiles: cuando quien edita es la propia persona (auth.uid() = old.id) y no es owner/admin, rechaza el update si cambió alguna columna fuera de contact_email/phone/avatar_path/location_consent_at/last_seen_changes_at (FORBIDDEN). security definer desde el 23 sep 2026 (antes fallaba con "permission denied for schema app" si el update lo hacía service_role, porque llamar a app.is_admin() exige usage on schema app -- pendiente de P04.6/P04.7, resuelto acá para que la Edge Function admin-users pueda desactivar/reactivar personas). Necesario porque el grant de columna (0017) tiene que ser amplio para que O/A puedan editar cualquier columna de cualquier perfil.';
