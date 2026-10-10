-- pgTAP de la migración 0038_p19_6b_supervisores_sin_tope.sql: las horas del supervisor
-- (v_supervisions_admin.worked_minutes) no usan el tope de AJ2-09. El caso con datos (entrada
-- 7:30, salida 11:00 en un turno desde las 8:00 → 210) está en el pgTAP de 0037.
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

select plan(2);

select ok(
  pg_get_viewdef('public.v_supervisions_admin'::regclass) not like '%capped_worked_minutes%',
  'v_supervisions_admin no usa app.capped_worked_minutes'
);

select is(
  (select attname::text from pg_attribute
   where attrelid = 'public.v_supervisions_admin'::regclass and attnum > 0 and not attisdropped
   order by attnum desc limit 1),
  'shift_open_ended',
  'v_supervisions_admin: mismas columnas, shift_open_ended sigue al final'
);

select * from finish();

rollback;
