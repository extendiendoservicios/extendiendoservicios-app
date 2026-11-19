import { useCallback, useState } from 'react'

/**
 * OH-14: qué categorías del listado de Clientes están contraídas. Se recuerda
 * en el navegador (`localStorage`); si el almacenamiento no está disponible
 * (modo privado, cuota) la pantalla anda igual, solo que sin recordar.
 */
export const COLLAPSED_GROUPS_STORAGE_KEY = 'clients:collapsed-categories'

function readCollapsed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(COLLAPSED_GROUPS_STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string')
        : [],
    )
  } catch {
    return new Set()
  }
}

function writeCollapsed(collapsed: ReadonlySet<string>) {
  try {
    window.localStorage.setItem(
      COLLAPSED_GROUPS_STORAGE_KEY,
      JSON.stringify([...collapsed]),
    )
  } catch {
    // Sin almacenamiento: no se recuerda, pero la pantalla sigue andando.
  }
}

export function useCollapsedGroups() {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(readCollapsed)

  const update = useCallback(
    (compute: (current: ReadonlySet<string>) => Set<string>) => {
      setCollapsed((current) => {
        const next = compute(current)
        writeCollapsed(next)
        return next
      })
    },
    [],
  )

  const toggle = useCallback(
    (key: string) =>
      update((current) => {
        const next = new Set(current)
        if (next.has(key)) {
          next.delete(key)
        } else {
          next.add(key)
        }
        return next
      }),
    [update],
  )

  /** Contrae todas las categorías indicadas (sin olvidar las demás). */
  const collapseAll = useCallback(
    (keys: readonly string[]) =>
      update((current) => new Set([...current, ...keys])),
    [update],
  )

  /** Despliega las categorías indicadas. */
  const expandAll = useCallback(
    (keys: readonly string[]) =>
      update((current) => {
        const next = new Set(current)
        keys.forEach((key) => next.delete(key))
        return next
      }),
    [update],
  )

  return {
    isCollapsed: (key: string) => collapsed.has(key),
    toggle,
    collapseAll,
    expandAll,
  }
}
