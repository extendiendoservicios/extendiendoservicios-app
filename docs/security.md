# Seguridad — Plataforma Base "Extendiendo Servicios"

Este documento reúne, por capa, cómo se sostiene la seguridad del sistema. Cada sección la
mantiene quien es dueño de esa capa (ver `.claude/agents/`). Esta primera versión trae solo la
sección de base de datos y Edge Function (`backend-supabase`, P07.1); las demás capas
(frontend, infraestructura) agregan la suya cuando corresponda.

## Base de datos y Edge Function

La seguridad real del sistema es **RLS más las RPC `security definer`**: el frontend nunca es la
única validación (`03_Plan_Maestro_Tecnico.md` sección 15, `04_Modelo_de_Datos.md` sección 0 y 7).

### Roles y capacidades

- Los roles (`owner`, `admin`, `supervisor`, `employee`) y las capacidades de administrador viven
  en `public.user_roles`/`public.admin_capabilities` y viajan en el JWT como claims (`roles`,
  `capabilities`), agregados por el hook `app.custom_access_token_hook` (`0003`, `04` sección
  7.1). Las políticas RLS leen esos claims con `app.jwt_roles()`/`app.jwt_capabilities()`, sin
  consultas adicionales contra las tablas de roles — evita una vuelta extra a la base en cada
  fila, a costa de que un cambio de rol/capacidad no se refleje hasta que el JWT se renueve.
- El owner tiene todas las capacidades implícitamente, sin fila en `admin_capabilities`. Un
  administrador nuevo arranca con las siete capacidades activas (CONFIRMADO por Mike el 23 sep
  2026, P07.0; el dueño quita las que no correspondan).

### La ventana de revocación (P06.2, decisión de Mike del 23 sep 2026, P07.1)

PostgREST valida un JWT por firma y vencimiento, no contra `auth.sessions`: un `access_token` ya
emitido sigue siendo válido con sus claims viejos hasta que expira, aunque se revoquen sus
sesiones. Cerrado con dos medidas combinadas:

1. `jwt_expiry` bajado de 3600 a **900 segundos** (`supabase/config.toml`): acota a 15 minutos,
   como mucho, la demora en que un cambio de rol o capacidad se refleja.
2. `app.current_profile_active()` (lectura por clave primaria de `profiles.is_active`/
   `deleted_at`, `stable`, `security definer`), exigida por `app.has_role`/`app.has_capability` y,
   para las políticas de "fila propia" que no pasan por ninguna función de rol, por
   `app.current_uid()` (devuelve `auth.uid()` solo si el perfil sigue activo, si no `null`). Con
   esto, **desactivar a alguien le corta el acceso al instante**, sin esperar a que el token
   expire — verificado en vivo contra `App_dev`: token todavía vigente, `GET /rest/v1/profiles`
   pasa de `200` con datos a `200` con `[]` en el mismo segundo en que se llama a
   `deactivate_user`.

Detalle técnico completo (por qué no hizo falta reescribir las 69 políticas de `0012`, el costo
medido con `explain analyze`, las ocho políticas que sí hubo que tocar) en `docs/database.md`,
sección "Ventana de revocación".

### Edge Function `admin-users`

Única función del proyecto que usa la clave `service_role` (excepción explícita a ADR-004, "sin
capa de API"; ver ADR-005). Antes de tocar cualquier dato:

1. `Origin`, si viene declarado, contra la lista blanca de `_shared/cors.ts`.
2. JWT válido (lo exige el gateway de Supabase) y, además, la función vuelve a leer en vivo de la
   base quién es la persona que llama, su estado (`profiles.is_active`/`deleted_at`) y sus roles y
   capacidades — nunca confía en los claims del propio JWT del llamador, por el mismo motivo que
   motivó la ventana de revocación de arriba.
3. Perfil activo y no borrado.
4. Rol/capacidad según la acción, con la regla de que un admin con `manage_users` nunca puede
   crear, tocar ni ver afectada a una persona con rol `owner` o `admin`.
5. Límite de **10 acciones por minuto por persona que actúa** (CONFIRMADO por Mike el 23 sep 2026,
   P07.0), contado sobre `security_events` (decisión menor: `06_API.md` no fija cómo guardar el
   conteo; se reutiliza la tabla que de todos modos ya audita cada acción, en vez de sumar una
   tabla nueva solo para contar — funciona igual con varias instancias de la función). Desde P18.6
   (SEG-03) cuenta también los intentos **rechazados** de una persona ya identificada, que quedan
   registrados como `admin_action_rejected`.

El `Origin` permitido sale de una lista base (`dev.` y `app.extendiendoservicios.com`) más el
secreto de la función `ALLOWED_ORIGINS_EXTRA`, que solo existe en `App_dev` y solo admite orígenes
locales (SEG-07: `http://localhost:5173` no está en producción).

Cada acción exitosa queda en `security_events` (P-104), auditoría de solo lectura para el owner.
Detalle completo, incluidos los hallazgos de la verificación en vivo (por qué
`auth.admin.signOut()` de supabase-js no sirve para revocar por `profile_id`, el recorte de
`x-forwarded-for`), en `docs/database.md`, sección "Edge Function `admin-users`".

### Qué lee cada rol de lo ajeno (P18.6)

RLS filtra filas, no columnas. Empleado y supervisor **no leen las tablas base** para las filas
ajenas de `profiles`, `employees`, `clients` ni `assignments`: lo hacen por vistas recortadas
(`v_people_basic`, `v_clients_basic`, `v_shift_peers`), que solo exponen nombre y foto, el nombre del
cliente y quiénes están en el turno (P-062, P-103, 03 sección 6 y 15). Sus propias filas sí se leen
completas. Detalle en `docs/database.md`, "Correcciones de P18.6".

Además: un administrador no desactiva ni edita a otro administrador ni al dueño, y para cambiar
`is_active` necesita `manage_users` (trigger `trg_enforce_profile_admin_update_rules`); la
configuración de la empresa es del dueño y el administrador solo cambia el logo; una cuenta
desactivada con el token vigente ya no lee feriados ni configuración, no sube fotos ni marca cambios
vistos; `avatars` no se puede listar (las fotos se sirven por URL pública); `branding` no acepta
SVG; `public.rls_auto_enable()` no es ejecutable por la app.

### Nada se borra físicamente (P-014, P-105)

Desactivar, quitar un rol o dar de baja un empleado son siempre bajas lógicas (`is_active`,
`deleted_at`, `status`). `auth.admin.deleteUser` fallando por las claves foráneas sin cascada
(`profiles` → `auth.users`) es el diseño, no un defecto: agregar `on delete cascade` borraría
también la auditoría de `security_events`.
