-- pgTAP de la migración 0005_clients_sites.sql (DB-007).
--
-- Cubre: estructura y restricciones de clients/client_contacts/sites, RLS habilitada (todavía sin
-- políticas: llegan en 0012, DB-014), unicidad de CUIT, el único contacto principal por cliente
-- (índice parcial), el nombre único de sede por cliente (índice parcial) y el
-- `unique (id, client_id)` de sites que habilita las FK compuestas de 0007.
--
-- Convención (ver supabase/tests/README.md): todo el archivo corre en una transacción que
-- termina en `rollback`.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

select plan(44);

-- Estructura ----------------------------------------------------------------------------------

select has_table('public', 'clients', 'existe public.clients');
select has_table('public', 'client_contacts', 'existe public.client_contacts');
select has_table('public', 'sites', 'existe public.sites');

select columns_are(
  'public', 'clients',
  array[
    'id', 'legal_name', 'trade_name', 'cuit', 'admin_address', 'latitude', 'longitude',
    'status', 'notes', 'created_at', 'updated_at', 'created_by', 'updated_by', 'deleted_at'
  ],
  'clients tiene exactamente las columnas de 04 sección 2.2'
);

select columns_are(
  'public', 'client_contacts',
  array[
    'id', 'client_id', 'name', 'role_title', 'phone', 'email', 'is_primary',
    'created_at', 'updated_at', 'created_by', 'updated_by', 'deleted_at'
  ],
  'client_contacts tiene exactamente las columnas de 04 sección 2.2'
);

select columns_are(
  'public', 'sites',
  array[
    'id', 'client_id', 'name', 'address', 'city', 'latitude', 'longitude', 'contact_name',
    'contact_phone', 'access_instructions', 'building_hours', 'phone_restricted',
    'photos_not_allowed', 'restrictions_notes', 'status',
    'created_at', 'updated_at', 'created_by', 'updated_by', 'deleted_at'
  ],
  'sites tiene exactamente las columnas de 04 sección 2.2'
);

select has_pk('public', 'clients', 'clients tiene primary key');
select has_pk('public', 'client_contacts', 'client_contacts tiene primary key');
select has_pk('public', 'sites', 'sites tiene primary key');

select col_not_null('public', 'clients', 'legal_name', 'clients.legal_name not null');
select col_not_null('public', 'client_contacts', 'client_id', 'client_contacts.client_id not null');
select col_not_null('public', 'client_contacts', 'name', 'client_contacts.name not null');
select col_not_null('public', 'sites', 'client_id', 'sites.client_id not null');
select col_not_null('public', 'sites', 'name', 'sites.name not null');
select col_not_null('public', 'sites', 'address', 'sites.address not null');

select col_default_is('public', 'client_contacts', 'is_primary', 'false', 'client_contacts.is_primary default false');
select col_default_is('public', 'sites', 'phone_restricted', 'false', 'sites.phone_restricted default false');
select col_default_is('public', 'sites', 'photos_not_allowed', 'false', 'sites.photos_not_allowed default false');

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.client_contacts'::regclass
      and contype = 'f'
      and confrelid = 'public.clients'::regclass
      and pg_get_constraintdef(oid) = 'FOREIGN KEY (client_id) REFERENCES clients(id)'
  ),
  'client_contacts.client_id referencia public.clients.id'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.sites'::regclass
      and contype = 'f'
      and confrelid = 'public.clients'::regclass
      and pg_get_constraintdef(oid) = 'FOREIGN KEY (client_id) REFERENCES clients(id)'
  ),
  'sites.client_id referencia public.clients.id'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.sites'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (id, client_id)'
  ),
  'sites tiene unique (id, client_id) para las FK compuestas de services/shifts'
);

select has_index('public', 'sites', 'sites_client_id_name_key', 'sites: índice único parcial de nombre por cliente');
select has_index('public', 'sites', 'sites_client_id_idx', 'sites: índice (client_id), 04 sección 8');
select has_index('public', 'client_contacts', 'client_contacts_one_primary_per_client_idx', 'client_contacts: índice único parcial de contacto principal');

-- Triggers --------------------------------------------------------------------------------------

select ok(
  exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'clients' and t.tgname = 'trg_set_updated_at'
  ),
  'clients tiene el trigger trg_set_updated_at'
);
select ok(
  exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'client_contacts' and t.tgname = 'trg_set_updated_at'
  ),
  'client_contacts tiene el trigger trg_set_updated_at'
);
select ok(
  exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'sites' and t.tgname = 'trg_set_updated_at'
  ),
  'sites tiene el trigger trg_set_updated_at'
);

-- RLS habilitada (sin políticas todavía) -------------------------------------------------------

select ok((select relrowsecurity from pg_class where oid = 'public.clients'::regclass), 'clients tiene RLS habilitada');
select ok((select relrowsecurity from pg_class where oid = 'public.client_contacts'::regclass), 'client_contacts tiene RLS habilitada');
select ok((select relrowsecurity from pg_class where oid = 'public.sites'::regclass), 'sites tiene RLS habilitada');

