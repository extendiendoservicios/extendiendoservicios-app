-- pgTAP de la migración 0008_checklists_tasks.sql (DB-010).
--
-- Cubre: estructura de checklist_templates/checklist_template_items/shift_tasks, RLS habilitada
-- (sin políticas todavía, llegan en 0012, DB-014), la unicidad parcial de checklist_templates
-- (una por cliente y una por sede como máximo, ADR-011), la unicidad diferible de
-- checklist_template_items (template_id, position) -- reordenar en un lote sin violarla a mitad
-- de camino--, el check de shift_tasks.not_done_reason obligatorio cuando status = 'not_done', y
-- la FK que 0008 agrega a shifts.checklist_template_id (pendiente desde 0007, DB-009).
--
-- Convención (ver supabase/tests/README.md): todo el archivo corre en una transacción que
-- termina en `rollback`. Prefijo de fixtures propio de este archivo: '30000000-...'.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

select plan(39);

-- Estructura ------------------------------------------------------------------------------------

select has_table('public', 'checklist_templates', 'existe public.checklist_templates');
select has_table('public', 'checklist_template_items', 'existe public.checklist_template_items');
select has_table('public', 'shift_tasks', 'existe public.shift_tasks');

select columns_are(
  'public', 'checklist_templates',
  array['id', 'client_id', 'site_id', 'name', 'is_active', 'created_at', 'updated_at', 'created_by', 'updated_by', 'deleted_at'],
  'checklist_templates tiene exactamente las columnas de 04 sección 2.4'
);

select columns_are(
  'public', 'checklist_template_items',
  array['id', 'template_id', 'position', 'title', 'description', 'is_required', 'created_at', 'updated_at', 'created_by', 'updated_by', 'deleted_at'],
  'checklist_template_items tiene exactamente las columnas de 04 sección 2.4'
);

select columns_are(
  'public', 'shift_tasks',
  array[
    'id', 'shift_id', 'position', 'title', 'description', 'is_required', 'status',
    'not_done_reason', 'status_changed_at', 'status_changed_by',
    'created_at', 'updated_at', 'created_by', 'updated_by'
  ],
  'shift_tasks tiene exactamente las columnas de 04 sección 2.4'
);

select has_pk('public', 'checklist_templates', 'checklist_templates tiene primary key');
select has_pk('public', 'checklist_template_items', 'checklist_template_items tiene primary key');
select has_pk('public', 'shift_tasks', 'shift_tasks tiene primary key');

select col_not_null('public', 'checklist_templates', 'client_id', 'checklist_templates.client_id not null');
select col_not_null('public', 'checklist_templates', 'name', 'checklist_templates.name not null');
select col_not_null('public', 'checklist_template_items', 'template_id', 'checklist_template_items.template_id not null');
select col_not_null('public', 'checklist_template_items', 'title', 'checklist_template_items.title not null');
select col_not_null('public', 'shift_tasks', 'shift_id', 'shift_tasks.shift_id not null');
select col_not_null('public', 'shift_tasks', 'title', 'shift_tasks.title not null');
select col_not_null('public', 'shift_tasks', 'is_required', 'shift_tasks.is_required not null');

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.checklist_templates'::regclass
      and contype = 'f'
      and pg_get_constraintdef(oid) = 'FOREIGN KEY (site_id, client_id) REFERENCES sites(id, client_id)'
  ),
  'checklist_templates tiene la FK compuesta (site_id, client_id) -> sites(id, client_id)'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.shifts'::regclass
      and contype = 'f'
      and confrelid = 'public.checklist_templates'::regclass
      and pg_get_constraintdef(oid) = 'FOREIGN KEY (checklist_template_id) REFERENCES checklist_templates(id)'
  ),
  'shifts.checklist_template_id referencia public.checklist_templates.id (FK agregada en 0008, pendiente desde 0007)'
);

