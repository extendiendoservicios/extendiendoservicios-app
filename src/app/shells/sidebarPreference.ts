/**
 * Preferencia de la barra lateral del panel de administración (AJ3-07):
 * la persona puede fijarla abierta o cerrada y la elección se recuerda por
 * usuario en ese navegador. Sin preferencia guardada manda el automático
 * (completa desde 1024 px). No se guarda en la base.
 */
export type SidebarPreference = 'expanded' | 'collapsed'

export function sidebarPreferenceKey(userId: string): string {
  return `es.sidebar.${userId}`
}

/** Lee la preferencia; `null` sin valor guardado, valor inválido o storage no disponible. */
export function readSidebarPreference(
  userId: string | null,
): SidebarPreference | null {
  if (!userId) return null
  try {
    const value = window.localStorage.getItem(sidebarPreferenceKey(userId))
    return value === 'expanded' || value === 'collapsed' ? value : null
  } catch {
    return null
  }
}

/** Guarda la preferencia; si el storage falla (modo privado, cuota), sigue sin recordarla. */
export function writeSidebarPreference(
  userId: string | null,
  preference: SidebarPreference,
): void {
  if (!userId) return
  try {
    window.localStorage.setItem(sidebarPreferenceKey(userId), preference)
  } catch {
    // Sin storage la elección vale solo para esta sesión de la pestaña.
  }
}
