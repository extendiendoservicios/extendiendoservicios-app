/**
 * Agrupa el listado de clientes por categoría (P27.7, OD-21): primero las
 * categorías en el orden de la empresa y, al final, «Sin categoría». Los grupos
 * vacíos no aparecen. Sin React ni Supabase.
 */

export const NO_CATEGORY_LABEL = 'Sin categoría'

export interface ClientGroup<T> {
  /** Id de la categoría, o `null` para «Sin categoría». */
  categoryId: string | null
  label: string
  rows: T[]
}

export function groupClientsByCategory<T extends { categoryId: string | null }>(
  rows: readonly T[],
  categories: readonly { id: string; name: string }[],
): ClientGroup<T>[] {
  const known = new Set(categories.map((category) => category.id))
  const groups: ClientGroup<T>[] = categories.map((category) => ({
    categoryId: category.id,
    label: category.name,
    rows: [],
  }))
  const byId = new Map(groups.map((group) => [group.categoryId, group]))
  const withoutCategory: ClientGroup<T> = {
    categoryId: null,
    label: NO_CATEGORY_LABEL,
    rows: [],
  }

  for (const row of rows) {
    const group =
      row.categoryId && known.has(row.categoryId)
        ? byId.get(row.categoryId)
        : undefined
    ;(group ?? withoutCategory).rows.push(row)
  }

  return [...groups, withoutCategory].filter((group) => group.rows.length > 0)
}

/** «1 cliente activo» / «12 clientes activos». */
export function describeActiveClients(count: number): string {
  return `${count} ${count === 1 ? 'cliente activo' : 'clientes activos'}`
}
