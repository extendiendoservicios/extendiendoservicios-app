# ADR-005 · Una Edge Function para administración de usuarios

Fecha: 17 de septiembre de 2026 · Estado: **Aceptado** · Origen: P-011, P-012, P-014, P-015, P-019

## Problema
Mike decidió que el dueño y los administradores crean usuarios con contraseña inicial, resetean contraseñas, cierran sesiones ajenas y desactivan cuentas. Esas operaciones usan la Admin API de Supabase Auth, que requiere la clave `service_role`, que nunca puede estar en el navegador. ADR-004 dice "sin capa de API".

## Alternativas
1. Una única Supabase Edge Function `admin-users` con acciones acotadas, que verifica el JWT y el rol del llamador antes de usar `service_role`.
2. Funciones SQL `security definer` que escriban directamente en `auth.users` y `auth.sessions`.
3. Invitación por email (`inviteUserByEmail`) y autoservicio, sin creación administrativa.

## Decisión
Alternativa 1, como excepción explícita y única a ADR-004.

## Motivo
Escribir en el esquema `auth` desde SQL es frágil (formato de hash, columnas internas que cambian entre versiones) y no está soportado. La invitación por email contradice P-011. Una Edge Function es el mecanismo oficial, se despliega desde el mismo repositorio y CI, y no es una capa general: son seis acciones.

## Consecuencias
- Acciones: `create_user`, `reset_password`, `update_email`, `deactivate_user`, `reactivate_user`, `sign_out_user`. Todas registran en `security_events`.
- La función verifica: JWT válido, usuario activo, rol owner (o admin con `manage_users` para empleados y supervisores), regla del último owner.
- Tests en Deno y despliegue automático con `supabase functions deploy` en el pipeline.
- Patrón reutilizable para integraciones futuras (módulo A, mensajería).
