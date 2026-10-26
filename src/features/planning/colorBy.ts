import { useCallback, useState } from 'react'

/**
 * «Colorear por: Estado | Cliente» del calendario de Planificación (P24.8).
 * La elección se recuerda por persona en este navegador (`localStorage`);
 * si no se puede leer o escribir (modo privado, cuota), se usa en memoria.
 */
export type ColorBy = 'status' | 'client'

export const COLOR_BY_STORAGE_KEY = 'es.planning.colorBy'

export const COLOR_BY_OPTIONS: { value: ColorBy; label: string }[] = [
  { value: 'status', label: 'Estado' },
  { value: 'client', label: 'Cliente' },
]

export function readColorBy(): ColorBy {
  try {
    return window.localStorage.getItem(COLOR_BY_STORAGE_KEY) === 'client'
      ? 'client'
      : 'status'
  } catch {
    return 'status'
  }
}

export function useColorBy(): [ColorBy, (value: ColorBy) => void] {
  const [colorBy, setColorBy] = useState<ColorBy>(readColorBy)
  const update = useCallback((value: ColorBy) => {
    setColorBy(value)
    try {
      window.localStorage.setItem(COLOR_BY_STORAGE_KEY, value)
    } catch {
      // Sin almacenamiento: la elección vale solo para esta sesión.
    }
  }, [])
  return [colorBy, update]
}