select ok((select relrowsecurity from pg_class where oid = 'public.checklist_templates'::regclass), 'checklist_templates tiene RLS habilitada');
select ok((select relrowsecurity from pg_class where oid = 'public.checklist_template_items'::regclass), 'checklist_template_items tiene RLS habilitada');
select ok((select relrowsecurity from pg_class where oid = 'public.shift_tasks'::regclass), 'shift_tasks tiene RLS habilitada');

select has_index('public', 'checklist_templates', 'checklist_templates_client_site_key', 'checklist_templates: índice único parcial (client_id, coalesce(site_id, ...))');
select has_index('public', 'shift_tasks', 'shift_tasks_shift_id_position_idx', 'shift_tasks: índice (shift_id, position)');

-- Fixtures: un cliente con dos sedes, y un turno de esa sede ---------------------------------------

insert into public.clients (id, legal_name) values ('30000000-0000-0000-0000-000000000001', 'Cliente de checklists');
insert into public.sites (id, client_id, name, address) values
  ('30000000-0000-0000-0000-000000000011', '30000000-0000-0000-0000-000000000001', 'Sede Uno', 'Dirección uno'),
  ('30000000-0000-0000-0000-000000000012', '30000000-0000-0000-0000-000000000001', 'Sede Dos', 'Dirección dos');
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff)
values ('30000000-0000-0000-0000-000000000040', '30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000011', '2026-05-04', '08:00', '12:00', 1);

-- checklist_templates: valor por defecto de is_active ----------------------------------------------

insert into public.checklist_templates (id, client_id, name)
values ('30000000-0000-0000-0000-000000000020', '30000000-0000-0000-0000-000000000001', 'Plantilla del cliente');

select is(
  (select is_active from public.checklist_templates where id = '30000000-0000-0000-0000-000000000020'),
  true,
  'checklist_templates.is_active nace en true sin indicarlo'
);

-- checklist_templates: unicidad parcial -- una por cliente (site_id null) --------------------------

prepare checklist_template_duplicate_client as
  insert into public.checklist_templates (client_id, name)
  values ('30000000-0000-0000-0000-000000000001', 'Segunda plantilla del mismo cliente');

select throws_ok(
  'checklist_template_duplicate_client', '23505', null,
  'rechaza una segunda plantilla de cliente (site_id null) para el mismo client_id'
);

-- checklist_templates: unicidad parcial -- una por sede -------------------------------------------

select lives_ok(
  $$insert into public.checklist_templates (id, client_id, site_id, name)
    values ('30000000-0000-0000-0000-000000000021', '30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000011', 'Plantilla de Sede Uno')$$,
  'permite una plantilla propia para una sede además de la del cliente'
);

prepare checklist_template_duplicate_site as
  insert into public.checklist_templates (client_id, site_id, name)
  values ('30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000011', 'Segunda plantilla de la misma sede');

select throws_ok(
  'checklist_template_duplicate_site', '23505', null,
  'rechaza una segunda plantilla para la misma sede'
);

select lives_ok(
  $$insert into public.checklist_templates (client_id, site_id, name)
    values ('30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000012', 'Plantilla de Sede Dos')$$,
  'permite una plantilla propia para otra sede del mismo cliente'
);

-- checklist_templates: la FK compuesta rechaza una sede que no pertenece al cliente indicado -----

insert into public.clients (id, legal_name) values ('30000000-0000-0000-0000-000000000002', 'Otro cliente');

prepare checklist_template_site_client_mismatch as
  insert into public.checklist_templates (client_id, site_id, name)
  values ('30000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000011', 'Plantilla con sede ajena');

select throws_ok(
  'checklist_template_site_client_mismatch', '23503', null,
  'rechaza una plantilla con site_id que no pertenece a client_id (FK compuesta)'
);

-- checklist_template_items: valor por defecto de is_required ---------------------------------------

insert into public.checklist_template_items (id, template_id, position, title)
values ('30000000-0000-0000-0000-000000000030', '30000000-0000-0000-0000-000000000020', 1, 'Barrer y trapear');

