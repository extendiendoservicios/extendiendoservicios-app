import type { Role } from '@/api/users'

/**
 * Permisos de las cuatro pantallas de Configuración (`05_Pantallas_y_
 * Navegacion.md` sección 2.7 y la nota de permisos que sigue, líneas 92 a
 * 97): sin React ni Supabase (mismo criterio que `src/features/users/
 * permissions.ts`) -- el servidor vuelve a verificar todo esto por RLS
 * (`0012_rls_policies.sql`), acá solo se decide qué mostrar.
 *
 * - ADM-28 "Empresa": la visitan dueño y administrador, pero el
 *   administrador solo ve y edita el logo -- el resto del formulario
 *   (nombre, teléfono, texto de consentimiento) es exclusivo del dueño.
 * - ADM-29 "Feriados", ADM-30 "Criterios de calificación" y ADM-31
 *   "Eventos de seguridad": solo el dueño. Un administrador que entrara por
 *   URL directa ve un aviso de acceso restringido (`OwnerOnlyNotice`), no el
 *   contenido -- RLS de todos modos le devolvería listas vacías o le
 *   rechazaría la escritura, pero mostrarle una pantalla vacía se leería
 *   como "no hay feriados/criterios/eventos cargados", que es información
 *   falsa (misma lección de la revisión de P07.2 sobre columnas en blanco).
 */
interface SettingsScreenActor {
  roles: Role[]
}

export function isOwner(actor: SettingsScreenActor): boolean {
  return actor.roles.includes('owner')
}

/** ADM-28: puede ver la pantalla (dueño o administrador). */
export function canViewCompanySettings(actor: SettingsScreenActor): boolean {
  return actor.roles.includes('owner') || actor.roles.includes('admin')
}

/** ADM-28: nombre, teléfono y texto de consentimiento -- solo dueño. */
export function canEditCompanyDetails(actor: SettingsScreenActor): boolean {
  return isOwner(actor)
}

/** ADM-28: el logo lo suben dueño y administrador por igual (P-117). */
export function canEditCompanyLogo(actor: SettingsScreenActor): boolean {
  return actor.roles.includes('owner') || actor.roles.includes('admin')
}

/** ADM-29, ADM-30 y ADM-31: solo dueño. */
export function canViewOwnerOnlyConfig(actor: SettingsScreenActor): boolean {
  return isOwner(actor)
}
