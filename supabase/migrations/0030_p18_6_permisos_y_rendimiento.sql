-- P18.6 (F18, corrección de defectos de la matriz de permisos y de la prueba de carga): una sola
-- migración con las correcciones de base de datos que dejaron P18.1, P18.3 y P18.4. Reportes en
-- Docs/Plan_Maestro/reportes/P18.1, P18.3 (reporte y revisión del orquestador) y docs/security-review.md.
--
-- Qué corrige, por bloque:
--   1. Funciones auxiliares en `app` que devuelven CONJUNTOS (mis turnos, mis asignaciones, ...) y
--      las tres funciones de datos recortados (personas, clientes, compañeros de turno).
--   2. Vistas recortadas (DEF-P03, P04, P05, P06): `v_people_basic` (misma forma de antes, ahora
--      respaldada por una función), `v_clients_basic` y `v_shift_peers` (nuevas).
--   3. Políticas RLS (rendimiento DEF-P02 y la carga de `v_my_day`; recortes P03 a P06; DEF-P09):
--      toda función de permisos va envuelta en `(select ...)` para que se evalúe UNA vez por
--      consulta y no una vez por fila, y los filtros por turno pasan de "función por fila" a
--      "pertenece al conjunto" (`x in (select ...)`, un hashed subplan).
--   4. profiles: quién puede desactivar o editar a quién (DEF-P13).
--   5. company_settings: el administrador solo cambia el logo (DEF-P01).
--   6. v_my_day: incluye los turnos cancelados (DEF-01) y lee el cliente por la vista recortada.
--   7. v_my_supervisions: el nombre de los compañeros sale de la vista recortada.
--   8. update_shift_time: el mensaje de superposición nombra al empleado (DEF-03).
--   9. mark_changes_seen: rechaza a una cuenta desactivada (DEF-P12).
--  10. Storage: `avatars` deja de ser listable por cualquiera (DEF-P07 = SEG-01) y exige perfil
--      activo para escribir (DEF-P10); `branding` sin SVG (SEG-02).
--  11. rls_auto_enable(): sin `execute` para nadie de la app (DEF-P11 = SEG-08).
--  12. security_event_type: valor nuevo `admin_action_rejected` (SEG-03, lo usa admin-users).
--
-- Sobre la seguridad de las funciones de conjuntos: son `security definer` (leen tablas con RLS
-- sin pasar por ella) y por eso se usan SIEMPRE junto a la verificación de rol de la política
-- (`(select app.has_role(...)) and x in (select app.mis_cosas())`). Ninguna recibe parámetros:
-- todas parten de auth.uid(), así que no sirven para consultar "por otra persona".

-- ---------------------------------------------------------------------------------------------
-- 1. Funciones auxiliares que devuelven conjuntos (esquema app, no expuesto por la API) ----------
-- ---------------------------------------------------------------------------------------------

-- Turnos en los que la sesión tiene una asignación vigente (el equivalente "por conjunto" de
-- app.shares_shift: en vez de llamarla fila por fila, se calcula una vez y se pregunta si el
-- turno de la fila está adentro).
create function app.my_shift_ids()
returns setof uuid
language sql
stable
security definer
rows 50
set search_path = public, app, pg_temp
as $$
  select a.shift_id
  from public.assignments a
  where a.employee_id = auth.uid()
    and a.removed_at is null;
$$;

comment on function app.my_shift_ids() is
  'Turnos en los que auth.uid() tiene una asignación vigente (removed_at is null). Versión por conjunto de app.shares_shift (0007): las políticas la usan como `shift_id in (select app.my_shift_ids())` para que se evalúe una sola vez por consulta (0030, DEF-P02). No verifica rol ni que el perfil esté activo: va siempre combinada con (select app.has_role(...)) en la política.';

-- Turnos que la sesión supervisa (supervisión no cancelada).
create function app.my_supervised_shift_ids()
returns setof uuid
language sql
stable
security definer
rows 50
set search_path = public, app, pg_temp
as $$
  select s.shift_id
  from public.supervisions s
  where s.supervisor_id = auth.uid()
    and s.status <> 'cancelled';
$$;

comment on function app.my_supervised_shift_ids() is
  'Turnos con una supervisión no cancelada de auth.uid(). Versión por conjunto de app.supervises_shift (0010); mismo uso y misma advertencia que app.my_shift_ids().';

-- Asignaciones propias vigentes.
create function app.my_assignment_ids()
returns setof uuid
language sql
stable
security definer
rows 50
set search_path = public, app, pg_temp
as $$
  select a.id
  from public.assignments a
  where a.employee_id = auth.uid()
    and a.removed_at is null;
$$;

comment on function app.my_assignment_ids() is
  'Asignaciones vigentes de auth.uid() (como empleado). Las usan las políticas de attendance_records y attendance_notices del empleado (0030).';

-- Asignaciones (vigentes o no) de los turnos que la sesión supervisa.
create function app.supervised_assignment_ids()
returns setof uuid
language sql
stable
security definer
rows 200
set search_path = public, app, pg_temp
as $$
  select a.id
  from public.assignments a
  where a.shift_id in (select s from app.my_supervised_shift_ids() as s);
$$;

comment on function app.supervised_assignment_ids() is
  'Asignaciones, vigentes o quitadas, de los turnos que auth.uid() supervisa. Las usan las políticas de attendance_records y attendance_notices del supervisor (0030).';

-- Supervisiones propias (cualquier estado).
create function app.my_supervision_ids()
returns setof uuid
language sql
stable
security definer
rows 50
set search_path = public, app, pg_temp
as $$
  select s.id
  from public.supervisions s
  where s.supervisor_id = auth.uid();
$$;

comment on function app.my_supervision_ids() is
  'Supervisiones de auth.uid() en cualquier estado. Las usan las políticas de ratings y supervision_attendance (0030).';

-- Clientes y sedes de los turnos que la sesión supervisa o comparte. Mismo criterio que las
-- subconsultas de 0012 (clients_select_shift_party, sites_select_shift_party): no filtran por
-- `deleted_at` del turno; el `deleted_at` del cliente o de la sede lo pone la propia política.
create function app.supervised_client_ids()
returns setof uuid
language sql
stable
security definer
rows 50
set search_path = public, app, pg_temp
as $$
  select sh.client_id
  from public.shifts sh
  where sh.id in (select s from app.my_supervised_shift_ids() as s);
