/**
 * Lógica pura de las categorías de clientes (P27.7, OD-20), sin React ni
 * Supabase.
 */

/** Mueve el elemento `index` una posición (`-1` arriba, `1` abajo); fuera de rango no cambia nada. */
export function moveCategory(
  ids: readonly string[],
  index: number,
  direction: -1 | 1,
): string[] {
  const target = index + direction
  if (index < 0 || index >= ids.length || target < 0 || target >= ids.length) {
    return [...ids]
  }
  const next = [...ids]
  const [moved] = next.splice(index, 1)
  next.splice(target, 0, moved as string)
  return next
}

/** Aviso del diálogo de baja: cuántos clientes quedan sin categoría. */
export function describeCategoryRemoval(
  name: string,
  clientsCount: number,
): string {
  if (clientsCount === 0) {
    return `Ningún cliente tiene la categoría «${name}». Se da de baja y deja de ofrecerse.`
  }
  const clients =
    clientsCount === 1
      ? '1 cliente va a quedar'
      : `${clientsCount} clientes van a quedar`
  return `${clients} sin categoría. Se da de baja «${name}» y deja de ofrecerse.`
}
