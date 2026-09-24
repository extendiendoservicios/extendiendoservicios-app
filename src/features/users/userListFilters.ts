import type { AdminUserRow } from '@/api/users'

/**
 * P07.7 (USERS-008): lógica del interruptor "Mostrar desactivados" de
 * ADM-27, sin React -- así se testea sin renderizar `UsersPage`.
 *
 * Decisión de Mike del 23 sep 2026: por defecto la lista solo muestra
 * usuarios activos (en producción se van a ir acumulando los que dejan de
 * trabajar; hoy `App_dev` ya tiene ~48 desactivados, casi todos de prueba,
 * y la lista se vuelve difícil de leer). El interruptor suma los
 * desactivados cuando hace falta verlos (por ejemplo, para reactivar a
 * alguien).
 *
 * Filtro en el cliente, no en la consulta: `fetchUsers` ya trae todos los
 * perfiles en una sola consulta liviana (decenas de filas, `P-040`, sin
 * paginado) y el resto de la pantalla (roles, "último inicio de sesión")
 * depende de esa misma lista completa -- pedir dos variantes distintas al
 * servidor solo por este interruptor duplicaría la consulta sin necesidad.
 * El polling de 60 s de `useUsersQuery` sigue trayendo la lista entera; el
 * interruptor solo decide qué parte de esa lista ya cargada se muestra.
 */
export function filterUsersByStatus<T extends Pick<AdminUserRow, 'deletedAt'>>(
  rows: T[],
  showDeactivated: boolean,
): T[] {
  if (showDeactivated) {
    return rows
  }
  return rows.filter((row) => row.deletedAt == null)
}
