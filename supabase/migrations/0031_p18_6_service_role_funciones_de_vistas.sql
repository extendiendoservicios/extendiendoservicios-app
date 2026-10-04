-- P18.6, corrección de 0030 detectada al correr la matriz de permisos: las vistas recortadas
-- (v_people_basic, v_clients_basic, v_shift_peers) y las que las usan (v_my_day,
-- v_my_supervisions) leen funciones del esquema `app` que 0030 dejó ejecutables solo por
-- `authenticated`. La clave de servicio (`service_role`) ya no podía consultarlas y tampoco las
-- vistas que dependen de ellas, que antes leía sin problema porque la RLS no le aplica.
--
-- Esta migración (una nueva, porque 0030 ya está aplicada en App_dev):
--   1. Le da `execute` a `service_role` sobre las doce funciones de 0030.
--   2. Hace que people_basic(), clients_basic() y shift_peers() devuelvan TODAS las filas cuando
--      la sesión es de `service_role` (JWT con role = 'service_role'): el mismo comportamiento que
--      tenía antes sobre las tablas, donde la RLS no le aplica. No agrega ningún privilegio nuevo:
--      `service_role` ya lee `profiles`, `clients` y `assignments` completos. Un `authenticated`
--      no puede hacerse pasar por él (el rol sale del JWT firmado).

-- 1. Permisos -----------------------------------------------------------------------------------

grant execute on function app.my_shift_ids() to service_role;
grant execute on function app.my_supervised_shift_ids() to service_role;
grant execute on function app.my_assignment_ids() to service_role;
grant execute on function app.supervised_assignment_ids() to service_role;
grant execute on function app.my_supervision_ids() to service_role;
grant execute on function app.supervised_client_ids() to service_role;
grant execute on function app.shared_client_ids() to service_role;
grant execute on function app.supervised_site_ids() to service_role;
grant execute on function app.shared_site_ids() to service_role;
grant execute on function app.people_basic() to service_role;
grant execute on function app.clients_basic() to service_role;
grant execute on function app.shift_peers() to service_role;

-- 2. service_role ve todo, como en las tablas --------------------------------------------------

create or replace function app.people_basic()
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
     or (select auth.role()) = 'service_role'
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
  'Nombre y foto de las personas que la sesión puede ver (P-103): todas para owner/admin y para service_role, la propia, los empleados de sus turnos para el supervisor y los compañeros de turno para el empleado. Respalda v_people_basic (0030, DEF-P03; service_role desde 0031).';

create or replace function app.clients_basic()
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
     or (select auth.role()) = 'service_role'
     or (
       c.deleted_at is null
       and (
         ((select app.has_role('supervisor')) and c.id in (select x from app.supervised_client_ids() as x))
         or ((select app.has_role('employee')) and c.id in (select x from app.shared_client_ids() as x))
       )
     );
$$;

comment on function app.clients_basic() is
  'Nombre legal y comercial de los clientes que la sesión puede ver, sin CUIT, domicilio administrativo ni notas (04 sección 7.2): todos para owner/admin y service_role, los de sus turnos para supervisor y empleado. Respalda v_clients_basic y v_my_day (0030, DEF-P05; service_role desde 0031).';

create or replace function app.shift_peers()
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
      (select auth.role()) = 'service_role'
      or ((select app.has_role('employee')) and a.shift_id in (select s from app.my_shift_ids() as s))
      or ((select app.has_role('supervisor')) and a.shift_id in (select s from app.my_supervised_shift_ids() as s))
    );
$$;

comment on function app.shift_peers() is
  'Personas con asignación vigente en los turnos que la sesión comparte (como empleado) o supervisa (como supervisor): turno, persona, nombre y foto (0030, DEF-P06); todas las asignaciones vigentes para service_role (0031). Respalda v_shift_peers.';