-- clients.status: nace 'active' aunque no se indique al crear ------------------------------------

insert into public.clients (id, legal_name) values ('d0000000-0000-0000-0000-000000000001', 'Grupo Norte SA');

select is(
  (select status::text from public.clients where id = 'd0000000-0000-0000-0000-000000000001'),
  'active',
  'clients.status nace en active sin indicarlo'
);

-- clients: unicidad de CUIT -----------------------------------------------------------------------

-- CUIT de fixture con prefijo "999" a propósito (DB-019, P04.6): los CUIT reales que carga
-- `supabase/seed.sql` en App_dev empiezan todos con "307" o "273" (Grupo Norte, Clínica del
-- Parque, etc.); este archivo corre en su propia transacción con `rollback`, pero igual conviene
-- que su fixture no coincida por casualidad con un CUIT real del seed.
update public.clients set cuit = '99911112223' where id = 'd0000000-0000-0000-0000-000000000001';

insert into public.clients (id, legal_name) values ('d0000000-0000-0000-0000-000000000002', 'Cliente de prueba DB-007 SA');

prepare client_duplicate_cuit as
  update public.clients set cuit = '99911112223' where id = 'd0000000-0000-0000-0000-000000000002';

select throws_ok(
  'client_duplicate_cuit',
  '23505',
  null,
  'rechaza dos clientes con el mismo CUIT'
);

update public.clients set cuit = '30798765432' where id = 'd0000000-0000-0000-0000-000000000002';

select is(
  (select cuit from public.clients where id = 'd0000000-0000-0000-0000-000000000002'),
  '30798765432',
  'permite CUIT distinto para el segundo cliente'
);

-- client_contacts: un solo contacto principal por cliente, entre los vigentes ---------------------

select lives_ok(
  $$insert into public.client_contacts (id, client_id, name, is_primary)
    values ('d0000000-0000-0000-0000-000000000010', 'd0000000-0000-0000-0000-000000000001', 'Ana Torres', true)$$,
  'permite crear el primer contacto principal del cliente'
);

prepare client_contact_second_primary as
  insert into public.client_contacts (id, client_id, name, is_primary)
  values ('d0000000-0000-0000-0000-000000000011', 'd0000000-0000-0000-0000-000000000001', 'Beto Ruiz', true);

select throws_ok(
  'client_contact_second_primary',
  '23505',
  null,
  'rechaza un segundo contacto principal para el mismo cliente'
);

select lives_ok(
  $$insert into public.client_contacts (id, client_id, name, is_primary)
    values ('d0000000-0000-0000-0000-000000000012', 'd0000000-0000-0000-0000-000000000001', 'Carla Díaz', false)$$,
  'permite varios contactos no principales para el mismo cliente'
);

select lives_ok(
  $$insert into public.client_contacts (id, client_id, name, is_primary)
    values ('d0000000-0000-0000-0000-000000000013', 'd0000000-0000-0000-0000-000000000002', 'Diego Paz', true)$$,
  'permite un contacto principal en otro cliente sin conflicto'
);

-- sites: nombre único por cliente, entre las sedes vigentes ---------------------------------------

select lives_ok(
  $$insert into public.sites (id, client_id, name, address)
    values ('d0000000-0000-0000-0000-000000000020', 'd0000000-0000-0000-0000-000000000001', 'Sede Centro', 'Av. Siempre Viva 123')$$,
  'permite crear la primera sede'
);

prepare site_duplicate_name_same_client as
  insert into public.sites (id, client_id, name, address)
  values ('d0000000-0000-0000-0000-000000000021', 'd0000000-0000-0000-0000-000000000001', 'Sede Centro', 'Otra dirección');

select throws_ok(
  'site_duplicate_name_same_client',
  '23505',
  null,
  'rechaza dos sedes con el mismo nombre para el mismo cliente'
);

select lives_ok(
  $$insert into public.sites (id, client_id, name, address)
    values ('d0000000-0000-0000-0000-000000000022', 'd0000000-0000-0000-0000-000000000002', 'Sede Centro', 'Av. Belgrano 456')$$,
  'permite el mismo nombre de sede en otro cliente'
);

update public.sites set deleted_at = now() where id = 'd0000000-0000-0000-0000-000000000020';

select lives_ok(
  $$insert into public.sites (id, client_id, name, address)
    values ('d0000000-0000-0000-0000-000000000023', 'd0000000-0000-0000-0000-000000000001', 'Sede Centro', 'Dirección nueva')$$,
  'permite reusar el nombre de una sede dada de baja lógica (índice parcial deleted_at is null)'
);

-- RLS habilitada + cero políticas deniega a authenticated (sanity check) ------------------------

set local role authenticated;

select is((select count(*)::int from public.clients), 0, 'clients: sin políticas, authenticated no ve ninguna fila');
select is((select count(*)::int from public.client_contacts), 0, 'client_contacts: sin políticas, authenticated no ve ninguna fila');
select is((select count(*)::int from public.sites), 0, 'sites: sin políticas, authenticated no ve ninguna fila');

select * from finish();

rollback;
