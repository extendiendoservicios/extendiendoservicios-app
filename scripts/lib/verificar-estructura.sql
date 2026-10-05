-- scripts/lib/verificar-estructura.sql — TEST-024 (ADR-015, 03 sección 14.1)
--
-- Verifica, SOLO CON LECTURAS, que la estructura y los permisos de la base son los que dejan las
-- migraciones (04_Modelo_de_Datos.md sección 7.2 y 7.3, 0003, 0014, 0017). Lo usan:
--   - scripts/restore-from-r2.sh: antes de tocar nada y después de restaurar (la restauración
--     reemplaza datos, nunca estructura: si algo de esto cambia, algo salió mal).
--   - scripts/recuperar-app-dev.ts: al terminar la recuperación de App_dev.
--
-- Salida: una fila por comprobación, con tres columnas (comprobación | estado | detalle).
-- `estado` es OK o FALLA. Nunca imprime contenido de tablas: solo nombres de objetos y números.
-- Se corre con `psql -X -q -A -t -F '|' -v ON_ERROR_STOP=1 -f scripts/lib/verificar-estructura.sql`.
--
-- Solo crea funciones temporales (pg_temp): no deja nada en la base.

create or replace function pg_temp.verificar_estructura()
returns table (comprobacion text, estado text, detalle text)
language plpgsql
as $fn$
declare
  v_n int;
  v_lista text;
  v_anon oid := 'anon'::regrole::oid;
  v_auth oid := 'authenticated'::regrole::oid;
