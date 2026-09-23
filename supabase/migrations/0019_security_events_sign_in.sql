-- AUTH-009 (08_Fases_y_Backlog.md, F6 · Autenticación y navegación por rol)
--
-- Registro del inicio de sesión como evento `sign_in` en `security_events` (04 sección 2.6,
-- P-104). `06_API.md` sección 1 deja la vía PROPUESTA, sin confirmar entre dos alternativas:
-- trigger `after insert on auth.sessions` o Edge Function `log-sign-in`. Se comprobó en vivo
-- contra `App_dev` (evidencia completa en el reporte de la tarea) que:
--
--   1. El rol con el que corren las migraciones SÍ puede crear un trigger sobre `auth.sessions`
--      (`create trigger ... after insert on auth.sessions ...` se ejecutó sin error dentro de
--      una transacción de prueba con `rollback`). Se descarta entonces la alternativa de la Edge
--      Function: agregaría latencia y una llamada extra desde el cliente después de cada login
--      (`06` no le da parámetros propios, habría que inventarlos) para resolver algo que el
--      propio motor ya puede hacer de forma atómica y sin intervención del frontend.
--   2. Columnas reales de `auth.sessions` en esta versión de GoTrue (Postgres 17.6.1.166,
--      confirmado con `information_schema.columns`): `id`, `user_id`, `created_at`,
--      `updated_at`, `factor_id`, `aal`, `not_after`, `refreshed_at`, `user_agent`, `ip`, `tag`,
--      `oauth_client_id`, `refresh_token_hmac_key`, `refresh_token_counter`, `scopes`. Sí existe
--      `ip` (lo que supone `06` sección 1); no existe ninguna columna de email o nombre, por eso
--      el evento solo guarda `user_id` (como `actor_id`) y arma el resto desde ahí.
--   3. `auth.sessions` es la tabla correcta para "inició sesión", no `auth.users` ni
--      `auth.refresh_tokens`: se hizo un login real (`grant_type=password`) contra una cuenta
--      del seed y se comprobó que crea una fila nueva en `auth.sessions` (columna `id` propia);
--      después se refrescó el token (`grant_type=refresh_token`) con el `refresh_token` de esa
--      misma sesión y se comprobó que el refresco actualiza la MISMA fila (mismo `id`, cambian
--      `updated_at`/`refreshed_at`) en lugar de crear una fila nueva. O sea que un trigger
--      `after insert` dispara una vez por sesión real (una por cada vez que alguien pone
--      email/contraseña y consigue un token, en cada dispositivo/pestaña por separado, tal como
--      corresponde a "inicio de sesión"), y no se duplica en cada refresco automático del token
--      (`autoRefreshToken: true` en el cliente, `06_API.md` sección 1). La Admin API
--      (`auth.admin.createUser`, `updateUserById`, `signOut`) no inserta filas en
--      `auth.sessions` -- no "loguea" a nadie --, así que las acciones de la Edge Function
--      `admin-users` (F7) no van a disparar `sign_in` espurios.
--   4. Riesgo de una actualización de GoTrue: el trigger en sí vive en `auth.sessions` (objeto
--      del esquema `auth`, gestionado por Supabase), aunque su función vive en `app` -- mismo
--      patrón que `trg_handle_new_user` sobre `auth.users` (0003, DB-004), que corre este mismo
--      riesgo desde F4 sin que hasta hoy se haya roto. La documentación oficial de Supabase
--      ("Managing User Data") no promete estabilidad de "columnas, índices, restricciones u
--      otros objetos de la base gestionados por Supabase", que "pueden cambiar en cualquier
--      momento" -- no hay garantía explícita para `auth.sessions` en particular. Dos escenarios
--      posibles, con cómo se detectarían:
--        a. GoTrue agrega, saca o renombra una columna de `auth.sessions` que este trigger use
--           (`user_id`, `ip`, `user_agent`, `id`): la función seguiría existiendo pero fallaría
--           en tiempo de ejecución en cada login -- el `exception when others` de más abajo lo
--           atrapa (el login sigue andando) pero deja de insertarse en `security_events` sin
--           ningún aviso visible para quien usa la app. Se detecta comparando, en el panel de
--           Supabase (Logs > Postgres Logs), la ausencia de filas nuevas en `security_events`
--           contra logins reales, o revisando ahí los `WARNING` que el trigger emite en cada
--           fallo (mensaje `app.log_sign_in: ...`, ver más abajo).
--        b. GoTrue recrea `auth.sessions` entera (`drop table` + `create table`) en lugar de
--           `alter table`: el trigger desaparece junto con la tabla y no vuelve a crearse solo.
--           Se detecta con `select tgname from pg_trigger where tgrelid = 'auth.sessions'::
--           regclass` después de cualquier actualización de versión de Supabase notificada por
--           la plataforma (mismo chequeo que valdría para `trg_handle_new_user`, que corre igual
--           riesgo desde 0003 y hasta hoy nunca se verificó de forma sistemática). No hay forma
--           de prevenir este caso desde una migración: si ocurre, hace falta una migración nueva
--           que vuelva a crear el trigger.
--
-- Lo que más importa de esta migración (indicación explícita de la tarea): un fallo al insertar
-- el evento NO PUEDE impedir el login. `security_events.actor_id` referencia `profiles(id)`
-- (0004) sin `on delete`/`on update` especial: si esa fila no existiera todavía en el momento en
-- que se crea la sesión, `app.log_security_event` cortaría con una violación de clave foránea.
-- En el flujo normal de este sistema eso no debería pasar -- `app.handle_new_user()` (0003) crea
-- `profiles` en la misma transacción del `insert` en `auth.users`, y todo alta de usuario pasa
-- por la Edge Function `admin-users` o por `scripts/seed-dev.ts` (nunca un `insert` directo en
-- `auth.users`), así que para cuando alguien hace login el usuario ya existe hace rato con su
-- `profile` -- pero "no debería pasar" no es lo mismo que "no puede pasar" (un cambio futuro en
-- el hook de creación, un dato corrupto, cualquier otro error de los que `04` sección 0 no
-- puede anticipar). Por eso `app.log_sign_in()` (la función del trigger) envuelve la llamada a
-- `app.log_security_event(...)` en su propio bloque `exception when others`: cualquier error --
-- la violación de clave foránea de `actor_id`, o cualquier otro, presente o futuro -- se atrapa
-- ahí, se hace un `raise warning` (para que quede rastro en los logs de Postgres sin frenar
-- nada) y la función igual devuelve `new`, así el `insert` original en `auth.sessions` (y con él,
-- todo el login) se completa sin enterarse de que el registro del evento falló.

