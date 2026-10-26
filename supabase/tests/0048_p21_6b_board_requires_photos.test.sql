-- pgTAP de la migración 0048_p21_6b_board_requires_photos.sql (P21.6b):
--   v_shifts_board expone requires_photos (boolean), al final, igual al valor de shifts.requires_photos,
--   y conserva security_invoker.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

select plan(5);

select has_column('public', 'v_shifts_board', 'requires_photos', 'v_shifts_board tiene requires_photos');
select col_type_is('public', 'v_shifts_board', 'requires_photos', 'boolean', 'requires_photos es boolean');

select is(
  (select attname::text from pg_attribute
    where attrelid = 'public.v_shifts_board'::regclass and attnum > 0 and not attisdropped
    order by attnum desc limit 1 offset 1),
  'requires_photos',
  'requires_photos es la última columna de la vista'
);

select is(
  (select count(*)::int from public.v_shifts_board b
    join public.shifts s on s.id = b.id
    where b.requires_photos is distinct from s.requires_photos),
  0,
  'requires_photos de la vista coincide con shifts.requires_photos en todos los turnos'
);

select ok(
  (select coalesce(reloptions::text, '') like '%security_invoker=true%' from pg_class where oid = 'public.v_shifts_board'::regclass),
  'la vista conserva security_invoker = true'
);

select * from finish();

rollback;