begin
  -- 1. RLS activa en todas las tablas de public --------------------------------------------------
  select count(*) filter (where not c.relrowsecurity), string_agg(c.relname, ', ' order by c.relname) filter (where not c.relrowsecurity)
    into v_n, v_lista
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p');
  return query select 'rls_activa_en_todas_las_tablas', case when v_n = 0 then 'OK' else 'FALLA' end,
    case when v_n = 0 then 'todas las tablas de public tienen RLS' else 'sin RLS: ' || v_lista end;

  select count(*) into v_n from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p');
  return query select 'tablas_en_public', case when v_n > 0 then 'OK' else 'FALLA' end, v_n || ' tablas';

  -- 2. anon: nada en public salvo select sobre v_public_branding (04 sección 7.2) -----------------
  select string_agg(distinct c.relname || ':' || a.privilege_type, ', ')
    into v_lista
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(c.relacl) a
  where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
    and a.grantee = v_anon
    and not (c.relname = 'v_public_branding' and a.privilege_type = 'SELECT');
  return query select 'anon_solo_v_public_branding', case when v_lista is null then 'OK' else 'FALLA' end,
    coalesce('privilegios de más para anon: ' || v_lista, 'anon solo tiene select sobre v_public_branding');

  -- 2 bis. anon: privilegios por columna, solo las cuatro de company_settings --------------------
  select string_agg(distinct c.relname || '.' || at.attname || ':' || a.privilege_type, ', ')
    into v_lista
  from pg_attribute at
  join pg_class c on c.oid = at.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(at.attacl) a
  where n.nspname = 'public' and a.grantee = v_anon
    and not (c.relname = 'company_settings' and at.attname in ('id', 'name', 'logo_path', 'support_phone')
             and a.privilege_type = 'SELECT');
  return query select 'anon_columnas', case when v_lista is null then 'OK' else 'FALLA' end,
    coalesce('privilegios de columna de más para anon: ' || v_lista, 'anon solo lee id, name, logo_path y support_phone de company_settings');

  -- 3. authenticated: sin TRUNCATE, TRIGGER ni REFERENCES (el "GRANT ALL" por defecto de Supabase)
  select string_agg(distinct c.relname || ':' || a.privilege_type, ', ')
    into v_lista
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(c.relacl) a
  where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
    and a.grantee = v_auth
    and a.privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES');
  return query select 'authenticated_sin_grant_all', case when v_lista is null then 'OK' else 'FALLA' end,
    coalesce('quedó el GRANT ALL por defecto en: ' || v_lista, 'authenticated no tiene TRUNCATE, TRIGGER ni REFERENCES en ninguna tabla ni vista');

  -- 3 bis. authenticated: select en todo y nada de escritura directa en las tablas "RPC" (0017) ---
  select string_agg(c.relname, ', ' order by c.relname)
    into v_lista
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p', 'v')
    and not has_table_privilege('authenticated', c.oid, 'SELECT');
  return query select 'authenticated_select_en_todo', case when v_lista is null then 'OK' else 'FALLA' end,
    coalesce('authenticated sin select en: ' || v_lista, 'authenticated tiene select en todas las tablas y vistas');

  select string_agg(distinct c.relname || ':' || a.privilege_type, ', ')
    into v_lista
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(c.relacl) a
  where n.nspname = 'public' and c.relkind in ('r', 'p')
    and a.grantee = v_auth
    and a.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
    and c.relname in ('user_roles', 'admin_capabilities', 'shifts', 'attendance_records', 'attendance_notices',
                      'shift_tasks', 'supervisions', 'supervision_attendance', 'ratings', 'security_events');
  return query select 'tablas_rpc_sin_escritura_directa', case when v_lista is null then 'OK' else 'FALLA' end,
    coalesce('escritura directa que no corresponde: ' || v_lista, 'las diez tablas "RPC" de 04 sección 7.2 no tienen insert/update/delete para authenticated');

  -- 4. Privilegios por defecto del rol postgres, dueño de lo que crean las migraciones (0017, punto 7).
  --    Los de supabase_admin (objetos que crea la plataforma) no son nuestros y no se miran -----------------------
  select string_agg(distinct
           coalesce((select rolname from pg_roles where oid = x.grantee), 'public') || ':' || x.privilege_type, ', ')
    into v_lista
  from pg_default_acl d
  join pg_namespace n on n.oid = d.defaclnamespace
  cross join lateral aclexplode(d.defaclacl) x
  where n.nspname = 'public' and d.defaclobjtype = 'r'
    and d.defaclrole = 'postgres'::regrole::oid
    and ((x.grantee = v_anon)
         or (x.grantee = v_auth and x.privilege_type <> 'SELECT'));
  return query select 'privilegios_por_defecto', case when v_lista is null then 'OK' else 'FALLA' end,
    coalesce('privilegios por defecto de más: ' || v_lista, 'las tablas nuevas de public nacen sin nada para anon y solo con select para authenticated');

  -- 5. Funciones security definer: search_path fijo (04 sección 0) --------------------------------
  select count(*), string_agg(n.nspname || '.' || p.proname, ', ' order by p.proname)
    into v_n, v_lista
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'app') and p.prosecdef
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%');
  return query select 'security_definer_con_search_path', case when v_n = 0 then 'OK' else 'FALLA' end,
    case when v_n = 0 then 'todas las funciones security definer fijan search_path' else 'sin search_path: ' || v_lista end;

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'app') and p.prosecdef;
  return query select 'funciones_security_definer', case when v_n > 0 then 'OK' else 'FALLA' end, v_n || ' funciones';

  -- 6. Las RPC de public no las ejecuta anon ---------------------------------------------------------
  select string_agg(p.proname, ', ' order by p.proname)
    into v_lista
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    and has_function_privilege('anon', p.oid, 'EXECUTE');
  return query select 'rpc_sin_execute_para_anon', case when v_lista is null then 'OK' else 'FALLA' end,
    coalesce('anon puede ejecutar: ' || v_lista, 'ninguna función de public es ejecutable por anon');

  -- 7. Hook de Auth (0003): existe y solo lo ejecuta supabase_auth_admin ------------------------------
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'app' and p.proname = 'custom_access_token_hook';
  return query select 'hook_existe', case when v_n = 1 then 'OK' else 'FALLA' end,
    'app.custom_access_token_hook: ' || v_n || ' definición';
  if v_n = 1 then
    return query select 'hook_permisos',
      case when has_function_privilege('supabase_auth_admin', 'app.custom_access_token_hook(jsonb)', 'EXECUTE')
                and has_schema_privilege('supabase_auth_admin', 'app', 'USAGE')
                and not has_function_privilege('authenticated', 'app.custom_access_token_hook(jsonb)', 'EXECUTE')
                and not has_function_privilege('anon', 'app.custom_access_token_hook(jsonb)', 'EXECUTE')
           then 'OK' else 'FALLA' end,
      'supabase_auth_admin lo ejecuta; anon y authenticated no';
  end if;

  -- 8. Triggers que viven sobre tablas de auth (0003 y 0019): sin ellos no se crean perfiles ni se registra el ingreso
  return query
  select 'trigger_' || t.nombre,
         case when exists (select 1 from pg_trigger g where g.tgname = t.nombre and g.tgrelid = t.tabla::regclass
                           and g.tgenabled = 'O' and not g.tgisinternal) then 'OK' else 'FALLA' end,
         t.nombre || ' sobre ' || t.tabla
  from (values ('trg_handle_new_user', 'auth.users'), ('trg_log_sign_in', 'auth.sessions')) as t (nombre, tabla);

  -- 9. Storage (0014): buckets y políticas ----------------------------------------------------------------
  select count(*) into v_n from storage.buckets
  where (id = 'avatars' and public and file_size_limit = 2097152)
     or (id = 'branding' and public and file_size_limit = 1048576);
  return query select 'buckets_avatars_y_branding', case when v_n = 2 then 'OK' else 'FALLA' end,
    v_n || ' de 2 buckets con la configuración de 0014';

  select count(*) into v_n from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and policyname in ('avatars_select_own_or_admin', 'avatars_insert_own_or_admin', 'avatars_update_own_or_admin',
                       'avatars_delete_own_or_admin', 'branding_select_public', 'branding_write_admin');
  return query select 'politicas_de_storage', case when v_n = 6 then 'OK' else 'FALLA' end,
    v_n || ' de 6 políticas de storage.objects';

  select count(*) into v_n from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'storage' and c.relname = 'objects' and c.relrowsecurity;
  return query select 'storage_objects_con_rls', case when v_n = 1 then 'OK' else 'FALLA' end, 'RLS de storage.objects';

  -- 10. Migraciones aplicadas -------------------------------------------------------------------------------
  select count(*), max(version) into v_n, v_lista from supabase_migrations.schema_migrations;
  return query select 'migraciones_aplicadas', case when v_n > 0 then 'OK' else 'FALLA' end,
    v_n || ' migraciones, la última es ' || coalesce(v_lista, '(ninguna)');
end
$fn$;

select comprobacion || '|' || estado || '|' || detalle from pg_temp.verificar_estructura();