$$;

comment on function app.supervised_client_ids() is
  'Clientes de los turnos que auth.uid() supervisa (0030).';

create function app.shared_client_ids()
returns setof uuid
language sql
stable
security definer
rows 50
set search_path = public, app, pg_temp
as $$
  select sh.client_id
  from public.shifts sh
  where sh.id in (select s from app.my_shift_ids() as s);
$$;

comment on function app.shared_client_ids() is
  'Clientes de los turnos en los que auth.uid() tiene una asignación vigente (0030). Los usa app.clients_basic().';

create function app.supervised_site_ids()
returns setof uuid
language sql
stable
security definer
rows 50
set search_path = public, app, pg_temp
as $$
  select sh.site_id
  from public.shifts sh
  where sh.id in (select s from app.my_supervised_shift_ids() as s);
$$;

comment on function app.supervised_site_ids() is
  'Sedes de los turnos que auth.uid() supervisa (0030).';

create function app.shared_site_ids()
returns setof uuid
language sql
stable
security definer
rows 50
set search_path = public, app, pg_temp
as $$
  select sh.site_id
  from public.shifts sh
  where sh.id in (select s from app.my_shift_ids() as s);
$$;

comment on function app.shared_site_ids() is
  'Sedes de los turnos en los que auth.uid() tiene una asignación vigente (0030).';

-- ---------------------------------------------------------------------------------------------
-- 2. Datos recortados para empleado y supervisor (DEF-P03, P04, P05, P06) ------------------------
-- ---------------------------------------------------------------------------------------------

-- Personas visibles con SOLO nombre y foto (P-103, 04 sección 7.2). Quién ve a quién:
--   - owner y admin: todas;
--   - cualquiera: su propia fila;
--   - supervisor: los empleados con asignación vigente en los turnos que supervisa;
--   - empleado: los compañeros con asignación vigente en sus turnos.
-- Es lo que antes resolvían dos políticas de `profiles` que devolvían la fila ENTERA (teléfono,
-- email de contacto, estado): RLS filtra filas, no columnas, así que ahora esas filas ajenas no
-- se leen de la tabla sino de acá.
create function app.people_basic()
returns table (profile_id uuid, first_name text, last_name text, avatar_path text)
language sql
stable
security definer
rows 50
set search_path = public, app, pg_temp
as $$
  select p.id, p.first_name, p.last_name, p.avatar_path
  from public.profiles p
  where (select app.is_admin())
     or p.id = (select app.current_uid())
     or (
       (select app.has_role('supervisor'))
       and p.id in (
         select a.employee_id
         from public.assignments a
         where a.removed_at is null
           and a.shift_id in (select s from app.my_supervised_shift_ids() as s)
       )
     )
     or (
       (select app.has_role('employee'))
       and p.id in (
         select t.employee_id
         from public.assignments t
         where t.removed_at is null
           and t.shift_id in (select s from app.my_shift_ids() as s)
       )
     );
$$;

comment on function app.people_basic() is
  'Nombre y foto de las personas que la sesión puede ver (P-103): todas para owner/admin, la propia, los empleados de sus turnos para el supervisor y los compañeros de turno para el empleado. Respalda v_people_basic (0030, DEF-P03).';

