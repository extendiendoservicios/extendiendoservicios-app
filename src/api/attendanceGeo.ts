import type { GeoStatus, GeoUnvalidatedReason } from '@/lib/geo'

/**
 * Validación por ubicación de un fichaje tal como la guardó la base (módulo
 * B1, B-03, B-08, B-37). Es lo único de la ubicación que las pantallas del
 * celular pueden mostrar después de fichar: el estado, el motivo si quedó
 * «Sin validar» y la distancia a la sede. Las coordenadas y la precisión del
 * fichaje no se leen nunca (B-40: la base las cierra con `42501`).
 */
export interface AttendanceGeo {
  status: GeoStatus
  /** Motivo de «Sin validar» (`null` en los otros dos estados). */
  reason: GeoUnvalidatedReason | null
  /** Distancia a la sede en metros enteros, congelada al fichar (B-08). */
  distanceM: number | null
  /** Radio vigente de la sede en ese momento (B-08). */
  radiusM: number | null
  /** La administración lo marcó como válido (B-09): se ve «Validado (corregido)», sin el motivo. */
  overridden: boolean
}

/**
 * Arma la validación de un fichaje a partir de las columnas de la base.
 * Devuelve `null` si no hay estado (por ejemplo, un fichaje todavía no
 * registrado en una vista que trae el inicio y el fin juntos).
 */
export function mapAttendanceGeo(row: {
  status: GeoStatus | null | undefined
  reason?: GeoUnvalidatedReason | null
  distanceM?: number | null
  radiusM?: number | null
  overridden?: boolean | null
}): AttendanceGeo | null {
  if (!row.status) return null
  return {
    status: row.status,
    reason: row.reason ?? null,
    distanceM: row.distanceM ?? null,
    radiusM: row.radiusM ?? null,
    overridden: row.overridden ?? false,
  }
}
