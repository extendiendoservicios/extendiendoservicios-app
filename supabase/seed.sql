-- supabase/seed.sql — DB-019 (08_Fases_y_Backlog.md, F4 · Modelo de datos y RLS base)
--
-- Datos ficticios de `App_dev` (desarrollo y staging, ADR-014): 04_Modelo_de_Datos.md sección 10,
-- "Seed ficticio del mockup con escenarios preparados por fecha relativa a hoy" (03 sección
-- 14.3). NO es para `App` (producción): ese seed, mínimo y parametrizado, es
-- `supabase/seed-prod.sql` (DB-020).
--
-- Orden de ejecución (docs/database.md, "Tipos para el frontend" / `pnpm db:seed`):
--   1. `pnpm db:seed:users` (scripts/seed-dev.ts): crea las 14 personas en `auth.users` por la
--      Admin API (nunca por SQL). El trigger `app.handle_new_user()` (0003) crea la fila espejo
--      en `public.profiles` de cada una.
--   2. `pnpm db:seed:data` (este archivo, `supabase db query --linked -f supabase/seed.sql`):
--      busca esos perfiles por email y carga roles, capacidades, datos laborales, clientes,
--      sedes, servicios, turnos, asignaciones, asistencia, checklists, supervisiones y, desde
--      P25.1, el catálogo de insumos con su historia de stock (bloque 12).
--
-- Idempotente: el bloque 1 trunca (en cascada) todo lo que este archivo vuelve a poblar, así que
-- correrlo varias veces sobre `App_dev` no duplica nada -- necesario porque `App_dev` también es
-- staging (ADR-014, docs/environments.md: "Testing: seed ficticio recreado por corrida").
-- `auth.users`/`profiles`/`user_roles`/`admin_capabilities`/`employees` NO se truncan acá (no
-- dependen de `clients`): se recargan por upsert (`on conflict do nothing/update`) para no perder
-- ni recrear cuentas de Auth ya creadas por `scripts/seed-dev.ts`.
--
-- Personas, clientes, sedes y legajos: nombres tomados de `Mockup/screens_personas.py`,
-- `screens_planificacion.py`, `screens_asistencia.py`, `screens_incidencias.py`,
-- `screens_reportes.py` y `screens_sistema.py` (el código Python que genera el mockup real,
-- fuente más precisa que las capturas -- ver `01_Auditoria_Inicial.md`). Lo que el mockup no
-- cubre (algunas direcciones de sede, Textil Morán completo -- no aparece en el mockup, el
-- modelo lo agrega en 04 sección 10 sin detalle -- y el décimo empleado, el mockup solo nombra
-- nueve con legajo) se completó con datos ficticios de estilo consistente; decisión menor
-- documentada en el reporte de la tarea.
--
-- Fechas relativas a "hoy" (`app.today()`, hora de Argentina vía `app.local_ts`): este archivo
-- no tiene fechas fijas para turnos ni asistencia, así que sirve igual sin importar cuándo se
-- corra (03 sección 14.3).

begin;

-- =================================================================================================
-- 0 bis. Salvaguarda de entorno (revisión del orquestador, P04.6).
--
-- El `truncate ... cascade` de abajo es destructivo, y `scripts/seed-dev.ts` no puede protegerlo:
-- el script mira la URL del proyecto, pero este archivo se puede correr por cualquier vía
-- (`supabase db query`, el editor SQL del panel, psql) contra cualquier base. La verificación de
-- los 14 usuarios que está más abajo ya alcanzaría para que todo revierta, porque el archivo es
-- una sola transacción, pero llega DESPUÉS del truncate y depende de que nadie parta el archivo
-- en pedazos. Así que se verifica antes y de forma explícita.
--
-- Criterio: este seed es para una base que solo tiene sus propias cuentas ficticias. Si aparece
-- un usuario de Auth que no está en la lista de 14, es una base con gente de verdad -- `App`
-- (producción) o `App_dev` con datos que alguien cargó a mano -- y no se toca nada.
-- =================================================================================================

do $$
declare
  v_ajenos int;
  v_ejemplo text;
begin
  select count(*), min(u.email) into v_ajenos, v_ejemplo
  from auth.users u
  where lower(u.email) not in (
    'extserviciosapp@gmail.com',
    'andrea.rios@extendiendoservicios.com',
    'paula.lemos@extendiendoservicios.com',
    'noelia.vera@extendiendoservicios.com',
    'maria.gomez@extendiendoservicios.com',
    'juan.perez@extendiendoservicios.com',
    'sofia.ruiz@extendiendoservicios.com',
    'carlos.medina@extendiendoservicios.com',
    'lucia.torres@extendiendoservicios.com',
    'rocio.aguirre@extendiendoservicios.com',
    'valeria.paz@extendiendoservicios.com',
    'diego.fabbri@extendiendoservicios.com',
    'martin.sosa@extendiendoservicios.com',
    'patricia.nunez@extendiendoservicios.com'
  );

  if v_ajenos > 0 then
    raise exception using
      errcode = 'P0001',
      message = format(
        'Esta base tiene %s usuario(s) que no son del seed ficticio (por ejemplo %s). Este archivo trunca clientes, empleados, feriados y configuración de la empresa: no se corre acá. Para producción está supabase/seed-prod.sql (DB-020), que no borra nada.',
        v_ajenos, v_ejemplo
      );
  end if;
end $$;

-- =================================================================================================
-- 0. Reinicio idempotente de los datos de negocio que este archivo vuelve a poblar.
-- =================================================================================================

-- `truncate ... cascade` en Postgres trunca además cualquier tabla con una FK hacia las listadas
-- (no hace falta listar sites/services/shifts/... por separado: todas cuelgan de `clients` o de
-- `employees` por FK). `restart identity` no tiene efecto real acá (ninguna de estas tablas usa
-- una columna `serial`/`identity`, todas generan `id` con `gen_random_uuid()`), se deja por
-- prolijidad. `profiles`/`user_roles`/`admin_capabilities`/`employees` quedan fuera: se recargan
-- por upsert más abajo, sin perder las cuentas de Auth creadas por `scripts/seed-dev.ts`.
truncate table
  public.clients,
  public.employees,
  public.rating_criteria,
  public.holidays,
  public.company_settings,
  public.supply_categories,
  public.stock_counts
  restart identity cascade;

-- Módulo E (insumos y stock, P25.1): `supply_categories` arrastra por cascada los artículos, el
-- historial de precios, los movimientos y sus líneas, los controles y los avisos de faltante.
-- Los eventos de seguridad que dejó el seed anterior (cambio de precio y anulación) se quitan para
-- que correr el seed varias veces no los duplique.
delete from public.security_events where event_type in ('supply_price_changed', 'stock_movement_voided');

-- =================================================================================================
-- 1. Personas ya creadas en Auth (scripts/seed-dev.ts) -- se buscan por email, nunca se insertan.
-- =================================================================================================

create temporary table tmp_profiles (
  key text primary key,
  profile_id uuid not null
) on commit drop;

insert into tmp_profiles (key, profile_id)
select v.key, u.id
from (
  values
    ('owner', 'extserviciosapp@gmail.com'),
    ('admin_andrea', 'andrea.rios@extendiendoservicios.com'),
    ('sup_paula', 'paula.lemos@extendiendoservicios.com'),
    ('sup_noelia', 'noelia.vera@extendiendoservicios.com'),
    ('emp_maria', 'maria.gomez@extendiendoservicios.com'),
    ('emp_juan', 'juan.perez@extendiendoservicios.com'),
    ('emp_sofia', 'sofia.ruiz@extendiendoservicios.com'),
    ('emp_carlos', 'carlos.medina@extendiendoservicios.com'),
    ('emp_lucia', 'lucia.torres@extendiendoservicios.com'),
    ('emp_rocio', 'rocio.aguirre@extendiendoservicios.com'),
    ('emp_valeria', 'valeria.paz@extendiendoservicios.com'),
    ('emp_diego', 'diego.fabbri@extendiendoservicios.com'),
    ('emp_martin', 'martin.sosa@extendiendoservicios.com'),
    ('emp_patricia', 'patricia.nunez@extendiendoservicios.com')
) as v (key, email)
join auth.users u on lower(u.email) = lower(v.email);

do $$
declare
  v_encontrados int;
begin
  select count(*) into v_encontrados from tmp_profiles;
  if v_encontrados <> 14 then
    raise exception using
      errcode = 'P0001',
      message = format(
        'Faltan usuarios de Auth: se encontraron %s de 14. Corré primero `pnpm db:seed:users` (scripts/seed-dev.ts) contra el mismo proyecto.',
        v_encontrados
      );
  end if;
end $$;

