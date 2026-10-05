-- scripts/lib/verificar-datos.sql — TEST-024 (ADR-015, 03 sección 14.1: "el volcado se restaura y
-- la app funciona sobre él")
--
-- Verifica, después de restaurar los datos, lo que `pg_restore` no comprueba porque la carga corre
-- con `session_replication_role = replica` (que apaga las claves foráneas y los triggers):
--   1. Integridad referencial: ninguna fila de public apunta a algo que no existe (todas las claves
--      foráneas de public, incluidas las que van hacia auth.users).
--   2. Que la app "funciona sobre los datos": se toma una persona owner/admin activa, se arma su
--      token con el hook de Auth real (app.custom_access_token_hook) y, ya como `authenticated` con
--      ese token, se comprueba que las políticas RLS le dejan ver las mismas filas que ve el dueño
--      de las tablas. Es lo que hace la app en cada pantalla de administración, sin pasar por
--      HTTP. Si no hay ninguna persona owner/admin activa, la comprobación queda OMITIDA y lo dice
--      (hoy `App` no tiene usuarios: ver docs/restore-test.md).
--
-- Solo lecturas (la sesión simulada vive dentro de la transacción de la función y se descarta).
-- Salida: `comprobacion|estado|detalle`, con estado OK, FALLA u OMITIDA. Nunca imprime contenido
-- de las filas: solo nombres de tablas, restricciones y cantidades.
--
-- Se corre con `psql -X -q -A -t -F '|' -v ON_ERROR_STOP=1 -f scripts/lib/verificar-datos.sql`.

-- ---------------------------------------------------------------------------------------------
-- 1. Claves foráneas huérfanas
-- ---------------------------------------------------------------------------------------------
create or replace function pg_temp.verificar_claves_foraneas()
returns table (comprobacion text, estado text, detalle text)
language plpgsql
as $fn$
declare
  r record;
  v_huerfanas bigint;
  v_total int := 0;
  v_con_huerfanas int := 0;
  v_lista text := '';
begin
  for r in
    select c.conname,
           c.conrelid::regclass::text as tabla_hija,
           c.confrelid::regclass::text as tabla_padre,
           (select string_agg(format('c.%I', a.attname), ', ' order by k.ord)
              from unnest(c.conkey) with ordinality as k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as cols_hija,
           (select string_agg(format('p.%I', a.attname), ', ' order by k.ord)
              from unnest(c.confkey) with ordinality as k(attnum, ord)
              join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum) as cols_padre,
           (select string_agg(format('c.%I is not null', a.attname), ' and ' order by k.ord)
              from unnest(c.conkey) with ordinality as k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as no_nulas,
           (select string_agg(format('p.%I = c.%I', ap.attname, ac.attname), ' and ' order by k.ord)
              from unnest(c.conkey, c.confkey) with ordinality as k(hija, padre, ord)
              join pg_attribute ac on ac.attrelid = c.conrelid and ac.attnum = k.hija
              join pg_attribute ap on ap.attrelid = c.confrelid and ap.attnum = k.padre) as cruce
    from pg_constraint c
    where c.contype = 'f' and c.connamespace = 'public'::regnamespace
    order by c.conrelid::regclass::text, c.conname
  loop
    v_total := v_total + 1;
    -- MATCH SIMPLE (el de Postgres por defecto): si alguna columna de la clave es nula, no se comprueba.
    execute format(
      'select count(*) from %s c where %s and not exists (select 1 from %s p where %s)',
      r.tabla_hija, r.no_nulas, r.tabla_padre, r.cruce)
      into v_huerfanas;
    if v_huerfanas > 0 then
      v_con_huerfanas := v_con_huerfanas + 1;
      v_lista := v_lista || format('%s.%s (%s filas) ', r.tabla_hija, r.conname, v_huerfanas);
    end if;
  end loop;

  return query select 'claves_foraneas_sin_huerfanas',
    case when v_total > 0 and v_con_huerfanas = 0 then 'OK' else 'FALLA' end,
    case when v_total = 0 then 'no se encontró ninguna clave foránea en public (raro)'
         when v_con_huerfanas = 0 then v_total || ' claves foráneas revisadas, ninguna fila huérfana'
         else 'filas huérfanas en: ' || v_lista end;
end
$fn$;

-- ---------------------------------------------------------------------------------------------
-- 2. Sesión simulada de una persona owner/admin con el token que arma el hook de Auth
-- ---------------------------------------------------------------------------------------------
create or replace function pg_temp.verificar_sesion_simulada()
returns table (comprobacion text, estado text, detalle text)
language plpgsql
as $fn$
declare
  v_uid uuid;
  v_evento jsonb;
  v_claims jsonb;
  t text;
  v_esperado bigint;
  v_visto bigint;
  v_mal text := '';
  v_n int := 0;
begin
  select ur.profile_id into v_uid
  from public.user_roles ur
  join public.profiles p on p.id = ur.profile_id
  where ur.role in ('owner', 'admin') and p.is_active and p.deleted_at is null
  order by (ur.role = 'owner') desc, ur.profile_id
  limit 1;

  if v_uid is null then
    return query select 'sesion_simulada_admin', 'OMITIDA',
      'no hay ninguna persona owner/admin activa en los datos: no se puede ejercitar el hook ni la RLS';
    return;
  end if;

  v_evento := app.custom_access_token_hook(jsonb_build_object(
    'user_id', v_uid,
    'claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated', 'aud', 'authenticated')));
  v_claims := v_evento -> 'claims';

  if jsonb_array_length(coalesce(v_claims -> 'roles', '[]'::jsonb)) = 0 then
    return query select 'hook_arma_roles', 'FALLA', 'el hook no devolvió roles para una persona que tiene rol owner/admin';
    return;
  end if;
  return query select 'hook_arma_roles', 'OK',
    'el hook devolvió ' || jsonb_array_length(v_claims -> 'roles') || ' rol(es) en el claim "roles"';

  foreach t in array array['profiles', 'user_roles', 'clients', 'sites', 'services', 'employees',
                           'shifts', 'assignments', 'attendance_records', 'supervisions',
                           'v_shifts_board', 'v_assignments_board', 'v_people_basic']
  loop
    execute format('select count(*) from public.%I', t) into v_esperado;  -- como dueño de las tablas (sin RLS)
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', v_claims::text, true);
    begin
      execute format('select count(*) from public.%I', t) into v_visto;
    exception when others then
      v_visto := -1;
    end;
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_n := v_n + 1;
    if v_visto <> v_esperado then
      v_mal := v_mal || format('%s (esperadas %s, vistas %s) ', t, v_esperado, v_visto);
    end if;
  end loop;

  return query select 'sesion_simulada_admin',
    case when v_mal = '' then 'OK' else 'FALLA' end,
    case when v_mal = '' then 'como admin, con el token del hook, la RLS deja ver todas las filas de ' || v_n || ' tablas y vistas'
         else 'la RLS no deja ver lo esperado en: ' || v_mal end;
end
$fn$;

select comprobacion || '|' || estado || '|' || detalle from pg_temp.verificar_claves_foraneas();
select comprobacion || '|' || estado || '|' || detalle from pg_temp.verificar_sesion_simulada();
