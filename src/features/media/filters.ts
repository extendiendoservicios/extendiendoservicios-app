import type { MediaKind, ShiftMediaFilters } from '@/api/mediaAdmin'
import { addDaysToIsoDate } from '@/features/settings/dateOnly'

/**
 * Filtros de ADM-32 «Fotos y videos» (H-09): rango de fechas, cliente, sede,
 * persona, tipo y «Conservadas» / «Por vencer en 7 días». Puro, sin React.
 */

/** Rango por defecto: los últimos 30 días. */
export const DEFAULT_RANGE_DAYS = 30
/** «Por vencer en 7 días». */
export const EXPIRING_DAYS = 7

export type MediaStateFilter = 'all' | 'keep' | 'expiring'

export interface MediaFilterState {
  dateFrom: string
  dateTo: string
  /** `'all'` = sin filtro (valor del `Select`). */
  clientId: string
  siteId: string
  uploadedBy: string
  kind: MediaKind | 'all'
  /** Una sola a la vez: lo conservado nunca está «por vencer». */
  state: MediaStateFilter
}

export function defaultMediaFilters(today: string): MediaFilterState {
  return {
    dateFrom: addDaysToIsoDate(today, -DEFAULT_RANGE_DAYS),
    dateTo: today,
    clientId: 'all',
    siteId: 'all',
    uploadedBy: 'all',
    kind: 'all',
    state: 'all',
  }
}

/**
 * Cambia «Conservadas» / «Por vencer». Lo que está por vencer tiene 53 a 60
 * días, así que el rango por defecto de 30 días lo taparía: si el rango sigue
 * siendo el de por defecto, se vacía (la persona lo puede volver a poner).
 */
export function withStateFilter(
  filters: MediaFilterState,
  state: MediaStateFilter,
  today: string,
): MediaFilterState {
  const defaults = defaultMediaFilters(today)
  const isDefaultRange =
    filters.dateFrom === defaults.dateFrom && filters.dateTo === defaults.dateTo
  if (state !== 'all' && isDefaultRange) {
    return { ...filters, state, dateFrom: '', dateTo: '' }
  }
  if (state === 'all' && filters.dateFrom === '' && filters.dateTo === '') {
    return {
      ...filters,
      state,
      dateFrom: defaults.dateFrom,
      dateTo: defaults.dateTo,
    }
  }
  return { ...filters, state }
}

/** Cambiar de cliente deja sin efecto la sede elegida (es de otro cliente). */
export function withClient(
  filters: MediaFilterState,
  clientId: string,
): MediaFilterState {
  return { ...filters, clientId, siteId: 'all' }
}

export function toApiFilters(
  filters: MediaFilterState,
  today: string,
): ShiftMediaFilters {
  return {
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
    clientId: filters.clientId === 'all' ? undefined : filters.clientId,
    siteId: filters.siteId === 'all' ? undefined : filters.siteId,
    uploadedBy: filters.uploadedBy === 'all' ? undefined : filters.uploadedBy,
    kind: filters.kind === 'all' ? undefined : filters.kind,
    keepOnly: filters.state === 'keep' ? true : undefined,
    expiresBy:
      filters.state === 'expiring'
        ? addDaysToIsoDate(today, EXPIRING_DAYS)
        : undefined,
  }
}