-- Nombre y apellido: la fuente es la metadata de Auth que carga `scripts/seed-dev.ts`. El
-- trigger `app.handle_new_user()` (0003) la copia a `profiles` solo al insertar, así que si un
-- nombre cambia en la lista del script, la fila espejo queda vieja. Se sincroniza acá, que corre
-- como `postgres`: por PostgREST no se puede, porque el trigger de `profiles` vive en el esquema
-- `app`, cerrado a `service_role` en 0016/0017.
update public.profiles p
set
  first_name = coalesce(u.raw_user_meta_data ->> 'first_name', p.first_name),
  last_name = coalesce(u.raw_user_meta_data ->> 'last_name', p.last_name)
from auth.users u
join tmp_profiles t on t.profile_id = u.id
where p.id = u.id
  and (
    p.first_name is distinct from coalesce(u.raw_user_meta_data ->> 'first_name', p.first_name)
    or p.last_name is distinct from coalesce(u.raw_user_meta_data ->> 'last_name', p.last_name)
  );

create temporary table tmp_owner (profile_id uuid not null) on commit drop;
insert into tmp_owner select profile_id from tmp_profiles where key = 'owner';

-- =================================================================================================
-- 2. Empresa: company_settings (fila única) y holidays.
-- =================================================================================================

insert into public.company_settings (id, name, support_phone, location_consent_text, updated_by)
values (
  1,
  'Extendiendo Servicios',
  '11 4000-0000',
  'Para registrar el inicio y el fin de tu turno con tu ubicación, Extendiendo Servicios necesita tu permiso de geolocalización. Podés usar la app igual sin darlo: el registro de tu jornada funciona de todas formas, solo que sin la ubicación adjunta.',
  (select profile_id from tmp_owner)
);

-- Feriados nacionales de Argentina del año en curso, de fecha fija o trasladable (04 sección 2.6,
-- P-050). Decisión menor: se omiten los feriados móviles atados a la Pascua (Carnaval, Viernes
-- Santo), cuyo cálculo depende del algoritmo de Gauss -- fuera de alcance de este seed, no
-- crítico para los escenarios de generación de turnos (todos los servicios del seed nacen con
-- `works_on_holidays = true`, así que `holidays` no bloquea nada acá; la tabla queda poblada
-- igual para probar la pantalla de feriados y `generate_shifts` cuando exista, F10).
--
-- Los cuatro trasladables de la Ley 27.399, artículo 6 (Güemes 17/6, San Martín 17/8, Diversidad
-- Cultural 12/10 y Soberanía Nacional 20/11) pasan al lunes anterior si caen martes o miércoles, y
-- al lunes siguiente si caen jueves o viernes; sábado, domingo y lunes quedan en su fecha -- misma
-- regla que `movableHoliday` en `src/features/settings/nationalHolidays.ts` (P07.3), reescrita
-- acá en SQL porque este archivo corre fuera del frontend. Corregido en P07.5: la versión anterior
-- cargaba los cuatro en su fecha literal (sin trasladar) y omitía a Güemes.
insert into public.holidays (holiday_date, name, created_by)
select
  case
    when f.trasladable then
      make_date(extract(year from app.today())::int, f.mes, f.dia)
      + (case extract(dow from make_date(extract(year from app.today())::int, f.mes, f.dia))::int
           when 2 then -1 -- martes -> lunes anterior
           when 3 then -2 -- miércoles -> lunes anterior
           when 4 then 4 -- jueves -> lunes siguiente
           when 5 then 3 -- viernes -> lunes siguiente
           else 0 -- sábado, domingo o lunes: sin traslado
         end)
    else
      make_date(extract(year from app.today())::int, f.mes, f.dia)
  end,
  f.nombre,
  (select profile_id from tmp_owner)
from (
  values
    (1, 1, 'Año Nuevo', false),
    (3, 24, 'Día Nacional de la Memoria por la Verdad y la Justicia', false),
    (4, 2, 'Día del Veterano y de los Caídos en la Guerra de Malvinas', false),
    (5, 1, 'Día del Trabajador', false),
    (5, 25, 'Día de la Revolución de Mayo', false),
    (6, 17, 'Paso a la Inmortalidad del General Martín Miguel de Güemes', true),
    (6, 20, 'Paso a la Inmortalidad del General Manuel Belgrano', false),
    (7, 9, 'Día de la Independencia', false),
    (8, 17, 'Paso a la Inmortalidad del General José de San Martín', true),
    (10, 12, 'Día del Respeto a la Diversidad Cultural', true),
    (11, 20, 'Día de la Soberanía Nacional', true),
    (12, 8, 'Inmaculada Concepción de María', false),
    (12, 25, 'Navidad', false)
) as f (mes, dia, nombre, trasladable)
on conflict (holiday_date) do nothing;

-- =================================================================================================
-- 3. Roles y capacidades (04 sección 2.1, 0013_rpc_users.sql las escribe por RPC en producción;
--    acá se insertan directo, mismo criterio que el resto del seed).
-- =================================================================================================

insert into public.user_roles (profile_id, role, granted_by)
select profile_id, 'owner'::public.app_role, profile_id from tmp_profiles where key = 'owner'
union all
select profile_id, 'admin'::public.app_role, (select profile_id from tmp_owner)
from tmp_profiles where key = 'admin_andrea'
union all
select profile_id, 'supervisor'::public.app_role, (select profile_id from tmp_owner)
from tmp_profiles where key in ('sup_paula', 'sup_noelia')
union all
select profile_id, 'employee'::public.app_role, (select profile_id from tmp_owner)
from tmp_profiles where key like 'emp_%'
on conflict (profile_id, role) do nothing;

-- Andrea (administradora) con las siete capacidades en true -- 04 sección 2.1: "Al crear un
-- administrador se insertan las siete en true (POR CONFIRMAR el valor inicial, fase 7)"; el seed
-- sigue ese criterio mientras la fase 7 no lo cambie.
insert into public.admin_capabilities (profile_id, capability, enabled, updated_by)
select (select profile_id from tmp_profiles where key = 'admin_andrea'), c, true, (select profile_id from tmp_owner)
from unnest(enum_range(null::public.admin_capability)) as c
on conflict (profile_id, capability) do update set enabled = excluded.enabled, updated_by = excluded.updated_by;

-- =================================================================================================
-- 4. employees: datos laborales de las dos supervisoras y los diez empleados.
-- =================================================================================================

insert into public.employees (profile_id, employee_number, dni, cuil, hire_date, status, created_by)
select p.profile_id, d.employee_number, d.dni, d.cuil, d.hire_date, 'active', (select profile_id from tmp_owner)
from (
  values
    -- Supervisoras.
    ('sup_paula', 50, '28111222', '27281112223', date '2019-03-01'),
    ('sup_noelia', 51, '29222333', '27292223334', date '2020-06-15'),
    -- Empleados (legajos del mockup entre paréntesis en el comentario del reporte de la tarea).
    ('emp_maria', 24, '30111024', '27301110245', date '2018-02-01'),
    ('emp_juan', 11, '31222011', '20312220117', date '2021-05-10'),
    ('emp_sofia', 38, '29333038', '27293330385', date '2019-11-20'),
    ('emp_carlos', 19, '30444019', '20304440197', date '2020-01-15'),
    ('emp_lucia', 7, '32555007', '27325550075', date '2022-04-01'),
    ('emp_rocio', 42, '28666042', '27286660425', date '2017-08-01'),
    ('emp_valeria', 15, '33777015', '27337770155', date '2023-02-01'),
    ('emp_diego', 30, '31888030', '20318880307', date '2020-09-01'),
    ('emp_martin', 26, '34999026', '20349990267', date '2023-06-01'),
    ('emp_patricia', 45, '30123045', '27301230455', date '2021-10-01')
) as d (key, employee_number, dni, cuil, hire_date)
join tmp_profiles p on p.key = d.key;

-- La secuencia del legajo (0006_employees.sql) sigue viva para las altas por pantalla: se la deja
-- lista para que el próximo `nextval()` no choque con ninguno de los legajos fijos de arriba
-- (el mayor es 51).
select setval('public.employee_number_seq', 100, false);

-- =================================================================================================
-- 5. Clientes, contactos y sedes (04 sección 2.2).
-- =================================================================================================

create temporary table tmp_clients (
  key text primary key,
  client_id uuid not null default gen_random_uuid()
) on commit drop;

insert into tmp_clients (key)
values ('grupo_norte'), ('clinica_parque'), ('oficinas_delta'), ('logistica_central'), ('estudio_paredes'), ('textil_moran');