select is(
  (select is_required from public.checklist_template_items where id = '30000000-0000-0000-0000-000000000030'),
  true,
  'checklist_template_items.is_required nace en true sin indicarlo (P-059)'
);

-- checklist_template_items: unicidad (template_id, position). La restricción es "deferrable
-- initially deferred" (para permitir el reordenamiento en lote, más abajo): un INSERT duplicado
-- no falla en el momento, sino recién al verificarse los constraints diferidos (commit, o un
-- `set constraints ... immediate` explícito). Como los tests de este archivo nunca hacen commit
-- (terminan en rollback), se fuerza la verificación con `set constraints ... immediate` dentro de
-- la misma sentencia dinámica que hace el insert, para poder capturar el error con throws_ok
-- sin depender de un commit real.
select throws_ok(
  $$insert into public.checklist_template_items (template_id, position, title)
    values ('30000000-0000-0000-0000-000000000020', 1, 'Otro ítem en la misma posición');
    set constraints checklist_template_items_template_id_position_key immediate$$,
  '23505', null,
  'rechaza dos ítems de la misma plantilla en la misma posición (constraint deferrable: se fuerza a immediate para verla sin necesidad de un commit)'
);

-- checklist_template_items: unicidad diferible -- reordenar (swap) en un solo UPDATE no falla ----

insert into public.checklist_template_items (id, template_id, position, title)
values ('30000000-0000-0000-0000-000000000031', '30000000-0000-0000-0000-000000000020', 2, 'Vaciar cestos');

select lives_ok(
  $$update public.checklist_template_items
    set position = case id
      when '30000000-0000-0000-0000-000000000030' then 2
      when '30000000-0000-0000-0000-000000000031' then 1
    end
    where id in ('30000000-0000-0000-0000-000000000030', '30000000-0000-0000-0000-000000000031')$$,
  'permite intercambiar la posición de dos ítems en un solo UPDATE (unicidad deferrable initially deferred)'
);

-- shift_tasks: valor por defecto de status ---------------------------------------------------------

insert into public.shift_tasks (id, shift_id, position, title, is_required)
values ('30000000-0000-0000-0000-000000000050', '30000000-0000-0000-0000-000000000040', 1, 'Barrer y trapear', true);

select is(
  (select status::text from public.shift_tasks where id = '30000000-0000-0000-0000-000000000050'),
  'pending',
  'shift_tasks.status nace en pending sin indicarlo (04 sección 6.3)'
);

-- shift_tasks: not_done_reason obligatorio cuando status = not_done -------------------------------

prepare shift_task_not_done_missing_reason as
  update public.shift_tasks set status = 'not_done' where id = '30000000-0000-0000-0000-000000000050';

select throws_ok(
  'shift_task_not_done_missing_reason', '23514', null,
  'rechaza marcar una tarea not_done sin not_done_reason'
);

select lives_ok(
  $$update public.shift_tasks set status = 'not_done', not_done_reason = 'faltó insumo' where id = '30000000-0000-0000-0000-000000000050'$$,
  'permite marcar una tarea not_done con motivo'
);

select lives_ok(
  $$update public.shift_tasks set status = 'pending', not_done_reason = null where id = '30000000-0000-0000-0000-000000000050'$$,
  'permite volver a pending (04 sección 6.3: se puede corregir mientras dure el turno)'
);

-- RLS habilitada + cero políticas deniega a authenticated (sanity check) ------------------------

set local role authenticated;

select is((select count(*)::int from public.checklist_templates), 0, 'checklist_templates: sin políticas, authenticated no ve ninguna fila');
select is((select count(*)::int from public.checklist_template_items), 0, 'checklist_template_items: sin políticas, authenticated no ve ninguna fila');
select is((select count(*)::int from public.shift_tasks), 0, 'shift_tasks: sin políticas, authenticated no ve ninguna fila');

select * from finish();

rollback;
