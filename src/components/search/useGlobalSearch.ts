import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * Datos y agrupado del buscador global (EMP-012, `06_API.md` sección 3,
 * "Buscar (buscador global) | `from('v_search')` CONFIRMADO (P09.0) | O, A
 * | Empleados, clientes y sedes por texto"). Separado de `GlobalSearch.tsx`
 * para poder probar la consulta y el agrupado sin montar el diálogo.
 */

export type SearchResultKind = 'employee' | 'client' | 'site'

export interface SearchResultItem {
  kind: SearchResultKind
  id: string
  title: string
  subtitle: string | null
}

export interface SearchResultGroup {
  kind: SearchResultKind
  /** Encabezado en español que agrupa los resultados (P09.0: "empleados, clientes y sedes"). */
  label: string
  items: SearchResultItem[]
}

/** Orden y etiqueta fija de cada grupo, en el mismo orden que las pide el criterio de F9. */
const GROUP_LABELS: Record<SearchResultKind, string> = {
  employee: 'Empleados',
  client: 'Clientes',
  site: 'Sedes',
}
const GROUP_ORDER: SearchResultKind[] = ['employee', 'client', 'site']

/** Cantidad máxima de filas que trae una sola consulta a `v_search` (decisión menor, ver reporte). */
const SEARCH_ROW_LIMIT = 60

/** Cuántos caracteres hacen falta para disparar la búsqueda (encargo: "mínimo 2 caracteres"). */
export const SEARCH_MIN_LENGTH = 2

/** Destino de la ficha de cada tipo de resultado (`05_Pantallas_y_Navegacion.md` sección 5). */
export function searchResultPath(item: SearchResultItem): string {
  switch (item.kind) {
    case 'employee':
      return `/admin/empleados/${item.id}`
    case 'client':
      return `/admin/clientes/${item.id}`
    case 'site':
      return `/admin/sedes/${item.id}`
  }
}

interface SearchRow {
  kind: string | null
  id: string | null
  title: string | null
  subtitle: string | null
}

/** Agrupa las filas de `v_search` por tipo, en el orden fijo de `GROUP_ORDER` (siempre los tres grupos, aunque estén vacíos). */
export function groupSearchResults(rows: SearchRow[]): SearchResultGroup[] {
  return GROUP_ORDER.map((kind) => ({
    kind,
    label: GROUP_LABELS[kind],
    items: rows
      .filter(
        (row): row is SearchRow & { kind: SearchResultKind; id: string } =>
          row.kind === kind && row.id != null,
      )
      .map((row) => ({
        kind,
        id: row.id,
        title: row.title ?? '',
        subtitle: row.subtitle,
      })),
  }))
}

export type GlobalSearchStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface GlobalSearchState {
  status: GlobalSearchStatus
  groups: SearchResultGroup[]
}

const IDLE_STATE: GlobalSearchState = { status: 'idle', groups: [] }
const LOADING_STATE: GlobalSearchState = { status: 'loading', groups: [] }

interface FetchState {
  /** Texto (ya recortado y en minúsculas) al que corresponde este resultado. */
  query: string
  status: 'ready' | 'error'
  groups: SearchResultGroup[]
}

/**
 * Consulta `v_search` con el texto ya "debounceado" por quien llama
 * (`GlobalSearch.tsx`, `useDebouncedValue`). Por debajo de
 * `SEARCH_MIN_LENGTH` no consulta nada (estado `idle`, calculado en el
 * render, sin pasar por el efecto: llamar a `setState` de forma síncrona
 * apenas entra el efecto dispara renders en cascada, `react-hooks/set-
 * state-in-effect`). Mientras la consulta del texto actual todavía no
 * respondió (o el texto cambió y la respuesta pendiente es de uno
 * anterior), el estado derivado es `loading` — así nunca se ve el
 * resultado de una búsqueda vieja mientras la nueva está en camino.
 */
export function useGlobalSearchResults(query: string): GlobalSearchState {
  const trimmed = query.trim().toLowerCase()
  const [fetchState, setFetchState] = useState<FetchState | null>(null)

  useEffect(() => {
    if (trimmed.length < SEARCH_MIN_LENGTH) {
      return
    }

    let active = true
    supabase
      .from('v_search')
      .select('kind, id, title, subtitle')
      .ilike('search_text', `%${trimmed}%`)
      .order('kind', { ascending: true })
      .order('title', { ascending: true })
      .limit(SEARCH_ROW_LIMIT)
      .then(({ data, error }) => {
        if (!active) return
        setFetchState(
          error || !data
            ? { query: trimmed, status: 'error', groups: [] }
            : {
                query: trimmed,
                status: 'ready',
                groups: groupSearchResults(data),
              },
        )
      })

    return () => {
      active = false
    }
  }, [trimmed])

  if (trimmed.length < SEARCH_MIN_LENGTH) {
    return IDLE_STATE
  }
  if (fetchState === null || fetchState.query !== trimmed) {
    return LOADING_STATE
  }
  return { status: fetchState.status, groups: fetchState.groups }
}