insert into public.clients (id, legal_name, trade_name, cuit, admin_address, status, created_by)
select c.client_id, d.legal_name, d.trade_name, d.cuit, d.admin_address, 'active', (select profile_id from tmp_owner)
from tmp_clients c
join (
  values
    ('grupo_norte', 'Grupo Norte S.A.', 'Grupo Norte', '30711234567', 'Av. Centenario 1450, San Isidro'),
    ('clinica_parque', 'Clínica del Parque S.A.', 'Clínica del Parque', '30712345678', 'Av. Santa Fe 1234, Martínez'),
    ('oficinas_delta', 'Oficinas Delta S.R.L.', 'Oficinas Delta', '30723456789', 'Laprida 820, Vicente López'),
    ('logistica_central', 'Logística Central S.A.', 'Logística Central', '30734567890', 'Zufriategui 1200, Munro'),
    ('estudio_paredes', 'Estudio Paredes', null, '27345678901', 'Av. Maipú 900, Vicente López'),
    ('textil_moran', 'Textil Morán S.A.', 'Textil Morán', '30756789012', 'Av. San Martín 3400, San Martín')
) as d (key, legal_name, trade_name, cuit, admin_address) on d.key = c.key;

-- Un contacto principal por cliente (client_contacts_one_primary_per_client_idx, 0005). Dominio
-- `.example` (RFC 2606, reservado para ejemplos): estos contactos son ficticios, no direcciones
-- reales, y `App_dev` es un entorno público con banner "Entorno de prueba".
insert into public.client_contacts (client_id, name, role_title, phone, email, is_primary, created_by)
select c.client_id, d.name, d.role_title, d.phone, d.email, true, (select profile_id from tmp_owner)
from tmp_clients c
join (
  values
    ('grupo_norte', 'Marcela Ríos', 'Encargada de mantenimiento', '11 4700-1200', 'marcela.rios@gruponorte.example'),
    ('clinica_parque', 'Sergio Paz', 'Director administrativo', '11 4711-3400', 'sergio.paz@clinicadelparque.example'),
    ('oficinas_delta', 'Laura Benítez', 'Gerenta de operaciones', '11 4722-5600', 'laura.benitez@oficinasdelta.example'),
    ('logistica_central', 'Hernán Costa', 'Jefe de planta', '11 4733-7800', 'hernan.costa@logisticacentral.example'),
    ('estudio_paredes', 'Ana Paredes', 'Titular', '11 4744-9900', 'ana.paredes@estudioparedes.example'),
    ('textil_moran', 'Ricardo Morán', 'Titular', '11 4755-2200', 'ricardo.moran@textilmoran.example')
) as d (client_key, name, role_title, phone, email) on d.client_key = c.key;

create temporary table tmp_sites (
  key text primary key,
  site_id uuid not null default gen_random_uuid(),
  client_key text not null,
  client_id uuid
) on commit drop;

insert into tmp_sites (key, client_key)
values
  ('gn_sanisidro', 'grupo_norte'),
  ('gn_martinez', 'grupo_norte'),
  ('gn_vlopez', 'grupo_norte'),
  ('cp_martinez', 'clinica_parque'),
  ('cp_olivos', 'clinica_parque'),
  ('od_vlopez', 'oficinas_delta'),
  ('od_olivos', 'oficinas_delta'),
  ('od_munro', 'oficinas_delta'),
  ('od_boulogne', 'oficinas_delta'),
  ('lc_munro', 'logistica_central'),
  ('lc_villaadelina', 'logistica_central'),
  ('ep_vlopez', 'estudio_paredes'),
  ('tm_sanmartin', 'textil_moran');

update tmp_sites s set client_id = c.client_id from tmp_clients c where c.key = s.client_key;

-- Direcciones tomadas del mockup donde aparecen (San Isidro/Av. Centenario 1450 en
-- screens_personas.py y build.py; Martínez de Clínica del Parque/Av. Santa Fe 1234 en
-- screens_planificacion.py; Vicente López de Oficinas Delta/Laprida 820 en build.py); el resto,
-- ficticias con criterio de zona norte del GBA (decisión menor).
insert into public.sites (id, client_id, name, address, city, status, created_by)
select s.site_id, s.client_id, d.name, d.address, d.city, 'active', (select profile_id from tmp_owner)
from tmp_sites s
join (
  values
    ('gn_sanisidro', 'San Isidro', 'Av. Centenario 1450', 'San Isidro'),
    ('gn_martinez', 'Martínez', 'Av. del Libertador 1600', 'Martínez'),
    ('gn_vlopez', 'Vicente López', 'Av. Maipú 2100', 'Vicente López'),
    ('cp_martinez', 'Martínez', 'Av. Santa Fe 1234', 'Martínez'),
    ('cp_olivos', 'Olivos', 'Av. Maipú 1500', 'Olivos'),
    ('od_vlopez', 'Vicente López', 'Laprida 820', 'Vicente López'),
    ('od_olivos', 'Olivos', 'Av. del Libertador 2200', 'Olivos'),
    ('od_munro', 'Munro', 'Av. Mitre 2900', 'Munro'),
    ('od_boulogne', 'Boulogne', 'Av. Márquez 1100', 'Boulogne'),
    ('lc_munro', 'Munro', 'Zufriategui 1200', 'Munro'),
    ('lc_villaadelina', 'Villa Adelina', 'Panamericana km 22', 'Villa Adelina'),
    ('ep_vlopez', 'Vicente López', 'Av. Maipú 900', 'Vicente López'),
    ('tm_sanmartin', 'San Martín', 'Av. San Martín 3400', 'San Martín')
) as d (key, name, address, city) on d.key = s.key;

-- =================================================================================================
-- 6. Checklists: una plantilla activa por cliente (sin plantilla propia por sede en este seed),
--    con los mismos cinco ítems genéricos (04 sección 2.4; dos títulos tomados del mockup,
--    screens_personas.py líneas 341-342: "Aspirar oficinas", "Limpiar recepción").
-- =================================================================================================

create temporary table tmp_checklist_templates (
  key text primary key,
  template_id uuid not null default gen_random_uuid(),
  client_key text not null
) on commit drop;

insert into tmp_checklist_templates (key, client_key)
select 'ct_' || key, key from tmp_clients;

insert into public.checklist_templates (id, client_id, site_id, name, is_active, created_by)
select t.template_id, c.client_id, null, 'Checklist estándar', true, (select profile_id from tmp_owner)
from tmp_checklist_templates t
join tmp_clients c on c.key = t.client_key;

insert into public.checklist_template_items (template_id, position, title, description, is_required, created_by)
select t.template_id, x.position, x.title, x.description, x.is_required, (select profile_id from tmp_owner)
from tmp_checklist_templates t
cross join (
  values
    (1, 'Aspirar oficinas', null, true),
    (2, 'Limpiar recepción', null, true),
    (3, 'Vaciar cestos de residuos', null, true),
    (4, 'Limpiar baños', 'Incluye reposición de insumos si corresponde.', true),
    (5, 'Repasar vidrios y superficies', null, false)
) as x (position, title, description, is_required);

-- =================================================================================================
-- 7. Criterios de calificación (04 sección 2.5, P-080, P-087) -- "criterios de ejemplo" (04
--    sección 10). Sin puntaje por criterio: son guía de texto para el supervisor.
-- =================================================================================================

insert into public.rating_criteria (position, title, description, valid_from, created_by)
values
  (1, 'Puntualidad', 'Llega e inicia el turno dentro del horario acordado.', date '2025-01-01', (select profile_id from tmp_owner)),
  (2, 'Prolijidad del trabajo', 'Cumple el checklist y deja el espacio en condiciones.', date '2025-01-01', (select profile_id from tmp_owner)),
  (3, 'Trato con el cliente', 'Se conduce con respeto ante el personal y el público del cliente.', date '2025-01-01', (select profile_id from tmp_owner)),
  (4, 'Uso responsable de insumos', 'Utiliza los insumos de forma razonable, sin desperdicio.', date '2025-01-01', (select profile_id from tmp_owner));

-- =================================================================================================
-- 8. Servicios (04 sección 2.3): dieciséis, uno o dos por sede, lunes a viernes. Diez tienen un
--    empleado fijo asignado más abajo (mismo patrón de personal por sede que el mockup: María
--    Gómez en Grupo Norte-San Isidro, Juan Pérez en Clínica del Parque-Martínez, etc. --
--    screens_asistencia.py, screens_planificacion.py); seis quedan sin empleado fijo a propósito,
--    para poblar el estado derivado "sin cubrir" de v_shifts_board con datos reales.
-- =================================================================================================

create temporary table tmp_services (
  key text primary key,
  service_id uuid not null default gen_random_uuid(),
  site_key text not null,
  name text not null,
  start_time time not null,
  end_time time not null,
  required_staff smallint not null,
  employee_key text
) on commit drop;