-- ---------------------------------------------------------------------------------------------
-- app.log_sign_in(): trigger AFTER INSERT en auth.sessions
-- ---------------------------------------------------------------------------------------------

-- `security definer` (dueña: quien corre esta migración, mismo dueño que `app.log_security_event`
-- desde 0004) para que la llamada interna a `app.log_security_event` no dependa de qué rol haya
-- hecho el `insert` en `auth.sessions` -- normalmente `supabase_auth_admin`, que no tiene
-- `bypassrls` (verificado en 0003) ni, por el `revoke` de 0004, `execute` sobre
-- `app.log_security_event`. Con `security definer`, el `current_user` efectivo durante esta
-- función pasa a ser su dueño (mismo razonamiento que el comentario de 0004 sobre por qué el
-- `revoke` no afecta las llamadas internas entre funciones `security definer` de un mismo dueño).
-- `set search_path` fijo, como toda función nueva de `app` (04 sección 0).
create function app.log_sign_in()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  begin
    perform app.log_security_event(
      'sign_in',
      new.user_id,
      null,
      jsonb_build_object('session_id', new.id, 'user_agent', new.user_agent),
      new.ip
    );
  exception when others then
    -- Nunca cortamos el login por un fallo al loguear el evento (ver el comentario de cabecera
    -- de esta migración): se avisa por los logs de Postgres y se sigue.
    raise warning 'app.log_sign_in: no se pudo registrar el evento sign_in de auth.sessions.id = % (%): %',
      new.id, sqlstate, sqlerrm;
  end;

  return new;
end;
$$;

comment on function app.log_sign_in() is
  'Trigger AFTER INSERT en auth.sessions: registra "sign_in" en security_events (04 sección 2.6, P-104; AUTH-009). Atrapa cualquier error propio para no impedir nunca el inicio de sesión -- ver el comentario de cabecera de 0019_security_events_sign_in.sql.';

create trigger trg_log_sign_in
after insert on auth.sessions
for each row execute function app.log_sign_in();
