/**
 * Preferencia del mapa del Resumen (OF-13): qué conmutadores quedan prendidos
 * («Por comenzar», «En curso», «Finalizados» y «Coordinadores»). Se recuerda
 * por persona en este navegador, igual que la barra lateral; no se guarda en la
 * base.
 */
export interface PresenceFilters {
  showUpcoming: boolean
  showInProgress: boolean
  showFinished: boolean
  showCoordinators: boolean
}

/** Por omisión: por comenzar y en curso prendidos, finalizados apagado. */
export const DEFAULT_PRESENCE_FILTERS: PresenceFilters = {
  showUpcoming: true,
  showInProgress: true,
  showFinished: false,
  showCoordinators: true,
}

export function presenceFiltersKey(userId: string): string {
  return `es.presenceMap.${userId}`
}

export function readPresenceFilters(userId: string | null): PresenceFilters {
  if (!userId) return DEFAULT_PRESENCE_FILTERS
  try {
    const raw = window.localStorage.getItem(presenceFiltersKey(userId))
    if (!raw) return DEFAULT_PRESENCE_FILTERS
    const parsed = JSON.parse(raw) as Partial<PresenceFilters>
    const pick = (value: unknown, fallback: boolean) =>
      typeof value === 'boolean' ? value : fallback
    return {
      showUpcoming: pick(
        parsed.showUpcoming,
        DEFAULT_PRESENCE_FILTERS.showUpcoming,
      ),
      showInProgress: pick(
        parsed.showInProgress,
        DEFAULT_PRESENCE_FILTERS.showInProgress,
      ),
      showFinished: pick(
        parsed.showFinished,
        DEFAULT_PRESENCE_FILTERS.showFinished,
      ),
      showCoordinators: pick(
        parsed.showCoordinators,
        DEFAULT_PRESENCE_FILTERS.showCoordinators,
      ),
    }
  } catch {
    return DEFAULT_PRESENCE_FILTERS
  }
}

export function writePresenceFilters(
  userId: string | null,
  filters: PresenceFilters,
): void {
  if (!userId) return
  try {
    window.localStorage.setItem(
      presenceFiltersKey(userId),
      JSON.stringify(filters),
    )
  } catch {
    // Sin storage la elección vale solo para esta sesión.
  }
}