insert into tmp_services (key, site_key, name, start_time, end_time, required_staff, employee_key)
values
  ('gn_sanisidro_manana', 'gn_sanisidro', 'Limpieza mañana', '08:00', '12:00', 1, 'emp_maria'),
  ('gn_sanisidro_tarde', 'gn_sanisidro', 'Limpieza tarde', '13:00', '17:00', 1, 'emp_martin'),
  ('gn_martinez', 'gn_martinez', 'Limpieza mañana', '07:00', '11:00', 1, 'emp_lucia'),
  ('gn_vlopez', 'gn_vlopez', 'Limpieza mañana', '09:00', '13:00', 1, null),
  ('cp_martinez_manana', 'cp_martinez', 'Limpieza mañana', '08:00', '13:00', 1, 'emp_juan'),
  ('cp_martinez_temprano', 'cp_martinez', 'Limpieza temprano', '06:00', '10:00', 1, 'emp_valeria'),
  ('cp_olivos', 'cp_olivos', 'Limpieza mañana', '09:00', '13:00', 1, null),
  ('od_vlopez', 'od_vlopez', 'Limpieza mañana', '09:00', '13:00', 1, 'emp_sofia'),
  ('od_olivos', 'od_olivos', 'Limpieza mañana', '09:00', '14:00', 1, 'emp_rocio'),
  ('od_munro', 'od_munro', 'Limpieza mañana', '08:00', '12:00', 1, null),
  ('od_boulogne', 'od_boulogne', 'Limpieza tarde', '14:00', '18:00', 1, null),
  ('lc_munro_manana', 'lc_munro', 'Limpieza mañana', '08:00', '12:00', 1, 'emp_carlos'),
  ('lc_munro_tarde', 'lc_munro', 'Limpieza tarde', '10:00', '15:00', 1, 'emp_diego'),
  ('lc_villaadelina', 'lc_villaadelina', 'Limpieza mañana', '07:00', '11:00', 1, null),
  ('ep_vlopez', 'ep_vlopez', 'Limpieza mañana', '08:00', '12:00', 1, 'emp_patricia'),
  ('tm_sanmartin', 'tm_sanmartin', 'Limpieza mañana', '06:00', '10:00', 2, null);

insert into public.services (
  id, client_id, site_id, name, weekdays, start_time, end_time, required_staff, valid_from, status, created_by
)
select ts.service_id, si.client_id, si.site_id, ts.name, array[1, 2, 3, 4, 5]::smallint[], ts.start_time, ts.end_time,
  ts.required_staff, date '2025-01-01', 'active', (select profile_id from tmp_owner)
from tmp_services ts
join tmp_sites si on si.key = ts.site_key;

