-- scripts/lib/huella-permisos.sql — TEST-024 (ADR-015)
--
-- Huella (hash) de todo lo que define "quién puede hacer qué" en la base: permisos de tablas y
-- vistas, de columnas, de funciones y de esquemas, privilegios por defecto, políticas RLS (de
-- public y de storage.objects) y triggers de usuario. Solo lecturas; no imprime datos, solo un
-- hash por componente.
--
-- scripts/restore-from-r2.sh la toma antes de restaurar y después, y compara: la restauración
-- reemplaza DATOS, así que las dos huellas tienen que ser idénticas. Si difieren, algún paso
-- tocó estructura o permisos (el defecto que `--no-privileges` causaba con la secuencia vieja).
--
-- Se corre con `psql -X -q -A -t -F '|' -v ON_ERROR_STOP=1 -f scripts/lib/huella-permisos.sql`.
-- Salida: una línea `componente|hash` por componente, en orden fijo.

select 'tablas_y_vistas|' || coalesce(md5(string_agg(n.nspname || '.' || c.relname || '=' || coalesce(c.relacl::text, '-'), E'\n' order by n.nspname, c.relname)), '-')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public', 'app', 'storage') and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S');

select 'columnas|' || coalesce(md5(string_agg(n.nspname || '.' || c.relname || '.' || a.attname || '=' || a.attacl::text, E'\n' order by n.nspname, c.relname, a.attname)), '-')
from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public', 'app', 'storage') and a.attacl is not null and not a.attisdropped;

select 'funciones|' || coalesce(md5(string_agg(n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')=' || coalesce(p.proacl::text, '-') || ';secdef=' || p.prosecdef::text, E'\n' order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))), '-')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'app')
  and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');

select 'esquemas|' || coalesce(md5(string_agg(nspname || '=' || coalesce(nspacl::text, '-'), E'\n' order by nspname)), '-')
from pg_namespace
where nspname in ('public', 'app', 'storage', 'auth');

select 'privilegios_por_defecto|' || coalesce(md5(string_agg(pg_get_userbyid(defaclrole) || '.' || defaclnamespace::regnamespace::text || '.' || defaclobjtype::text || '=' || defaclacl::text, E'\n' order by defaclrole, defaclnamespace, defaclobjtype)), '-')
from pg_default_acl;

select 'politicas|' || coalesce(md5(string_agg(schemaname || '.' || tablename || '.' || policyname || ':' || cmd || ':' || roles::text || ':' || coalesce(qual, '-') || ':' || coalesce(with_check, '-'), E'\n' order by schemaname, tablename, policyname)), '-')
from pg_policies
where schemaname in ('public', 'storage');

select 'triggers|' || coalesce(md5(string_agg(c.relnamespace::regnamespace::text || '.' || c.relname || '.' || t.tgname || ':' || t.tgenabled::text, E'\n' order by c.relnamespace::regnamespace::text, c.relname, t.tgname)), '-')
from pg_trigger t join pg_class c on c.oid = t.tgrelid
where not t.tgisinternal and c.relnamespace::regnamespace::text in ('public', 'auth', 'storage')
  and (c.relnamespace::regnamespace::text = 'public' or t.tgname in ('trg_handle_new_user', 'trg_log_sign_in'));
