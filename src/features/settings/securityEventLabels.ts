import type { SecurityEventType } from '@/api/settings'

/**
 * Etiquetas en español de `security_event_type` (ADM-31, USERS-016).
 * `04_Modelo_de_Datos.md` sección 3 remite a la sección 2.6 para el detalle
 * del enum, pero no fija una etiqueta de pantalla para cada valor (a
 * diferencia de otros enums, que sí la traen en esa tabla) -- se definen acá
 * (decisión menor, ver el reporte del encargo).
 */
export const SECURITY_EVENT_TYPE_LABELS: Record<SecurityEventType, string> = {
  sign_in: 'Inicio de sesión',
  sign_in_failed: 'Inicio de sesión fallido',
  user_created: 'Usuario creado',
  user_deactivated: 'Usuario desactivado',
  user_reactivated: 'Usuario reactivado',
  password_reset_by_admin: 'Contraseña reseteada por administración',
  sessions_revoked: 'Sesiones cerradas',
  roles_changed: 'Roles modificados',
  capabilities_changed: 'Capacidades modificadas',
  email_changed: 'Email modificado',
}

export const SECURITY_EVENT_TYPES: SecurityEventType[] = [
  'sign_in',
  'sign_in_failed',
  'user_created',
  'user_deactivated',
  'user_reactivated',
  'password_reset_by_admin',
  'sessions_revoked',
  'roles_changed',
  'capabilities_changed',
  'email_changed',
]