-- =================================================================================================
-- 9. Generación de turnos (equivalente de generate_shifts/create_shift, todavía no escritas --
--    llegan en F10) para el mes actual y el siguiente (04 sección 10), EXCEPTO hoy: los turnos de
--    hoy se arman a mano en el bloque 10, con los escenarios de 03 sección 14.3, sin depender de
--    la hora del día en que se corra este archivo.
--
--    Decisión menor de rango: "pasado" son los últimos 14 días corridos hasta ayer (no todo el
--    mes desde el día 1), para no generar cientos de registros de asistencia redundantes; el
--    modelo describe el seed en prosa ("mes actual y siguiente") sin fijar un rango exacto de
--    días con historial real. "Futuro" sí llega hasta el último día del mes siguiente completo.
--
--    Turnos con empleado fijo: pasados -> completed + asignación finished + asistencia completa
--    (check-in a horario, check-out a horario, fichados por el propio empleado); futuros ->
--    assigned + asignación expected. Turnos sin empleado fijo: pasados -> cancelled ("sin
--    personal disponible", ejercita esos campos del check de shifts); futuros -> scheduled, sin
--    asignación (quedan "sin cubrir" cuando se acerquen, vía v_shifts_board). El checklist del
--    cliente se copia a shift_tasks en todo turno que no sea cancelled (ADR-011).
-- =================================================================================================

do $$
declare
  v_owner uuid := (select profile_id from tmp_owner);
  v_fin_mes_siguiente date := (date_trunc('month', app.today()) + interval '2 months' - interval '1 day')::date;
  v_service record;
  v_site record;
  v_date date;
  v_shift_id uuid;
  v_assignment_id uuid;
  v_employee_id uuid;
  v_status public.shift_status;
begin
  for v_service in select * from tmp_services loop
    select site_id, client_id into v_site from tmp_sites where key = v_service.site_key;

    if v_service.employee_key is not null then
      select profile_id into v_employee_id from tmp_profiles where key = v_service.employee_key;
    else
      v_employee_id := null;
    end if;

    -- Pasado: últimos 14 días corridos hasta ayer, solo días hábiles (lunes a viernes, igual que
    -- `services.weekdays` de este seed).
    for v_date in
      select d::date from generate_series(app.today() - 14, app.today() - 1, interval '1 day') as d
    loop
      if extract(dow from v_date) between 1 and 5 then
        v_shift_id := gen_random_uuid();

        if v_employee_id is not null then
          insert into public.shifts (
            id, service_id, client_id, site_id, shift_date, start_time, end_time, required_staff,
            status, generated, created_by
          )
          values (
            v_shift_id, v_service.service_id, v_site.client_id, v_site.site_id, v_date,
            v_service.start_time, v_service.end_time, v_service.required_staff,
            'completed', true, v_owner
          );

          insert into public.assignments (id, shift_id, employee_id, status, created_by)
          values (gen_random_uuid(), v_shift_id, v_employee_id, 'finished', v_owner)
          returning id into v_assignment_id;

          insert into public.attendance_records (assignment_id, kind, recorded_at, source, recorded_by)
          values
            (v_assignment_id, 'check_in', app.local_ts(v_date, v_service.start_time), 'employee_app', v_employee_id),
            (v_assignment_id, 'check_out', app.local_ts(v_date, v_service.end_time), 'employee_app', v_employee_id);

          insert into public.shift_tasks (shift_id, position, title, description, is_required, status, status_changed_at, status_changed_by)
          select v_shift_id, cti.position, cti.title, cti.description, cti.is_required, 'done',
            app.local_ts(v_date, v_service.end_time), v_employee_id
          from public.checklist_template_items cti
          join public.checklist_templates ct on ct.id = cti.template_id
          where ct.client_id = v_site.client_id and ct.site_id is null and ct.deleted_at is null and cti.deleted_at is null;
        else
          insert into public.shifts (
            id, service_id, client_id, site_id, shift_date, start_time, end_time, required_staff,
            status, generated, cancelled_at, cancelled_by, cancel_reason, created_by
          )
          values (
            v_shift_id, v_service.service_id, v_site.client_id, v_site.site_id, v_date,
            v_service.start_time, v_service.end_time, v_service.required_staff,
            'cancelled', true, app.local_ts(v_date, v_service.start_time), v_owner,
            'Sin personal disponible para cubrir el turno.', v_owner
          );
        end if;
      end if;
    end loop;

    -- Futuro: desde mañana hasta el último día del mes siguiente, solo días hábiles.
    for v_date in
      select d::date from generate_series(app.today() + 1, v_fin_mes_siguiente, interval '1 day') as d
    loop
      if extract(dow from v_date) between 1 and 5 then
        v_shift_id := gen_random_uuid();
        v_status := case when v_employee_id is not null then 'assigned' else 'scheduled' end;

        insert into public.shifts (
          id, service_id, client_id, site_id, shift_date, start_time, end_time, required_staff,
          status, generated, created_by
        )
        values (
          v_shift_id, v_service.service_id, v_site.client_id, v_site.site_id, v_date,
          v_service.start_time, v_service.end_time, v_service.required_staff,
          v_status, true, v_owner
        );

        if v_employee_id is not null then
          insert into public.assignments (id, shift_id, employee_id, status, created_by)
          values (gen_random_uuid(), v_shift_id, v_employee_id, 'expected', v_owner);
        end if;

        insert into public.shift_tasks (shift_id, position, title, description, is_required, status)
        select v_shift_id, cti.position, cti.title, cti.description, cti.is_required, 'pending'
        from public.checklist_template_items cti
        join public.checklist_templates ct on ct.id = cti.template_id
        where ct.client_id = v_site.client_id and ct.site_id is null and ct.deleted_at is null and cti.deleted_at is null;
      end if;
    end loop;
  end loop;
end $$;

-- =================================================================================================
-- 10. Turnos de HOY: cinco turnos puntuales (service_id null, igual que create_shift) con los
--     escenarios de 03 sección 14.3 -- "turnos de hoy en distintos estados, una ausencia avisada,
--     un sin registro". Puntuales a propósito: así no compiten por el mismo empleado con los
--     turnos recurrentes de hoy (que el bloque 9 no genera, ver su comentario), sin importar qué
--     día de la semana ni a qué hora del día se corra este archivo.
-- =================================================================================================

do $$
declare
  v_owner uuid := (select profile_id from tmp_owner);
  v_admin uuid := (select profile_id from tmp_profiles where key = 'admin_andrea');
  v_client_gn uuid := (select client_id from tmp_clients where key = 'grupo_norte');
  v_site_gn uuid := (select site_id from tmp_sites where key = 'gn_sanisidro');
  v_client_lc uuid := (select client_id from tmp_clients where key = 'logistica_central');
  v_site_lc uuid := (select site_id from tmp_sites where key = 'lc_munro');
  v_client_od uuid := (select client_id from tmp_clients where key = 'oficinas_delta');
  v_site_od uuid := (select site_id from tmp_sites where key = 'od_olivos');
  v_client_ep uuid := (select client_id from tmp_clients where key = 'estudio_paredes');
  v_site_ep uuid := (select site_id from tmp_sites where key = 'ep_vlopez');
  v_maria uuid := (select profile_id from tmp_profiles where key = 'emp_maria');
  v_carlos uuid := (select profile_id from tmp_profiles where key = 'emp_carlos');
  v_diego uuid := (select profile_id from tmp_profiles where key = 'emp_diego');
  v_rocio uuid := (select profile_id from tmp_profiles where key = 'emp_rocio');
  v_patricia uuid := (select profile_id from tmp_profiles where key = 'emp_patricia');
  v_paula uuid := (select profile_id from tmp_profiles where key = 'sup_paula');
  v_shift_a uuid := gen_random_uuid(); -- en curso, normal
  v_shift_b uuid := gen_random_uuid(); -- sin registro
  v_shift_c uuid := gen_random_uuid(); -- ausencia avisada
  v_shift_d uuid := gen_random_uuid(); -- próximo
  v_shift_e uuid := gen_random_uuid(); -- completado
  v_assignment_a uuid;
  v_assignment_c uuid;
  v_assignment_e uuid;
  v_supervision uuid;
  v_hora_proximo_inicio time;
  v_hora_proximo_fin time;
  v_ahora_min int;
  v_inicio_min int;
  v_fin_min int;
begin
  -- (a) En curso, normal: Grupo Norte - San Isidro, María Gómez presente.
  insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, generated, notes, created_by)
  values (v_shift_a, v_client_gn, v_site_gn, app.today(), time '08:00', time '12:00', 1, 'in_progress', false, 'Turno de ejemplo del seed (escenario "en curso").', v_owner);

  insert into public.assignments (id, shift_id, employee_id, status, created_by)
  values (gen_random_uuid(), v_shift_a, v_maria, 'present', v_owner)
  returning id into v_assignment_a;

  insert into public.attendance_records (assignment_id, kind, recorded_at, source, recorded_by)
  values (v_assignment_a, 'check_in', app.local_ts(app.today(), '08:05'), 'employee_app', v_maria);

  insert into public.shift_tasks (shift_id, position, title, description, is_required, status, status_changed_at, status_changed_by)
  select v_shift_a, cti.position, cti.title, cti.description, cti.is_required,
    case when cti.position <= 2 then 'done'::public.task_status else 'pending'::public.task_status end,
    case when cti.position <= 2 then app.local_ts(app.today(), '08:20') end,
    case when cti.position <= 2 then v_maria end
  from public.checklist_template_items cti
  join public.checklist_templates ct on ct.id = cti.template_id
  where ct.client_id = v_client_gn and ct.site_id is null and ct.deleted_at is null and cti.deleted_at is null;

  -- Supervisión en curso sobre este mismo turno (Paula Lemos, escenario "supervisión en curso").
  insert into public.supervisions (shift_id, supervisor_id, status, assigned_by, assigned_at, criteria_snapshot, created_by)
  values (
    v_shift_a, v_paula, 'in_progress', v_admin, app.local_ts(app.today(), '07:30'),
    (select jsonb_agg(jsonb_build_object('title', title, 'description', description) order by position) from public.rating_criteria),
    v_admin
  )
  returning id into v_supervision;

  insert into public.supervision_attendance (supervision_id, kind, recorded_at)
  values (v_supervision, 'check_in', app.local_ts(app.today(), '08:00'));

  -- (b) Sin registro: Logística Central - Munro, Carlos Medina sin fichar, franja ya vencida a
  -- cualquier hora razonable del día (P-071, mismo personaje que el mockup: "Carlos Medina · Sin
  -- fichar", screens_asistencia.py).
  insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, generated, notes, created_by)
  values (v_shift_b, v_client_lc, v_site_lc, app.today(), time '06:00', time '10:00', 1, 'assigned', false, 'Turno de ejemplo del seed (escenario "sin registro").', v_owner);

  insert into public.assignments (id, shift_id, employee_id, status, created_by)
  values (gen_random_uuid(), v_shift_b, v_carlos, 'expected', v_owner);

  insert into public.shift_tasks (shift_id, position, title, description, is_required, status)
  select v_shift_b, cti.position, cti.title, cti.description, cti.is_required, 'pending'
  from public.checklist_template_items cti
  join public.checklist_templates ct on ct.id = cti.template_id
  where ct.client_id = v_client_lc and ct.site_id is null and ct.deleted_at is null and cti.deleted_at is null;

  -- (c) Ausencia avisada: Logística Central - Munro, Diego Fabbri avisó por enfermedad antes del
  -- inicio del turno (P-073: no libera el cupo, queda visible para el administrador).
  insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, generated, notes, created_by)
  values (v_shift_c, v_client_lc, v_site_lc, app.today(), time '10:00', time '15:00', 1, 'assigned', false, 'Turno de ejemplo del seed (escenario "ausencia avisada").', v_owner);

  insert into public.assignments (id, shift_id, employee_id, status, created_by)
  values (gen_random_uuid(), v_shift_c, v_diego, 'absence_notified', v_owner)
  returning id into v_assignment_c;

  insert into public.attendance_notices (assignment_id, kind, reason_code, reason_text, reported_by, source, created_at)
  values (v_assignment_c, 'absence', 'illness', null, v_diego, 'employee_app', app.local_ts(app.today(), '08:30'));

  insert into public.shift_tasks (shift_id, position, title, description, is_required, status)
  select v_shift_c, cti.position, cti.title, cti.description, cti.is_required, 'pending'
  from public.checklist_template_items cti
  join public.checklist_templates ct on ct.id = cti.template_id
  where ct.client_id = v_client_lc and ct.site_id is null and ct.deleted_at is null and cti.deleted_at is null;

  -- (d) Próximo: Estudio Paredes - Vicente López, Patricia Núñez asignada, arranca dentro de la
  -- próxima hora (03 sección 14.3: "próximo" es un estado derivado de v_shifts_board, sección 4
  -- de 04 -- depende de la hora real en que se corra este archivo, decisión menor aceptada: el
  -- escenario se ve como "próximo" si se corre durante el horario laboral habitual).
  -- Cálculo en minutos desde medianoche (no con el tipo `time` directamente): `time + interval`
  -- da la vuelta al llegar a las 24 h (verificado: `time '23:00' + interval '4 hours' = '03:00'`),
  -- lo que podría dejar la hora de fin "antes" que la de inicio si el turno cayera muy tarde en
  -- el día -- justamente lo que `shifts_time_range_check` (0007) rechaza. En minutos enteros, con
  -- `least`/`greatest` simples, se evita ese problema sin ningún caso borde.
  v_ahora_min := extract(hour from (now() at time zone 'America/Argentina/Buenos_Aires'))::int * 60
    + extract(minute from (now() at time zone 'America/Argentina/Buenos_Aires'))::int;
  v_inicio_min := least(v_ahora_min + 30, 23 * 60); -- tope 23:00: no arranca más tarde.
  v_fin_min := greatest(least(v_inicio_min + 240, 23 * 60 + 45), v_inicio_min + 15); -- 15 min a 4 h.
  v_hora_proximo_inicio := make_time(v_inicio_min / 60, v_inicio_min % 60, 0);
  v_hora_proximo_fin := make_time(v_fin_min / 60, v_fin_min % 60, 0);

  insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, generated, notes, created_by)
  values (v_shift_d, v_client_ep, v_site_ep, app.today(), v_hora_proximo_inicio, v_hora_proximo_fin, 1, 'assigned', false, 'Turno de ejemplo del seed (escenario "próximo").', v_owner);

  insert into public.assignments (id, shift_id, employee_id, status, created_by)
  values (gen_random_uuid(), v_shift_d, v_patricia, 'expected', v_owner);

  insert into public.shift_tasks (shift_id, position, title, description, is_required, status)
  select v_shift_d, cti.position, cti.title, cti.description, cti.is_required, 'pending'
  from public.checklist_template_items cti
  join public.checklist_templates ct on ct.id = cti.template_id
  where ct.client_id = v_client_ep and ct.site_id is null and ct.deleted_at is null and cti.deleted_at is null;

  -- (e) Completado hoy: Oficinas Delta - Olivos, Rocío Aguirre, franja bien temprana para que a
  -- cualquier hora posterior del día ya esté terminado.
  insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, generated, notes, created_by)
  values (v_shift_e, v_client_od, v_site_od, app.today(), time '06:00', time '09:00', 1, 'completed', false, 'Turno de ejemplo del seed (escenario "completado").', v_owner);

  insert into public.assignments (id, shift_id, employee_id, status, created_by)
  values (gen_random_uuid(), v_shift_e, v_rocio, 'finished', v_owner)
  returning id into v_assignment_e;

  insert into public.attendance_records (assignment_id, kind, recorded_at, source, recorded_by)
  values
    (v_assignment_e, 'check_in', app.local_ts(app.today(), '06:05'), 'employee_app', v_rocio),
    (v_assignment_e, 'check_out', app.local_ts(app.today(), '09:02'), 'employee_app', v_rocio);

  insert into public.shift_tasks (shift_id, position, title, description, is_required, status, status_changed_at, status_changed_by)
  select v_shift_e, cti.position, cti.title, cti.description, cti.is_required, 'done', app.local_ts(app.today(), '08:50'), v_rocio
  from public.checklist_template_items cti
  join public.checklist_templates ct on ct.id = cti.template_id
  where ct.client_id = v_client_od and ct.site_id is null and ct.deleted_at is null and cti.deleted_at is null;
