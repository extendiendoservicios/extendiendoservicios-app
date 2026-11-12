import type { ConflictDetail } from '@/api/errors'
import { isApiError } from '@/api/errors'

/**
 * OF-08: cuando el servidor rechaza una asignación por superposición, el
 * `detail` trae el turno con el que choca. Estas piezas arman el enlace «Ver
 * turno» que lo abre. No usan el router: quien las usa pasa `onOpen` (por
 * ejemplo `navigate`), así sirven también dentro de un aviso (`toast`), que
 * se dibuja fuera del router.
 */

export const SEE_SHIFT_LABEL = 'Ver turno'

/** Ruta del detalle de un turno (ADM-06). */
export function shiftPath(shiftId: string): string {
  return `/admin/turnos/${shiftId}`
}

/** Id del turno con el que choca, si el servidor lo mandó. */
export function conflictShiftIdOf(
  detail: ConflictDetail | null | undefined,
): string | null {
  return detail?.conflictShiftId ?? null
}

/** Enlace «Ver turno»; no muestra nada si no hay turno de choque. */
function ConflictShiftLink({
  detail,
  onOpen,
}: {
  detail: ConflictDetail | null | undefined
  onOpen: (path: string) => void
}) {
  const shiftId = conflictShiftIdOf(detail)
  if (!shiftId) {
    return null
  }
  return (
    <button
      type="button"
      className="ml-1 font-medium underline underline-offset-2 hover:no-underline"
      onClick={() => onOpen(shiftPath(shiftId))}
    >
      {SEE_SHIFT_LABEL}
    </button>
  )
}

/**
 * Opciones de `toast.error` con la acción «Ver turno» cuando el error trae el
 * turno de choque. `undefined` si no corresponde.
 */
export function conflictToastOptions(
  error: unknown,
  onOpen: (path: string) => void,
): { action: { label: string; onClick: () => void } } | undefined {
  if (!isApiError(error)) {
    return undefined
  }
  const shiftId = conflictShiftIdOf(error.detail)
  if (!shiftId) {
    return undefined
  }
  return {
    action: {
      label: SEE_SHIFT_LABEL,
      onClick: () => onOpen(shiftPath(shiftId)),
    },
  }
}

export { ConflictShiftLink }