-- Clientes visibles con SOLO el nombre (04 sección 7.2: el empleado ve "clientes de sus turnos
-- (solo nombre)"). owner/admin: todos; supervisor: los de sus turnos; empleado: los de sus turnos.
create function app.clients_basic()
returns table (id uuid, legal_name text, trade_name text)
language sql
stable
security definer
rows 50
set search_path = public, app, pg_temp
as $$
  select c.id, c.legal_name, c.trade_name
  from public.clients c
  where (select app.is_admin())
     or (
       c.deleted_at is null
       and (
         ((select app.has_role('supervisor')) and c.id in (select x from app.supervised_client_ids() as x))
         or ((select app.has_role('employee')) and c.id in (select x from app.shared_client_ids() as x))
       )
     );
$$;

comment on function app.clients_basic() is
  'Nombre legal y comercial de los clientes que la sesión puede ver, sin CUIT, domicilio administrativo ni notas internas (04 sección 7.2). Respalda v_clients_basic y v_my_day (0030, DEF-P05).';

-- Quiénes están en cada turno que la sesión comparte (empleado) o supervisa (supervisor), con
-- nombre y foto. Reemplaza la lectura directa de `assignments` que hacía el empleado para armar
-- "compañeros del turno": esa fila trae la observación (assignments.notes), que los compañeros
-- NO ven (P-062, P-103).
create function app.shift_peers()
returns table (shift_id uuid, profile_id uuid, first_name text, last_name text, avatar_path text)
language sql
stable
security definer
rows 100
set search_path = public, app, pg_temp
as $$
  select a.shift_id, p.id, p.first_name, p.last_name, p.avatar_path
  from public.assignments a
  join public.profiles p on p.id = a.employee_id
  where a.removed_at is null
    and (
      ((select app.has_role('employee')) and a.shift_id in (select s from app.my_shift_ids() as s))
      or ((select app.has_role('supervisor')) and a.shift_id in (select s from app.my_supervised_shift_ids() as s))
    );
$$;

comment on function app.shift_peers() is
  'Personas con asignación vigente en los turnos que la sesión comparte (como empleado) o supervisa (como supervisor): turno, persona, nombre y foto (0030, DEF-P06). Respalda v_shift_peers.';

-- Permisos: no son RPC (el esquema app no se expone), pero las políticas y las vistas las
-- ejecutan con el rol de la sesión, así que `authenticated` necesita `execute`.
revoke all on function app.my_shift_ids() from public, anon;
revoke all on function app.my_supervised_shift_ids() from public, anon;
revoke all on function app.my_assignment_ids() from public, anon;
revoke all on function app.supervised_assignment_ids() from public, anon;
revoke all on function app.my_supervision_ids() from public, anon;
revoke all on function app.supervised_client_ids() from public, anon;
revoke all on function app.shared_client_ids() from public, anon;
revoke all on function app.supervised_site_ids() from public, anon;
revoke all on function app.shared_site_ids() from public, anon;
revoke all on function app.people_basic() from public, anon;
revoke all on function app.clients_basic() from public, anon;
revoke all on function app.shift_peers() from public, anon;

grant execute on function app.my_shift_ids() to authenticated;
grant execute on function app.my_supervised_shift_ids() to authenticated;
grant execute on function app.my_assignment_ids() to authenticated;
grant execute on function app.supervised_assignment_ids() to authenticated;
grant execute on function app.my_supervision_ids() to authenticated;
grant execute on function app.supervised_client_ids() to authenticated;
grant execute on function app.shared_client_ids() to authenticated;
grant execute on function app.supervised_site_ids() to authenticated;
grant execute on function app.shared_site_ids() to authenticated;
grant execute on function app.people_basic() to authenticated;
grant execute on function app.clients_basic() to authenticated;
grant execute on function app.shift_peers() to authenticated;

-- Vistas: `security_invoker = true`, como todas. La restricción de filas la hace la función
-- (security definer) y la de columnas, la propia vista.
create or replace view public.v_people_basic
with (security_invoker = true)
as
select pb.profile_id, pb.first_name, pb.last_name, pb.avatar_path
from app.people_basic() pb;

comment on view public.v_people_basic is
  'Nombre y foto de una persona, para mostrar compañeros de turno y personal supervisado sin exponer el resto de profiles (04 sección 7.2, P-103). Desde 0030 (DEF-P03) es la ÚNICA forma de leer personas ajenas para empleado y supervisor: las políticas de profiles que les daban la fila entera se quitaron. Qué filas ve cada rol lo decide app.people_basic(): owner/admin todas, la propia, el supervisor los empleados de sus turnos, el empleado sus compañeros de turno.';

create view public.v_clients_basic
with (security_invoker = true)
as
select cb.id, cb.legal_name, cb.trade_name
from app.clients_basic() cb;

comment on view public.v_clients_basic is
  'Cliente con solo nombre legal y comercial (04 sección 7.2, DEF-P05). Es lo que lee el empleado: la tabla clients (CUIT, domicilio administrativo, notas) ya no le da filas. Filas por rol en app.clients_basic().';

create view public.v_shift_peers
with (security_invoker = true)
as
select sp.shift_id, sp.profile_id, sp.first_name, sp.last_name, sp.avatar_path
from app.shift_peers() sp;

comment on view public.v_shift_peers is
  'Quiénes están asignados (vigentes) en cada turno que la sesión comparte o supervisa, con nombre y foto (P-103, DEF-P06). Para "compañeros del turno" (EMP-04) sin leer assignments, cuya fila incluye la observación de cada empleado (P-062). Incluye a la propia persona; el cliente la descarta.';

-- ---------------------------------------------------------------------------------------------
-- 3. Políticas RLS: funciones de permisos evaluadas una vez, recortes de filas ajenas, DEF-P09 ----
-- ---------------------------------------------------------------------------------------------

-- 3.1 profiles ---------------------------------------------------------------------------------

-- Quitadas: daban la fila ENTERA (teléfono, email de contacto, estado) de compañeros y de
-- empleados supervisados. Ahora se leen por v_people_basic.
drop policy profiles_select_supervisor_team on public.profiles;
drop policy profiles_select_employee_teammates on public.profiles;

alter policy profiles_select_admin on public.profiles
  using ((select app.is_admin()));
alter policy profiles_select_own on public.profiles
  using (id = (select app.current_uid()));
alter policy profiles_update_own on public.profiles
  using (id = (select app.current_uid()))
  with check (id = (select app.current_uid()));
alter policy profiles_update_admin on public.profiles
  using ((select app.is_admin()))
  with check ((select app.is_admin()));

-- 3.2 user_roles, admin_capabilities -----------------------------------------------------------

alter policy user_roles_select_admin on public.user_roles
  using ((select app.is_admin()));
alter policy user_roles_select_own on public.user_roles
  using (profile_id = (select app.current_uid()));
alter policy admin_capabilities_select_owner on public.admin_capabilities
  using ((select app.has_role('owner')));
alter policy admin_capabilities_select_own on public.admin_capabilities
  using (profile_id = (select app.current_uid()));

-- 3.3 employees y tablas de empleado -----------------------------------------------------------

-- Quitada: el supervisor leía DNI, CUIL, domicilio y contacto de emergencia (03 sección 15).
drop policy employees_select_supervisor_team on public.employees;

alter policy employees_select_admin on public.employees
  using ((select app.is_admin()));
alter policy employees_select_own on public.employees
  using (profile_id = (select app.current_uid()));
alter policy employees_insert_admin on public.employees
  with check ((select app.has_capability('manage_users')));
alter policy employees_update_admin on public.employees
  using ((select app.is_admin()))
  with check ((select app.is_admin()));

alter policy employee_client_permissions_select_admin on public.employee_client_permissions
  using ((select app.is_admin()));
alter policy employee_client_permissions_select_own on public.employee_client_permissions
  using (employee_id = (select app.current_uid()));
alter policy employee_client_permissions_write_admin on public.employee_client_permissions
  using ((select app.is_admin()))
  with check ((select app.is_admin()));

alter policy employee_availability_select_admin on public.employee_availability
  using ((select app.is_admin()));
alter policy employee_availability_select_own on public.employee_availability
  using (employee_id = (select app.current_uid()));
alter policy employee_availability_write_admin on public.employee_availability
  using ((select app.is_admin()))
  with check ((select app.is_admin()));

alter policy employee_leaves_select_admin on public.employee_leaves
  using ((select app.is_admin()));
alter policy employee_leaves_select_own on public.employee_leaves
  using (employee_id = (select app.current_uid()) and deleted_at is null);
alter policy employee_leaves_write_admin on public.employee_leaves
  using ((select app.is_admin()))
  with check ((select app.is_admin()));

-- 3.4 clients, client_contacts, sites ----------------------------------------------------------

alter policy clients_select_admin on public.clients
  using ((select app.is_admin()));
-- Solo el supervisor: el empleado lee el nombre del cliente por v_clients_basic (DEF-P05).
alter policy clients_select_shift_party on public.clients
  using (
    deleted_at is null
    and (select app.has_role('supervisor'))
    and id in (select x from app.supervised_client_ids() as x)
  );
alter policy clients_write_admin on public.clients
  using ((select app.is_admin()))
  with check ((select app.is_admin()));

alter policy client_contacts_select_admin on public.client_contacts
  using ((select app.is_admin()));
alter policy client_contacts_select_shift_party on public.client_contacts
  using (
    deleted_at is null
    and (select app.has_role('supervisor'))
    and client_id in (
      select c.id
      from public.clients c
      where c.deleted_at is null
        and c.id in (select x from app.supervised_client_ids() as x)
    )
  );
alter policy client_contacts_write_admin on public.client_contacts
  using ((select app.is_admin()))
  with check ((select app.is_admin()));

alter policy sites_select_admin on public.sites
  using ((select app.is_admin()));
alter policy sites_select_shift_party on public.sites
  using (
    deleted_at is null
    and (
      ((select app.has_role('supervisor')) and id in (select x from app.supervised_site_ids() as x))
      or ((select app.has_role('employee')) and id in (select x from app.shared_site_ids() as x))
    )
  );
alter policy sites_write_admin on public.sites
  using ((select app.is_admin()))
  with check ((select app.is_admin()));

-- 3.5 services, shifts, assignments, shift_tasks -----------------------------------------------

alter policy services_select_admin on public.services
  using ((select app.is_admin()));
alter policy services_write_admin on public.services
  using ((select app.is_admin()))
  with check ((select app.is_admin()));

alter policy shifts_select_admin on public.shifts
  using ((select app.is_admin()));
alter policy shifts_select_supervisor on public.shifts
  using (
    deleted_at is null
    and (select app.has_role('supervisor'))
    and id in (select s from app.my_supervised_shift_ids() as s)
  );
alter policy shifts_select_employee on public.shifts
  using (
    deleted_at is null
    and (select app.has_role('employee'))
    and id in (select s from app.my_shift_ids() as s)
  );

alter policy assignments_select_admin on public.assignments
  using ((select app.is_admin()));
alter policy assignments_select_supervisor on public.assignments
  using (
    (select app.has_role('supervisor'))
    and shift_id in (select s from app.my_supervised_shift_ids() as s)
  );
-- Solo las propias (vigentes): los compañeros se leen por v_shift_peers, sin la observación
-- ajena (DEF-P06, P-062). La escritura directa de `notes` ya no existe (0026: solo la RPC
-- set_assignment_notes).
alter policy assignments_select_employee on public.assignments
  using (
    (select app.has_role('employee'))
    and employee_id = (select auth.uid())
    and removed_at is null
  );

alter policy shift_tasks_select_admin on public.shift_tasks
  using ((select app.is_admin()));
alter policy shift_tasks_select_supervisor on public.shift_tasks
  using (
    (select app.has_role('supervisor'))
    and shift_id in (select s from app.my_supervised_shift_ids() as s)
  );
alter policy shift_tasks_select_employee on public.shift_tasks
  using (
    (select app.has_role('employee'))
    and shift_id in (select s from app.my_shift_ids() as s)
  );

-- 3.6 asistencia -------------------------------------------------------------------------------

alter policy attendance_records_select_admin on public.attendance_records
  using ((select app.is_admin()));
alter policy attendance_records_select_supervisor on public.attendance_records
  using (
    (select app.has_role('supervisor'))
    and assignment_id in (select x from app.supervised_assignment_ids() as x)
  );
alter policy attendance_records_select_employee on public.attendance_records
  using (
    (select app.has_role('employee'))
    and assignment_id in (select x from app.my_assignment_ids() as x)
  );

alter policy attendance_notices_select_admin on public.attendance_notices
  using ((select app.is_admin()));
alter policy attendance_notices_select_supervisor on public.attendance_notices
  using (
    (select app.has_role('supervisor'))
    and assignment_id in (select x from app.supervised_assignment_ids() as x)
  );
alter policy attendance_notices_select_employee on public.attendance_notices
  using (
    (select app.has_role('employee'))
    and assignment_id in (select x from app.my_assignment_ids() as x)
  );

-- 3.7 plantillas de tareas ---------------------------------------------------------------------

alter policy checklist_templates_select_admin on public.checklist_templates
  using ((select app.is_admin()));
alter policy checklist_templates_write_admin on public.checklist_templates
  using ((select app.has_capability('edit_checklists')))
  with check ((select app.has_capability('edit_checklists')));
alter policy checklist_template_items_select_admin on public.checklist_template_items
  using ((select app.is_admin()));
alter policy checklist_template_items_write_admin on public.checklist_template_items
  using ((select app.has_capability('edit_checklists')))
  with check ((select app.has_capability('edit_checklists')));

-- 3.8 supervisiones y calificaciones -----------------------------------------------------------

alter policy supervisions_select_admin on public.supervisions
  using ((select app.is_admin()));
alter policy supervisions_select_own on public.supervisions
  using ((select app.has_role('supervisor')) and supervisor_id = (select auth.uid()));
alter policy supervision_attendance_select_admin on public.supervision_attendance
  using ((select app.is_admin()));
alter policy supervision_attendance_select_own on public.supervision_attendance
  using (
    (select app.has_role('supervisor'))
    and supervision_id in (select x from app.my_supervision_ids() as x)
  );
alter policy ratings_select_admin on public.ratings
  using ((select app.is_admin()));
alter policy ratings_select_own_supervision on public.ratings
  using (
    (select app.has_role('supervisor'))
    and supervision_id in (select x from app.my_supervision_ids() as x)
  );
alter policy rating_criteria_select_staff on public.rating_criteria
  using ((select app.is_admin()) or (select app.has_role('supervisor')));
alter policy rating_criteria_write_owner on public.rating_criteria
  using ((select app.has_role('owner')))
  with check ((select app.has_role('owner')));

-- 3.9 configuración: feriados y empresa (DEF-P09) ------------------------------------------------

-- "Todos los autenticados" ahora exige además que el perfil siga activo: una cuenta desactivada
-- con el token todavía vigente (hasta 15 minutos) ya no lee feriados ni la configuración
-- completa. `anon` sigue viendo lo suyo por v_public_branding (grant por columnas de 0017).
alter policy holidays_select_authenticated on public.holidays
  using (deleted_at is null and (select app.current_profile_active()));
alter policy holidays_write_owner on public.holidays
  using ((select app.has_role('owner')))
  with check ((select app.has_role('owner')));
alter policy company_settings_select_authenticated on public.company_settings
  using ((select app.current_profile_active()));
alter policy company_settings_update_admin on public.company_settings
  using ((select app.is_admin()))
  with check ((select app.is_admin()));
alter policy security_events_select_owner on public.security_events
  using ((select app.has_role('owner')));

-- ---------------------------------------------------------------------------------------------
-- 4. profiles: quién puede desactivar o editar a quién (DEF-P13) -------------------------------
-- ---------------------------------------------------------------------------------------------

-- La política profiles_update_admin deja pasar a cualquier owner/admin y el grant de columnas es
-- amplio (0017: lo necesitan owner/admin para editar cualquier perfil), así que un administrador
-- SIN capacidades podía hacer `update profiles set is_active = false` a quien quisiera, dueño
-- incluido. Esta regla (BEFORE UPDATE, igual criterio que la Edge Function admin-users, 06
-- sección 2.1 y 03 sección 6) la cierra:
--   - Solo corre para sesiones de usuario (auth.uid() no nulo): la Edge Function (service_role) y
--     el SQL administrativo (postgres) quedan afuera, como en el trigger de columnas propias.
--   - La propia fila: nadie se desactiva ni se reactiva a sí mismo por esta vía.
--   - Fila ajena: un administrador no actúa sobre un administrador ni sobre un dueño (solo el
--     dueño); `location_consent_at` y `last_seen_changes_at` son de cada persona; cambiar
--     `is_active` o `deleted_at` exige la capacidad manage_users (el dueño siempre la tiene);
--     reactivar es solo del dueño; desactivar al último dueño activo es LAST_OWNER.
-- Qué columnas puede cambiar un administrador sobre otra persona: nombre, email de contacto,
-- teléfono y foto (el grant de 0017 ya excluye el resto) y, con manage_users, el estado.
create function app.enforce_profile_admin_update_rules()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_target_privileged boolean;
  v_other_owners int;
begin
  if auth.uid() is null then
    return new;
  end if;

  if auth.uid() = old.id then
    if new.is_active is distinct from old.is_active
      or new.deleted_at is distinct from old.deleted_at
    then
      raise exception using
        errcode = 'P0001',
        message = 'No podés desactivar ni reactivar tu propia cuenta.',
        hint = 'FORBIDDEN';
    end if;
    return new;
  end if;

  select exists (
    select 1 from public.user_roles ur
    where ur.profile_id = old.id and ur.role in ('owner', 'admin')
  ) into v_target_privileged;

  if v_target_privileged and not app.has_role('owner') then
    raise exception using
      errcode = 'P0001',
      message = 'Solo el dueño puede modificar a un dueño o a un administrador.',
      hint = 'FORBIDDEN';
  end if;

  if new.location_consent_at is distinct from old.location_consent_at
    or new.last_seen_changes_at is distinct from old.last_seen_changes_at
  then
    raise exception using
      errcode = 'P0001',
      message = 'Ese dato lo edita solo la propia persona.',
      hint = 'FORBIDDEN';
  end if;

  if new.is_active is distinct from old.is_active
    or new.deleted_at is distinct from old.deleted_at
  then
    if not app.has_capability('manage_users') then
      raise exception using
        errcode = 'P0001',
        message = 'No tenés permiso para hacer esto.',
        hint = 'FORBIDDEN';
    end if;

    if (new.is_active and not old.is_active)
      or (old.deleted_at is not null and new.deleted_at is null)
    then
      if not app.has_role('owner') then
        raise exception using
          errcode = 'P0001',
          message = 'Solo el dueño puede reactivar una cuenta.',
          hint = 'FORBIDDEN';
      end if;
    end if;

    if (not new.is_active or new.deleted_at is not null)
      and exists (select 1 from public.user_roles ur where ur.profile_id = old.id and ur.role = 'owner')
    then
      select count(*) into v_other_owners
      from public.user_roles ur
      join public.profiles p on p.id = ur.profile_id
      where ur.role = 'owner'
        and ur.profile_id <> old.id
        and p.is_active
        and p.deleted_at is null;
      if v_other_owners = 0 then
        raise exception using
          errcode = 'P0001',
          message = 'No se puede quitar al último dueño.',
          hint = 'LAST_OWNER';
      end if;
    end if;
  end if;

  return new;
end;
$$;

comment on function app.enforce_profile_admin_update_rules() is
  'Trigger BEFORE UPDATE en profiles (0030, DEF-P13): reglas de quién edita o desactiva a quién cuando el update lo hace una sesión de usuario sobre otra persona (03 sección 6, P-017, 06 sección 2.1). Admin no actúa sobre admin ni dueño; manage_users para cambiar is_active/deleted_at; reactivar solo el dueño; LAST_OWNER; consentimiento y última visita son de cada persona; nadie cambia su propio estado por esta vía. service_role y postgres (auth.uid() nulo) quedan afuera: es el camino de la Edge Function admin-users.';

create trigger trg_enforce_profile_admin_update_rules
before update on public.profiles
for each row execute function app.enforce_profile_admin_update_rules();

-- ---------------------------------------------------------------------------------------------
-- 5. company_settings: el administrador solo cambia el logo (DEF-P01) ----------------------------
-- ---------------------------------------------------------------------------------------------

-- 03 sección 6: nombre, teléfono y consentimiento son del dueño; "subir logo" es de dueño y
-- administrador. La política deja actualizar a ambos (no puede comparar columnas), así que lo
-- cierra este trigger.
create function app.enforce_company_settings_columns()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  if auth.uid() is not null and not app.has_role('owner') then
    if new.name is distinct from old.name
      or new.support_phone is distinct from old.support_phone
      or new.location_consent_text is distinct from old.location_consent_text
    then
      raise exception using
        errcode = 'P0001',
        message = 'Solo el dueño puede cambiar el nombre, el teléfono y el consentimiento. Podés cambiar el logo.',
        hint = 'FORBIDDEN';
    end if;
  end if;
  return new;
end;
$$;

comment on function app.enforce_company_settings_columns() is
  'Trigger BEFORE UPDATE en company_settings (0030, DEF-P01): una sesión que no es owner solo puede cambiar logo_path (y updated_by/updated_at). 03 sección 6. service_role y postgres quedan afuera.';

create trigger trg_enforce_company_settings_columns
before update on public.company_settings
for each row execute function app.enforce_company_settings_columns();

-- ---------------------------------------------------------------------------------------------
-- 6. v_my_day: incluye los turnos cancelados (DEF-01, P-049, CB-03) y lee el cliente recortado ---
-- ---------------------------------------------------------------------------------------------

-- Cambios respecto de 0028, mismas columnas y mismo orden:
--   - Se quita `sh.status <> 'cancelled'`: el empleado VE el turno cancelado en Hoy. El indicador
--     es `shift_status = 'cancelled'` (columna que ya existía). Además `changed_since_last_seen`
--     se enciende solo hasta que abre Hoy (cancel_shift no fija updated_by: es un cambio ajeno).
--   - El cliente se lee de v_clients_basic (nombre solamente), no de la tabla `clients`.
create or replace view public.v_my_day
with (security_invoker = true)
as
select
  a.id as assignment_id,
  a.shift_id,
  sh.shift_date,
  (sh.shift_date = app.today()) as is_today,
  sh.client_id,
  cl.legal_name as client_legal_name,
  cl.trade_name as client_trade_name,
  sh.site_id,
  si.name as site_name,
  si.address as site_address,
  si.contact_name as site_contact_name,
  si.contact_phone as site_contact_phone,
  si.access_instructions,
  si.building_hours,
  si.phone_restricted,
  si.photos_not_allowed,
  si.restrictions_notes,
  coalesce(a.start_time, sh.start_time) as effective_start_time,
  coalesce(a.end_time, sh.end_time) as effective_end_time,
  lower(a."window") as effective_starts_at,
  upper(a."window") as effective_ends_at,
  a.status,
  sh.status as shift_status,
  a.notes,
  coalesce(tasks.tasks_total, 0) as tasks_total,
  coalesce(tasks.tasks_done, 0) as tasks_done,
  (
    (
      coalesce(a.updated_at, a.created_at) > coalesce(p.last_seen_changes_at, '-infinity'::timestamptz)
      and (a.updated_at is null or a.updated_by is distinct from a.employee_id)
    )
    or
    (
      coalesce(sh.updated_at, sh.created_at) > coalesce(p.last_seen_changes_at, '-infinity'::timestamptz)
      and (sh.updated_at is null or sh.updated_by is distinct from a.employee_id)
    )
  ) as changed_since_last_seen,
  ci.recorded_at as check_in_at,
  co.recorded_at as check_out_at,
  si.city as site_city,
  si.latitude as site_latitude,
  si.longitude as site_longitude,
  ci.source as check_in_source,
  ci.recorded_by as check_in_recorded_by,
  co.source as check_out_source,
  co.recorded_by as check_out_recorded_by,
  notice.kind as last_notice_kind,
  notice.minutes_late as last_notice_minutes_late,
  notice.reason_code as last_notice_reason_code,
  notice.reason_text as last_notice_reason_text,
  notice.reported_by as last_notice_reported_by,
  notice.source as last_notice_source,
  notice.created_at as last_notice_at
from public.assignments a
join public.shifts sh on sh.id = a.shift_id
join public.v_clients_basic cl on cl.id = sh.client_id
join public.sites si on si.id = sh.site_id
join public.profiles p on p.id = a.employee_id
left join lateral (
  select
    count(*) as tasks_total,
    count(*) filter (where st.status = 'done') as tasks_done
  from public.shift_tasks st
  where st.shift_id = a.shift_id
) tasks on true
left join public.attendance_records ci on ci.assignment_id = a.id and ci.kind = 'check_in'
left join public.attendance_records co on co.assignment_id = a.id and co.kind = 'check_out'
left join lateral (
  select an.kind, an.minutes_late, an.reason_code, an.reason_text, an.reported_by, an.source, an.created_at
  from public.attendance_notices an
  where an.assignment_id = a.id
  order by an.created_at desc
  limit 1
) notice on true
where a.employee_id = auth.uid()
  and a.removed_at is null
  and sh.shift_date between app.today() and app.today() + 7;

comment on view public.v_my_day is
  'Pantalla Hoy del empleado (04 sección 4, P-092, P-093): asignaciones propias de hoy y los próximos 7 días. Desde 0030 (DEF-01, P-049, CB-03) INCLUYE los turnos cancelados: el indicador es shift_status = ''cancelled'' (el empleado los ve cancelados, no desaparecen); las RPC de asistencia ya los rechazan con SHIFT_CANCELLED. changed_since_last_seen compara, por separado, el último cambio de la asignación y el del turno contra profiles.last_seen_changes_at (P-092) y IGNORA el cambio si quien lo hizo (updated_by) es el mismo empleado dueño de la asignación (0028, P14.2); la asignación nueva sigue contando siempre por created_at. Límite conocido de 0028: updated_at/updated_by son una sola pareja de columnas por fila, así que un cambio de administración no visto, seguido de una acción propia sobre la MISMA fila antes de abrir Hoy, puede apagar el cartel para ese cambio puntual (el dato es siempre el vigente). is_today distingue el bloque "hoy en detalle" de la lista de próximos días (P-093). check_in_at/check_out_at (0026), site_city/site_latitude/site_longitude y check_*_source/recorded_by y last_notice_* (0027). El cliente se lee de v_clients_basic (solo nombre, 0030, DEF-P05). Filtra employee_id = auth.uid() en la definición; security_invoker: además queda sujeta a la RLS de assignments/shifts/sites/attendance_records/attendance_notices.';

-- ---------------------------------------------------------------------------------------------
-- 7. v_my_supervisions: nombres de los empleados por la vista recortada ---------------------------
-- ---------------------------------------------------------------------------------------------

-- Igual que 0029 salvo `join public.profiles p2` -> `join public.v_people_basic p2`: el supervisor
-- ya no lee la fila entera de profiles de los empleados de su turno (DEF-P03).
create or replace view public.v_my_supervisions
with (security_invoker = true)
as
select
  sv.id,
  sv.shift_id,
  sh.shift_date,
  sh.client_id,
  cl.legal_name as client_legal_name,
  sh.site_id,
  si.name as site_name,
  si.address as site_address,
  sh.start_time,
  sh.end_time,
  sh.starts_at,
  sh.ends_at,
  sv.status,
  sv.assigned_at,
  sv.not_done_reason,
  sv.cancel_reason,
  sv.general_notes,
  sv.criteria_snapshot,
  ci.recorded_at as check_in_at,
  co.recorded_at as check_out_at,
  coalesce(emp.employees, '[]'::jsonb) as assigned_employees,
  si.city as site_city,
  si.latitude as site_latitude,
  si.longitude as site_longitude,
  si.contact_name as site_contact_name,
  si.contact_phone as site_contact_phone,
  si.access_instructions as site_access_instructions,
  si.building_hours as site_building_hours,
  si.phone_restricted as site_phone_restricted,
  si.photos_not_allowed as site_photos_not_allowed,
  si.restrictions_notes as site_restrictions_notes
from public.supervisions sv
join public.shifts sh on sh.id = sv.shift_id
join public.clients cl on cl.id = sh.client_id
join public.sites si on si.id = sh.site_id
left join public.supervision_attendance ci on ci.supervision_id = sv.id and ci.kind = 'check_in'
left join public.supervision_attendance co on co.supervision_id = sv.id and co.kind = 'check_out'
left join lateral (
  select jsonb_agg(
      jsonb_build_object(
        'employee_id', a.employee_id,
        'first_name', p2.first_name,
        'last_name', p2.last_name,
        'status', a.status,
        'check_in_at', ar.recorded_at
      )
      order by p2.last_name, p2.first_name
    ) as employees
  from public.assignments a
  join public.v_people_basic p2 on p2.profile_id = a.employee_id
  left join public.attendance_records ar on ar.assignment_id = a.id and ar.kind = 'check_in'
  where a.shift_id = sv.shift_id
    and a.removed_at is null
) emp on true
where sv.supervisor_id = auth.uid();

comment on view public.v_my_supervisions is
  'Pantallas del supervisor: Hoy, próximos, detalle e historial (04 sección 4, SUP-02/03/07/08). Filtra supervisor_id = auth.uid() en la definición. assigned_employees: jsonb con los empleados asignados vigentes del turno (nombre, estado y check_in_at -- "inicio real", 0029, SUP-03); desde 0030 el nombre sale de v_people_basic y no de la tabla profiles (DEF-P03). site_city/site_latitude/site_longitude/site_contact_name/site_contact_phone/site_access_instructions/site_building_hours/site_phone_restricted/site_photos_not_allowed/site_restrictions_notes (0029, SUP-006). security_invoker: además queda sujeta a la RLS de supervisions/shifts/clients/sites/assignments.';

-- ---------------------------------------------------------------------------------------------
-- 8. update_shift_time: el mensaje de superposición nombra al empleado (DEF-03, CB-10) ----------
-- ---------------------------------------------------------------------------------------------

-- Igual que 0028 salvo el manejo de exclusion_violation: se calcula qué asignaciones vigentes
-- del turno quedarían pisadas con la franja nueva (misma cuenta que app.sync_assignment_window,
-- 0016) y se agrega "Afecta a: Nombre Apellido." al mensaje. El texto original queda como prefijo
-- para no romper lo que ya lo muestra o lo busca. El código sigue siendo ASSIGNMENT_OVERLAP.
create or replace function public.update_shift_time(p_shift_id uuid, p_start time, p_end time)
returns public.shifts
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_shift public.shifts;
  v_names text;
begin
  perform app.require_role('owner', 'admin');

  select * into v_shift from public.shifts where id = p_shift_id;

  if v_shift.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos ese turno.',
      hint = 'SHIFT_NOT_FOUND';
  end if;

  if v_shift.status = 'cancelled' then
    raise exception using
      errcode = 'P0001',
      message = 'Este turno está cancelado.',
      hint = 'SHIFT_CANCELLED';
  end if;

  if v_shift.status = 'completed' then
    raise exception using
      errcode = 'P0001',
      message = 'Este turno ya terminó.',
      hint = 'SHIFT_COMPLETED';
  end if;

  if p_end <= p_start then
    raise exception using
      errcode = 'P0001',
      message = 'La hora de fin tiene que ser posterior a la de inicio.',
      hint = 'INVALID_TIME_RANGE';
  end if;

  if v_shift.status = 'in_progress' and p_start is distinct from v_shift.start_time then
    raise exception using
      errcode = 'P0001',
      message = 'El turno ya está en curso: solo se puede cambiar la hora de fin.',
      hint = 'SHIFT_NOT_EDITABLE';
  end if;

  begin
    update public.shifts
    set start_time = p_start, end_time = p_end, updated_by = auth.uid()
    where id = p_shift_id
    returning * into v_shift;
  exception
    when exclusion_violation then
      -- La actualización ya se deshizo (subtransacción del bloque): v_shift conserva el turno
      -- anterior, que es lo que hace falta para la fecha.
      select string_agg(p.first_name || ' ' || p.last_name, ', ' order by p.last_name, p.first_name)
      into v_names
      from public.assignments a
      join public.profiles p on p.id = a.employee_id
      where a.shift_id = p_shift_id
        and a.removed_at is null
        and exists (
          select 1
          from public.assignments b
          where b.employee_id = a.employee_id
            and b.id <> a.id
            and b.removed_at is null
            and b."window" && tstzrange(
              app.local_ts(v_shift.shift_date, coalesce(a.start_time, p_start)),
              app.local_ts(v_shift.shift_date, coalesce(a.end_time, p_end)),
              '[)'
            )
        );

      raise exception using
        errcode = 'P0001',
        message = case
          when v_names is null then 'El empleado ya tiene otro turno en ese horario.'
          else 'El empleado ya tiene otro turno en ese horario. Afecta a: ' || v_names || '.'
        end,
        hint = 'ASSIGNMENT_OVERLAP';
  end;

  return v_shift;
end;
$$;

comment on function public.update_shift_time(uuid, time, time) is
  'Cambia la franja de un turno (04 sección 6.1, 9; 06 sección 7). O, A. SHIFT_CANCELLED/SHIFT_COMPLETED si el turno no admite cambios; SHIFT_NOT_EDITABLE si está in_progress y se intenta cambiar el inicio; INVALID_TIME_RANGE. El trigger de 0007 recalcula la ventana de las asignaciones vigentes; si eso las deja superpuestas, se traduce el exclusion_violation crudo (23P01) a ASSIGNMENT_OVERLAP. Desde 0030 (DEF-03, CB-10) el mensaje nombra a quien queda superpuesto: "El empleado ya tiene otro turno en ese horario. Afecta a: Nombre Apellido." Desde 0028 fija updated_by = auth.uid().';

-- ---------------------------------------------------------------------------------------------
-- 9. mark_changes_seen: rechaza a una cuenta desactivada (DEF-P12) -------------------------------
-- ---------------------------------------------------------------------------------------------

create or replace function public.mark_changes_seen()
returns public.profiles
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_row public.profiles;
begin
  if not app.current_profile_active() then
    raise exception using
      errcode = 'P0001',
      message = 'No tenés permiso para hacer esto.',
      hint = 'FORBIDDEN';
  end if;

  update public.profiles
  set last_seen_changes_at = now()
  where id = auth.uid()
  returning * into v_row;

  if v_row.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos tu perfil.',
      hint = 'PROFILE_NOT_FOUND';
  end if;

  return v_row;
end;
$$;

comment on function public.mark_changes_seen() is
  'Actualiza profiles.last_seen_changes_at = now() para la persona autenticada (P-092). Sin parámetros: siempre sobre la propia fila. El frontend la llama al abrir Hoy, no al iniciar sesión (06_API.md sección 1). Desde 0030 (DEF-P12) responde FORBIDDEN si el perfil está desactivado o borrado (ventana de revocación del token, app.current_profile_active()).';

-- ---------------------------------------------------------------------------------------------
-- 10. Storage -----------------------------------------------------------------------------------
-- ---------------------------------------------------------------------------------------------

-- avatars (DEF-P07 = SEG-01): avatars_select_public daba `select` a `anon` y `authenticated`
-- sobre TODO el bucket, o sea, cualquiera listaba las carpetas (que son los profile_id) y bajaba
-- cada foto. El bucket es `public`: las fotos se siguen sirviendo por /object/public/... sin
-- pasar por RLS (así las muestra la app, con getPublicUrl). La política de `select` queda solo
-- para la propia carpeta y para owner/admin (hace falta para upsert y para borrar).
drop policy avatars_select_public on storage.objects;

create policy avatars_select_own_or_admin
  on storage.objects for select to authenticated
  using (
    bucket_id = 'avatars'
    and (
      (select app.is_admin())
      or (storage.foldername(name))[1] = (select app.current_uid())::text
    )
  );

-- DEF-P10: la carpeta propia exige perfil activo (app.current_uid() es null si no lo está).
drop policy avatars_insert_own_or_admin on storage.objects;
create policy avatars_insert_own_or_admin
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (
      (select app.is_admin())
      or (storage.foldername(name))[1] = (select app.current_uid())::text
    )
  );