end $$;

-- =================================================================================================
-- 11. Supervisiones completadas en días pasados (03 sección 14.3), con calificación de la
--     asignación correspondiente -- sobre turnos que ya generó el bloque 9.
-- =================================================================================================

do $$
declare
  v_admin uuid := (select profile_id from tmp_profiles where key = 'admin_andrea');
  v_paula uuid := (select profile_id from tmp_profiles where key = 'sup_paula');
  v_noelia uuid := (select profile_id from tmp_profiles where key = 'sup_noelia');
  v_criterios jsonb := (select jsonb_agg(jsonb_build_object('title', title, 'description', description) order by position) from public.rating_criteria);
  v_shift_id uuid;
  v_assignment_id uuid;
  v_supervision_id uuid;
begin
  -- Hace 3 días: Grupo Norte - San Isidro (mañana), supervisada por Paula Lemos, María Gómez.
  select sh.id into v_shift_id
  from public.shifts sh
  join tmp_services ts on ts.service_id = sh.service_id
  where ts.key = 'gn_sanisidro_manana' and sh.shift_date = app.today() - 3;

  select a.id into v_assignment_id from public.assignments a where a.shift_id = v_shift_id and a.removed_at is null;

  insert into public.supervisions (shift_id, supervisor_id, status, assigned_by, assigned_at, general_notes, criteria_snapshot, created_by)
  values (v_shift_id, v_paula, 'completed', v_admin, app.local_ts(app.today() - 3, '07:45'), 'Turno controlado, todo en orden.', v_criterios, v_admin)
  returning id into v_supervision_id;

  insert into public.supervision_attendance (supervision_id, kind, recorded_at)
  values
    (v_supervision_id, 'check_in', app.local_ts(app.today() - 3, '07:45')),
    (v_supervision_id, 'check_out', app.local_ts(app.today() - 3, '12:10'));

  insert into public.ratings (supervision_id, assignment_id, score, comment, created_by)
  values (v_supervision_id, v_assignment_id, 5, 'Excelente desempeño, cumplió el checklist completo.', v_paula);

  -- Hace 5 días: Clínica del Parque - Martínez (mañana), supervisada por Noelia Vera, Juan Pérez.
  select sh.id into v_shift_id
  from public.shifts sh
  join tmp_services ts on ts.service_id = sh.service_id
  where ts.key = 'cp_martinez_manana' and sh.shift_date = app.today() - 5;

  select a.id into v_assignment_id from public.assignments a where a.shift_id = v_shift_id and a.removed_at is null;

  insert into public.supervisions (shift_id, supervisor_id, status, assigned_by, assigned_at, general_notes, criteria_snapshot, created_by)
  values (v_shift_id, v_noelia, 'completed', v_admin, app.local_ts(app.today() - 5, '07:50'), 'Faltó reponer jabón en el baño de planta baja.', v_criterios, v_admin)
  returning id into v_supervision_id;

  insert into public.supervision_attendance (supervision_id, kind, recorded_at)
  values
    (v_supervision_id, 'check_in', app.local_ts(app.today() - 5, '07:50')),
    (v_supervision_id, 'check_out', app.local_ts(app.today() - 5, '13:05'));

  insert into public.ratings (supervision_id, assignment_id, score, comment, created_by)
  values (v_supervision_id, v_assignment_id, 4, 'Buen trabajo en general; ver observación de insumos.', v_noelia);
end $$;

-- =================================================================================================
-- 12. Insumos y control de stock (módulo E, P25.1): 4 categorías, 16 artículos de limpieza
--     inventados (más uno discontinuado), con presentaciones, códigos internos, precios de costo y
--     de venta, mínimos y stock variado (algunos en cero = rojo, algunos igual o bajo el mínimo =
--     amarillo, algunos sin mínimo), con la historia que lo explica: dos ingresos, retiros de
--     empleados y de una coordinadora sobre turnos del seed, uno cargado por la administración en
--     nombre de otra persona y después anulado, dos ajustes, un control de stock y dos avisos de
--     faltante (uno abierto y uno resuelto).
--
--     Los movimientos pasan por el mismo núcleo que usan las RPC (app.stock_post_movement), con la
--     hora pasada (las RPC siempre usan now()): así el stock, el stock resultante de cada línea y
--     los precios de cada línea quedan coherentes. Las horas son relativas a «hoy» y nunca van al
--     futuro. Solo para App_dev: nada de esto va a producción.
-- =================================================================================================

create temporary table tmp_supply_categories (key text primary key, id uuid not null default gen_random_uuid()) on commit drop;
insert into tmp_supply_categories (key) values ('quimicos'), ('descartables'), ('proteccion'), ('utensilios');

insert into public.supply_categories (id, name, sort_order, active, created_by)
select c.id, d.name, d.sort_order, true, (select profile_id from tmp_profiles where key = 'admin_andrea')
from tmp_supply_categories c
join (
  values
    ('quimicos', 'Químicos de limpieza', 10),
    ('descartables', 'Descartables', 20),
    ('proteccion', 'Protección personal', 30),
    ('utensilios', 'Utensilios', 40)
) as d (key, name, sort_order) on d.key = c.key;

-- Artículos. La columna `stock` es el stock FINAL esperado: la historia de más abajo lo explica y
-- el bloque de verificación del final falla si no coincide. DES-004 arranca con el precio viejo y
-- sube en la historia (queda en el historial de precios). QUI-001 arranca con el costo viejo y lo
-- actualiza el segundo ingreso (IS-23).
create temporary table tmp_seed_supplies (
  code text primary key,
  category_key text not null,
  name text not null,
  presentation text,
  min_qty integer,
  cost_price numeric(12, 2) not null,
  sale_price numeric(12, 2) not null,
  stock integer not null,
  active boolean not null default true
) on commit drop;

insert into tmp_seed_supplies (code, category_key, name, presentation, min_qty, cost_price, sale_price, stock, active)
values
  ('QUI-001', 'quimicos', 'Lavandina', '1 L', 12, 780.00, 1092.00, 24, true),
  ('QUI-002', 'quimicos', 'Lavandina', '5 L', 4, 3900.00, 5460.00, 3, true),
  ('QUI-003', 'quimicos', 'Detergente concentrado', '500 ml', 10, 1200.00, 1680.00, 0, true),
  ('QUI-004', 'quimicos', 'Desengrasante', '5 L', 3, 6200.00, 8680.00, 6, true),
  ('QUI-005', 'quimicos', 'Limpiavidrios con gatillo', '500 ml', 8, 1500.00, 2100.00, 8, true),
  ('DES-001', 'descartables', 'Bolsas de residuo 60 x 90', 'paquete x 10', 15, 1800.00, 2520.00, 40, true),
  ('DES-002', 'descartables', 'Bolsas de residuo 50 x 70', 'paquete x 10', 10, 1500.00, 2100.00, 4, true),
  ('DES-003', 'descartables', 'Papel higiénico 300 m', 'bolsón x 8', 5, 9800.00, 13720.00, 12, true),
  ('DES-004', 'descartables', 'Toalla de papel intercalada', 'caja x 2400', null, 13800.00, 19320.00, 5, true),
  ('DES-005', 'descartables', 'Jabón líquido de manos', '5 L', 3, 5400.00, 7560.00, 0, true),
  ('PRO-001', 'proteccion', 'Guantes de látex talle M', 'caja x 100', 4, 7200.00, 10080.00, 9, true),
  ('PRO-002', 'proteccion', 'Guantes de nitrilo talle L', 'caja x 100', null, 9800.00, 13720.00, 0, true),
  ('PRO-003', 'proteccion', 'Barbijo descartable', 'caja x 50', 3, 3500.00, 4900.00, 2, true),
  ('UTE-001', 'utensilios', 'Esponja doble faz', 'paquete x 10', 6, 2100.00, 2940.00, 14, true),
  ('UTE-002', 'utensilios', 'Trapo de piso', 'unidad', 10, 1300.00, 1820.00, 22, true),
  ('UTE-003', 'utensilios', 'Mopa de algodón 400 g', 'unidad', null, 3600.00, 5040.00, 7, true),
  ('UTE-009', 'utensilios', 'Balde de 10 L (discontinuado)', 'unidad', null, 2500.00, 3500.00, 0, false);

