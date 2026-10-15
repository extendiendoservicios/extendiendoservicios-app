import type { DeleteMediaResult, ShiftMediaRow } from '@/api/mediaAdmin'
import { formatFileSize } from '@/components/media/details'

/**
 * Textos y cuentas de las acciones de a varias de ADM-32 (P21.8b): «Conservar»,
 * «Quitar Conservar» y «Eliminar». Todo puro, sin React ni Supabase.
 */

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** Qué hace falta hacer con lo elegido: a cuántas les falta o les sobra «Conservar». */
export function keepSplit(rows: readonly ShiftMediaRow[]): {
  toKeep: string[]
  toRelease: string[]
} {
  const withFile = rows.filter((row) => row.hasFile)
  return {
    toKeep: withFile.filter((row) => !row.keep).map((row) => row.id),
    toRelease: withFile.filter((row) => row.keep).map((row) => row.id),
  }
}

/** Aviso del diálogo cuando hay marcadas «Conservar» entre las elegidas; `null` si no hay. */
export function keepWarning(keepCount: number): string | null {
  if (keepCount <= 0) return null
  return keepCount === 1
    ? '1 de los seleccionados está marcado «Conservar» y también se va a eliminar.'
    : `${keepCount} de los seleccionados están marcados «Conservar» y también se van a eliminar.`
}

export function deleteTitle(count: number): string {
  return count === 1 ? '¿Eliminar 1 archivo?' : `¿Eliminar ${count} archivos?`
}

export function keepToast(count: number, keep: boolean): string {
  if (count === 0) {
    return keep
      ? 'No había nada para marcar: ya estaban conservados.'
      : 'No había nada para desmarcar.'
  }
  return keep
    ? `Marcamos ${plural(count, 'archivo', 'archivos')} para conservar: ya no vencen.`
    : `Dejamos de conservar ${plural(count, 'archivo', 'archivos')}: vuelven a vencer con el plazo normal.`
}

/** «Se eliminaron 3 archivos. Liberamos unos 4,2 MB.» */
export function deleteToast(result: DeleteMediaResult): string {
  const base =
    result.deletedCount === 0
      ? 'No se eliminó ningún archivo: ya no tenían archivo.'
      : result.deletedCount === 1
        ? 'Se eliminó 1 archivo.'
        : `Se eliminaron ${result.deletedCount} archivos.`
  const freed =
    result.bytesFreedEstimate > 0
      ? ` Liberamos unos ${formatFileSize(result.bytesFreedEstimate)}.`
      : ''
  const ignored =
    result.deletedCount > 0 && result.ignoredCount > 0
      ? ` ${plural(result.ignoredCount, 'no se tocó', 'no se tocaron')} porque ya no tenían archivo.`
      : ''
  return `${base}${freed}${ignored}`
}
