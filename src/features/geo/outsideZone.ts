import type { AttendanceBoardRow, BoardAttendanceGeo } from '@/api/attendance'

/**
 * «Fuera de zona» sin corregir (B-03, B-09): el fichaje quedó rojo y la
 * administración no lo marcó como válido. Mismo criterio que
 * `has_outside_geo` de `v_assignments_board`.
 */
export function isGeoOutside(
  geo: BoardAttendanceGeo | null | undefined,
): boolean {
  return geo != null && geo.status === 'outside' && !geo.overridden
}

/** La asignación tiene el inicio o el fin «Fuera de zona» sin corregir. */
export function hasOutsideZone(
  row: Pick<AttendanceBoardRow, 'checkInGeo' | 'checkOutGeo'>,
): boolean {
  return isGeoOutside(row.checkInGeo) || isGeoOutside(row.checkOutGeo)
}

/** Filtro «Solo fuera de zona» de la planilla de asistencia (B-20). */
export function filterOutsideZone<
  T extends Pick<AttendanceBoardRow, 'checkInGeo' | 'checkOutGeo'>,
>(rows: T[], onlyOutside: boolean): T[] {
  return onlyOutside ? rows.filter(hasOutsideZone) : rows
}

/** Marca « (corregido)» junto a una hora que la administración corrigió (B-28). */
export function timeCorrectedSuffix(
  geo: Pick<BoardAttendanceGeo, 'timeCorrected'> | null | undefined,
): string {
  return geo?.timeCorrected ? ' · Corregido' : ''
}