insert into public.supplies (code, name, presentation, category_id, min_qty, cost_price, sale_price, active, notes, created_by, created_at)
select s.code, s.name, s.presentation, c.id, s.min_qty, s.cost_price, s.sale_price, s.active,
       case when s.code = 'DES-004' then 'Se compra por caja cerrada.' end,
       (select profile_id from tmp_profiles where key = 'admin_andrea'),
       app.local_ts(app.today() - 21, '08:30')
from tmp_seed_supplies s
join tmp_supply_categories c on c.key = s.category_key;

-- Primer precio de cada artículo en el historial (source create).
insert into public.supply_price_changes (supply_id, old_cost_price, new_cost_price, old_sale_price, new_sale_price, source, changed_by, changed_at)
select s.id, null, s.cost_price, null, s.sale_price, 'create',
       (select profile_id from tmp_profiles where key = 'admin_andrea'), app.local_ts(app.today() - 21, '08:30')
from public.supplies s;

-- Atajo: arma las líneas del núcleo a partir de [{code, qty, unit_cost?, update_cost?}].
create function pg_temp.seed_lines(p_lines jsonb, p_sign integer)
returns jsonb
language sql
as $$
  select jsonb_agg(
    jsonb_build_object('supply_id', s.id, 'qty_delta', (x ->> 'qty')::integer * p_sign)
    || case when x ? 'unit_cost'
         then jsonb_build_object('unit_cost', x -> 'unit_cost', 'update_cost', coalesce(x -> 'update_cost', 'false'::jsonb))
         else '{}'::jsonb end
  )
  from jsonb_array_elements(p_lines) as x
  join public.supplies s on s.code = x ->> 'code';
$$;

-- Atajo: un turno del seed con una asignación vigente, el más reciente en o antes de «hoy + días»
-- (hasta 4 días hacia atrás, por los fines de semana). p_skip elige otro de la misma fecha.
create function pg_temp.seed_shift(p_days integer, p_skip integer)
returns table (shift_id uuid, site_id uuid, employee_id uuid, shift_date date)
language sql
as $$
  select sh.id, sh.site_id, a.employee_id, sh.shift_date
  from public.shifts sh
  join public.assignments a on a.shift_id = sh.id and a.removed_at is null
  where sh.deleted_at is null and sh.status <> 'cancelled'
    and sh.shift_date <= app.today() + p_days and sh.shift_date >= app.today() + p_days - 4
  order by sh.shift_date desc, sh.start_time, sh.id
  offset p_skip limit 1;
$$;

do $$
declare
  v_admin uuid := (select profile_id from tmp_profiles where key = 'admin_andrea');
  v_paula uuid := (select profile_id from tmp_profiles where key = 'sup_paula');
  v_juan uuid := (select profile_id from tmp_profiles where key = 'emp_juan');
  v_maria uuid := (select profile_id from tmp_profiles where key = 'emp_maria');
  v_carlos uuid := (select profile_id from tmp_profiles where key = 'emp_carlos');
  v_site_coord uuid := (select site_id from tmp_sites where key = 'lc_munro');
  v_prev timestamptz := now() - interval '30 days';
  v_at timestamptz;
  v_sh record;
  v_mov uuid;
  v_orig uuid;
  v_count_id uuid := gen_random_uuid();
  v_counted_at timestamptz;
  v_lines jsonb := '[]'::jsonb;
  v_lines_diff jsonb := '[]'::jsonb;
  r record;
  v_system integer;
  v_counted integer;
  v_bad text;