drop policy avatars_update_own_or_admin on storage.objects;
create policy avatars_update_own_or_admin
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (
      (select app.is_admin())
      or (storage.foldername(name))[1] = (select app.current_uid())::text
    )
  )
  with check (
    bucket_id = 'avatars'
    and (
      (select app.is_admin())
      or (storage.foldername(name))[1] = (select app.current_uid())::text
    )
  );

drop policy avatars_delete_own_or_admin on storage.objects;
create policy avatars_delete_own_or_admin
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (
      (select app.is_admin())
      or (storage.foldername(name))[1] = (select app.current_uid())::text
    )
  );

drop policy branding_write_admin on storage.objects;
create policy branding_write_admin
  on storage.objects for all to authenticated
  using (bucket_id = 'branding' and (select app.is_admin()))
  with check (bucket_id = 'branding' and (select app.is_admin()));

-- branding (SEG-02): sin SVG. Un SVG con script no se ejecuta dentro de <img>, pero sí si se abre
-- su URL directa en el origen de Storage. El logo actual de App_dev no está cargado (logo_path
-- null) y el seed no trae SVG, así que no hay nada que migrar.
update storage.buckets
set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp']
where id = 'branding';

-- ---------------------------------------------------------------------------------------------
-- 11. rls_auto_enable() (DEF-P11 = SEG-08) ------------------------------------------------------
-- ---------------------------------------------------------------------------------------------

-- La crea la plataforma (disparador de eventos "RLS automática"), no esta base de migraciones,
-- y viene ejecutable por public, anon y authenticated: quedaba expuesta como RPC. Ninguna parte
-- de la app la llama. El disparador de eventos no necesita estos `execute`.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 12. security_event_type: admin_action_rejected (SEG-03) ---------------------------------------
-- ---------------------------------------------------------------------------------------------

-- La Edge Function admin-users registra con este tipo los intentos que rechaza después de saber
-- quién es la persona (FORBIDDEN, validación, no encontrada, etc.), para que el límite de 10
-- acciones por minuto cuente también los intentos fallidos y para dejar rastro de quién prueba
-- lo que no le corresponde. `details` trae { action, hint }.
alter type public.security_event_type add value if not exists 'admin_action_rejected';