begin
  -- Ingreso 1 (hace 20 días): carga inicial del depósito. Cantidades iniciales = stock final +
  -- lo que sale en la historia (ver el comentario del bloque).
  v_at := app.local_ts(app.today() - 20, '09:00');
  v_mov := app.stock_post_movement('entry', v_admin,
    pg_temp.seed_lines(jsonb_build_array(
      jsonb_build_object('code', 'QUI-001', 'qty', 17), jsonb_build_object('code', 'QUI-002', 'qty', 4),
      jsonb_build_object('code', 'QUI-003', 'qty', 6), jsonb_build_object('code', 'QUI-004', 'qty', 8),
      jsonb_build_object('code', 'QUI-005', 'qty', 11), jsonb_build_object('code', 'DES-001', 'qty', 42),
      jsonb_build_object('code', 'DES-002', 'qty', 9), jsonb_build_object('code', 'DES-003', 'qty', 9),
      jsonb_build_object('code', 'DES-004', 'qty', 5), jsonb_build_object('code', 'DES-005', 'qty', 3),
      jsonb_build_object('code', 'PRO-001', 'qty', 10), jsonb_build_object('code', 'PRO-002', 'qty', 2),
      jsonb_build_object('code', 'PRO-003', 'qty', 1), jsonb_build_object('code', 'UTE-001', 'qty', 15),
      jsonb_build_object('code', 'UTE-002', 'qty', 25), jsonb_build_object('code', 'UTE-003', 'qty', 7)), 1),
    'normal', v_at, p_supplier => 'Distribuidora Limpia Sur S.A.', p_document_number => 'R-0001-00004512',
    p_note => 'Carga inicial del depósito');
  v_prev := v_at;

  -- Ingreso 2 (hace 12 días): reposición con otro proveedor. La lavandina de 1 L se compró a
  -- $ 850 y se actualiza su costo vigente (antes $ 780): queda en el historial de precios.
  v_at := app.local_ts(app.today() - 12, '10:30');
  v_mov := app.stock_post_movement('entry', v_admin,
    pg_temp.seed_lines(jsonb_build_array(
      jsonb_build_object('code', 'QUI-001', 'qty', 12, 'unit_cost', 850.00, 'update_cost', true),
      jsonb_build_object('code', 'DES-003', 'qty', 4), jsonb_build_object('code', 'PRO-003', 'qty', 2)), 1),
    'normal', v_at, p_supplier => 'Química Norte S.R.L.', p_document_number => 'FC-A-0008-00001234');
  -- La venta de la lavandina de 1 L acompaña al costo (cambio manual, mismo momento).
  update public.supplies set sale_price = 1190.00 where code = 'QUI-001';
  insert into public.supply_price_changes (supply_id, old_cost_price, new_cost_price, old_sale_price, new_sale_price, source, changed_by, changed_at)
  select id, 850.00, 850.00, 1092.00, 1190.00, 'manual', v_admin, v_at + interval '5 minutes' from public.supplies where code = 'QUI-001';
  v_prev := v_at;

  -- Aumento de la toalla de papel (hace 10 días): costo de $ 13.800 a $ 14.500.
  v_at := app.local_ts(app.today() - 10, '11:00');
  update public.supplies set cost_price = 14500.00, sale_price = 20300.00 where code = 'DES-004';
  insert into public.supply_price_changes (supply_id, old_cost_price, new_cost_price, old_sale_price, new_sale_price, source, changed_by, changed_at)
  select id, 13800.00, 14500.00, 19320.00, 20300.00, 'manual', v_admin, v_at from public.supplies where code = 'DES-004';
  v_prev := v_at;

  -- Retiro de un empleado en su turno (hace ~9 días).
  select * into v_sh from pg_temp.seed_shift(-9, 0);
  v_at := greatest(v_prev, app.local_ts(v_sh.shift_date, '07:30'));
  v_mov := app.stock_post_movement('withdrawal', v_sh.employee_id,
    pg_temp.seed_lines(jsonb_build_array(
      jsonb_build_object('code', 'QUI-001', 'qty', 2), jsonb_build_object('code', 'DES-001', 'qty', 2),
      jsonb_build_object('code', 'UTE-001', 'qty', 1)), -1),
    'normal', v_at, p_person_id => v_sh.employee_id, p_shift_id => v_sh.shift_id, p_site_id => v_sh.site_id);
  v_prev := v_at;

  -- Retiro (hace ~8 días).
  select * into v_sh from pg_temp.seed_shift(-8, 2);
  v_at := greatest(v_prev, app.local_ts(v_sh.shift_date, '07:30'));
  v_mov := app.stock_post_movement('withdrawal', v_sh.employee_id,
    pg_temp.seed_lines(jsonb_build_array(
      jsonb_build_object('code', 'QUI-003', 'qty', 4), jsonb_build_object('code', 'DES-005', 'qty', 1)), -1),
    'normal', v_at, p_person_id => v_sh.employee_id, p_shift_id => v_sh.shift_id, p_site_id => v_sh.site_id,
    p_note => 'Se estaba terminando el detergente');
  v_prev := v_at;

  -- Retiro (hace ~7 días).
  select * into v_sh from pg_temp.seed_shift(-7, 4);
  v_at := greatest(v_prev, app.local_ts(v_sh.shift_date, '07:30'));
  v_mov := app.stock_post_movement('withdrawal', v_sh.employee_id,
    pg_temp.seed_lines(jsonb_build_array(
      jsonb_build_object('code', 'QUI-002', 'qty', 1), jsonb_build_object('code', 'DES-002', 'qty', 3),
      jsonb_build_object('code', 'PRO-002', 'qty', 2)), -1),
    'normal', v_at, p_person_id => v_sh.employee_id, p_shift_id => v_sh.shift_id, p_site_id => v_sh.site_id);
  v_prev := v_at;

  -- Retiro (hace ~6 días).
  select * into v_sh from pg_temp.seed_shift(-6, 1);
  v_at := greatest(v_prev, app.local_ts(v_sh.shift_date, '07:30'));
  v_mov := app.stock_post_movement('withdrawal', v_sh.employee_id,
    pg_temp.seed_lines(jsonb_build_array(
      jsonb_build_object('code', 'QUI-005', 'qty', 2), jsonb_build_object('code', 'UTE-002', 'qty', 3),
      jsonb_build_object('code', 'DES-005', 'qty', 2), jsonb_build_object('code', 'PRO-001', 'qty', 1)), -1),
    'normal', v_at, p_person_id => v_sh.employee_id, p_shift_id => v_sh.shift_id, p_site_id => v_sh.site_id);
  v_prev := v_at;

  -- Control de stock (hace 5 días, 17:00), cargado 20 minutos después por Andrea (IS-16, IS-31):
  -- cuatro artículos contados; en el desengrasante falta una unidad, los demás coinciden.
  v_counted_at := greatest(v_prev, app.local_ts(app.today() - 5, '17:00'));
  v_at := v_counted_at + interval '20 minutes';
  insert into public.stock_counts (id, counted_at, reviewer_id, notes, created_at, created_by)
  values (v_count_id, v_counted_at, v_admin, 'Control mensual del depósito', v_at, v_admin);
  for r in
    select s.id, s.code from public.supplies s
    where s.code in ('QUI-004', 'DES-001', 'UTE-002', 'PRO-001') order by s.id
  loop
    v_system := app.supply_stock_at(r.id, v_counted_at);
    v_counted := case when r.code = 'QUI-004' then v_system - 1 else v_system end;
    insert into public.stock_count_lines (count_id, supply_id, system_qty, counted_qty, difference)
    values (v_count_id, r.id, v_system, v_counted, v_counted - v_system);
    if v_counted <> v_system then
      v_lines_diff := v_lines_diff || jsonb_build_array(
        jsonb_build_object('supply_id', r.id, 'qty_delta', v_counted - v_system));
    end if;
  end loop;
  v_mov := app.stock_post_movement('count', v_admin, v_lines_diff, 'count', v_at,
    p_note => 'Control mensual del depósito', p_count_id => v_count_id);
  v_prev := v_at;

  -- Retiro cargado por la administración en nombre de Juan Pérez (hace ~4 días), que después se
  -- anula porque se cargó dos veces (IS-27: contramovimiento enlazado, original «Anulado»).
  select * into v_sh from pg_temp.seed_shift(-4, 3);
  v_at := greatest(v_prev, app.local_ts(v_sh.shift_date, '16:00'));
  v_orig := app.stock_post_movement('withdrawal', v_admin,
    pg_temp.seed_lines(jsonb_build_array(jsonb_build_object('code', 'DES-001', 'qty', 4)), -1),
    'normal', v_at, p_person_id => v_juan, p_shift_id => v_sh.shift_id, p_site_id => v_sh.site_id,
    p_note => 'Cargado por la oficina a pedido de Juan');
  v_prev := v_at;

  -- Ajuste por rotura (hace 4 días).
  v_at := greatest(v_prev, app.local_ts(app.today() - 4, '17:30'));
  v_mov := app.stock_post_movement('adjustment', v_admin,
    pg_temp.seed_lines(jsonb_build_array(jsonb_build_object('code', 'DES-002', 'qty', -2)), 1),
    'normal', v_at, p_reason => 'breakage', p_note => 'Caja golpeada en el depósito');
  v_prev := v_at;

  -- Anulación del retiro cargado dos veces (hace 3 días) y ajuste por vencimiento.
  v_at := greatest(v_prev, app.local_ts(app.today() - 3, '09:15'));
  v_mov := app.stock_post_movement('reversal', v_admin,
    pg_temp.seed_lines(jsonb_build_array(jsonb_build_object('code', 'DES-001', 'qty', 4)), 1),
    'void', v_at, p_person_id => v_juan,
    p_shift_id => (select shift_id from public.stock_movements where id = v_orig),
    p_site_id => (select site_id from public.stock_movements where id = v_orig),
    p_note => 'Se cargó dos veces', p_reverses_id => v_orig);
  update public.stock_movements
  set voided_at = v_at, voided_by = v_admin, void_reason = 'Se cargó dos veces'
  where id = v_orig;
  v_prev := v_at;

  v_at := greatest(v_prev, app.local_ts(app.today() - 3, '17:30'));
  v_mov := app.stock_post_movement('adjustment', v_admin,
    pg_temp.seed_lines(jsonb_build_array(jsonb_build_object('code', 'QUI-005', 'qty', -1)), 1),
    'normal', v_at, p_reason => 'expired', p_note => 'Un envase vencido');
  v_prev := v_at;

  -- Retiro de la coordinadora Paula Lemos para una sede, sin turno puntual (hace 2 días).
  v_at := greatest(v_prev, app.local_ts(app.today() - 2, '08:10'));
  v_mov := app.stock_post_movement('withdrawal', v_paula,
    pg_temp.seed_lines(jsonb_build_array(
      jsonb_build_object('code', 'QUI-001', 'qty', 3), jsonb_build_object('code', 'QUI-003', 'qty', 2)), -1),
    'normal', v_at, p_person_id => v_paula, p_site_id => v_site_coord,
    p_note => 'Reposición de la semana');
  v_prev := v_at;

  -- Retiro (ayer).
  select * into v_sh from pg_temp.seed_shift(-1, 5);
  v_at := least(now(), greatest(v_prev, app.local_ts(v_sh.shift_date, '07:30')));
  v_mov := app.stock_post_movement('withdrawal', v_sh.employee_id,
    pg_temp.seed_lines(jsonb_build_array(
      jsonb_build_object('code', 'DES-003', 'qty', 1), jsonb_build_object('code', 'PRO-003', 'qty', 1),
      jsonb_build_object('code', 'QUI-004', 'qty', 1)), -1),
    'normal', v_at, p_person_id => v_sh.employee_id, p_shift_id => v_sh.shift_id, p_site_id => v_sh.site_id);

  -- El stock final tiene que coincidir con el esperado de la tabla de artículos.
  select string_agg(format('%s: esperado %s, quedó %s', s.code, t.stock, s.stock_qty), '; ')
  into v_bad
  from public.supplies s
  join tmp_seed_supplies t on t.code = s.code
  where s.stock_qty <> t.stock;
  if v_bad is not null then
    raise exception using errcode = 'P0001', message = 'El stock del seed de insumos no coincide: ' || v_bad;
  end if;

  -- Avisos de faltante (IS-14, IS-29): uno abierto de María Gómez por el jabón (sin stock), con su
  -- turno de hoy si lo tiene, y uno resuelto de Carlos Medina, con texto libre.
  insert into public.supply_shortage_reports (reported_by, supply_id, shift_id, site_id, comment, status, created_at, created_by)
  select v_maria, (select id from public.supplies where code = 'DES-005'), sh.id, sh.site_id,
         'Se terminó el jabón del baño de planta baja.', 'open',
         least(now(), app.local_ts(app.today(), '09:20')), v_maria
  from (
    select s2.id, s2.site_id from public.shifts s2
    join public.assignments a on a.shift_id = s2.id and a.removed_at is null and a.employee_id = v_maria
    where s2.shift_date = app.today() and s2.deleted_at is null
    order by s2.start_time limit 1
  ) sh;
  -- Si María no tiene turno hoy, el aviso se carga sin turno.
  insert into public.supply_shortage_reports (reported_by, supply_id, comment, status, created_at, created_by)
  select v_maria, (select id from public.supplies where code = 'DES-005'),
         'Se terminó el jabón del baño de planta baja.', 'open',
         least(now(), app.local_ts(app.today(), '09:20')), v_maria
  where not exists (select 1 from public.supply_shortage_reports where reported_by = v_maria and status = 'open');

  insert into public.supply_shortage_reports (
    reported_by, description, comment, status, resolved_by, resolved_at, resolution_note, created_at, created_by
  )
  values (
    v_carlos, 'Cepillo para inodoro', 'No hay en el depósito de la sede.', 'resolved', v_admin,
    app.local_ts(app.today() - 5, '11:40'), 'Se compró en la ferretería, llega el jueves.',
    app.local_ts(app.today() - 6, '10:05'), v_carlos
  );
end $$;

commit;
