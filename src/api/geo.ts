import { supabase } from '@/lib/supabase'
import type { GeoStatus, GeoUnvalidatedReason } from '@/lib/geo'
import { fromPostgrestError } from './errors'
import { fetchPeopleNamesByIds, type PersonName } from './attendance'

/**
 * `src/api/geo.ts` (módulo B1, P22.4): lo que la administración lee y
 * escribe sobre la validación por ubicación de los fichajes.
 *
 * Privacidad (B-40): las columnas `latitude`, `longitude`, `accuracy_m`,
 * `geo_override_by` y `geo_override_reason` de `attendance_records` y
 * `supervision_attendance` están cerradas para `authenticated` (migración
 * `0054`): pedirlas (o hacer `select('*')`) da 42501. Las posiciones se leen
 * SOLO por dos caminos:
 *
 * - `v_presence_today` (mapa de presencia del Resumen);
 * - `get_attendance_location` (mini mapa de solo lectura del detalle).
 *
 * Ninguna otra función de `src/api/` debe pedir esas columnas.
 */

export type GeoRecordType = 'attendance' | 'supervision'

// -------------------------------------------------------------------------
// 1. Mapa de presencia (ADM-02, B-11 a B-15)
// -------------------------------------------------------------------------

export type PresenceKind = 'employee' | 'supervisor' | 'site'

/** Una fila de `v_presence_today`, ya en camelCase. */
export interface PresenceRow {
  kind: PresenceKind
  /** Id del fichaje de inicio del turno (asignación o supervisión); en `site`, el id de la sede. */
  recordId: string
  personId: string | null
  personFirstName: string | null
  personLastName: string | null
  shiftId: string | null
  clientId: string | null
  clientLegalName: string | null
  clientTradeName: string | null
  siteId: string | null
  siteName: string | null
  shiftDate: string | null
  startTime: string | null
  endTime: string | null
  checkInAt: string | null
  checkOutAt: string | null
  inProgress: boolean
  /** Posición del fichaje de inicio; `null` si la persona no dio ubicación. */
  latitude: number | null
  longitude: number | null
  accuracyM: number | null
  geoStatus: GeoStatus | null
  geoReason: GeoUnvalidatedReason | null
  distanceM: number | null
  geofenceRadiusM: number | null
  geoOverridden: boolean
  siteLatitude: number | null
  siteLongitude: number | null
  /** Radio vigente de la sede (propio o general). */
  siteRadiusM: number | null
}

const PRESENCE_SELECT =
  'kind, record_id, person_id, person_first_name, person_last_name, shift_id, client_id, client_legal_name, client_trade_name, site_id, site_name, shift_date, effective_start_time, effective_end_time, check_in_at, check_out_at, in_progress, latitude, longitude, accuracy_m, geo_status, geo_reason, distance_m, geofence_radius_m, geo_overridden, site_latitude, site_longitude, site_radius_m'

interface PresenceRawRow {
  kind: string | null
  record_id: string | null
  person_id: string | null
  person_first_name: string | null
  person_last_name: string | null
  shift_id: string | null
  client_id: string | null
  client_legal_name: string | null
  client_trade_name: string | null
  site_id: string | null
  site_name: string | null
  shift_date: string | null
  effective_start_time: string | null
  effective_end_time: string | null
  check_in_at: string | null
  check_out_at: string | null
  in_progress: boolean | null
  latitude: number | string | null
  longitude: number | string | null
  accuracy_m: number | string | null
  geo_status: GeoStatus | null
  geo_reason: GeoUnvalidatedReason | null
  distance_m: number | string | null
  geofence_radius_m: number | string | null
  geo_overridden: boolean | null
  site_latitude: number | string | null
  site_longitude: number | string | null
  site_radius_m: number | string | null
}

function isPresenceKind(kind: string | null): kind is PresenceKind {
  return kind === 'employee' || kind === 'supervisor' || kind === 'site'
}

/** `numeric` llega como número o como texto según el driver: se normaliza. */
function toNumberOrNull(value: number | string | null): number | null {
  if (value == null) return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function mapPresenceRow(row: PresenceRawRow): PresenceRow | null {
  if (!isPresenceKind(row.kind) || !row.record_id) {
    return null
  }
  return {
    kind: row.kind,
    recordId: row.record_id,
    personId: row.person_id,
    personFirstName: row.person_first_name,
    personLastName: row.person_last_name,
    shiftId: row.shift_id,
    clientId: row.client_id,
    clientLegalName: row.client_legal_name,
    clientTradeName: row.client_trade_name,
    siteId: row.site_id,
    siteName: row.site_name,
    shiftDate: row.shift_date,
    startTime: row.effective_start_time,
    endTime: row.effective_end_time,
    checkInAt: row.check_in_at,
    checkOutAt: row.check_out_at,
    inProgress: row.in_progress ?? false,
    latitude: toNumberOrNull(row.latitude),
    longitude: toNumberOrNull(row.longitude),
    accuracyM: toNumberOrNull(row.accuracy_m),
    geoStatus: row.geo_status,
    geoReason: row.geo_reason,
    distanceM: toNumberOrNull(row.distance_m),
    geofenceRadiusM: toNumberOrNull(row.geofence_radius_m),
    geoOverridden: row.geo_overridden ?? false,
    siteLatitude: toNumberOrNull(row.site_latitude),
    siteLongitude: toNumberOrNull(row.site_longitude),
    siteRadiusM: toNumberOrNull(row.site_radius_m),
  }
}

/**
 * Presencia de hoy (`v_presence_today`, solo dueño y administradores): fichajes
 * de inicio de hoy (con y sin fin), supervisiones en curso y sedes con turno
 * hoy. Una sola consulta; el filtrado por «en curso» / «finalizados» lo hace
 * la pantalla.
 */
export async function fetchPresenceToday(): Promise<PresenceRow[]> {
  const { data, error } = await supabase
    .from('v_presence_today')
    .select(PRESENCE_SELECT)

  if (error) {
    throw fromPostgrestError(error)
  }
  return (data ?? [])
    .map((row) => mapPresenceRow(row as unknown as PresenceRawRow))
    .filter((row): row is PresenceRow => row !== null)
}

// -------------------------------------------------------------------------
// 2. Posición de un fichaje para el mini mapa (ADM-06 / ADM-15)
// -------------------------------------------------------------------------

export interface AttendanceLocation {
  recordType: GeoRecordType
  recordId: string
  kind: 'check_in' | 'check_out'
  recordedAt: string
  /** `null` si el fichaje no tiene posición. */
  latitude: number | null
  longitude: number | null
  accuracyM: number | null
  geoStatus: GeoStatus
  geoReason: GeoUnvalidatedReason | null
  distanceM: number | null
  geofenceRadiusM: number | null
  geoOverridden: boolean
  siteId: string
  siteName: string
  siteLatitude: number | null
  siteLongitude: number | null
  siteRadiusM: number | null
}

interface AttendanceLocationRaw {
  record_type: GeoRecordType
  record_id: string
  kind: 'check_in' | 'check_out'
  recorded_at: string
  latitude: number | string | null
  longitude: number | string | null
  accuracy_m: number | string | null
  geo_status: GeoStatus
  geo_reason: GeoUnvalidatedReason | null
  distance_m: number | null
  geofence_radius_m: number | null
  geo_overridden: boolean
  site_id: string
  site_name: string
  site_latitude: number | string | null
  site_longitude: number | string | null
  site_radius_m: number | null
}

export function mapAttendanceLocation(
  raw: AttendanceLocationRaw,
): AttendanceLocation {
  return {
    recordType: raw.record_type,
    recordId: raw.record_id,
    kind: raw.kind,
    recordedAt: raw.recorded_at,
    latitude: toNumberOrNull(raw.latitude),
    longitude: toNumberOrNull(raw.longitude),
    accuracyM: toNumberOrNull(raw.accuracy_m),
    geoStatus: raw.geo_status,
    geoReason: raw.geo_reason,
    distanceM: raw.distance_m,
    geofenceRadiusM: raw.geofence_radius_m,
    geoOverridden: raw.geo_overridden,
    siteId: raw.site_id,
    siteName: raw.site_name,
    siteLatitude: toNumberOrNull(raw.site_latitude),
    siteLongitude: toNumberOrNull(raw.site_longitude),
    siteRadiusM: raw.site_radius_m,
  }
}

/**
 * `get_attendance_location` (solo dueño y administradores): la posición del
 * fichaje, su validación congelada y la sede con su radio vigente. Errores:
 * `FORBIDDEN`, `INVALID_RECORD_TYPE`, `RECORD_NOT_FOUND`.
 */
export async function fetchAttendanceLocation(
  recordType: GeoRecordType,
  recordId: string,
): Promise<AttendanceLocation> {
  const { data, error } = await supabase.rpc('get_attendance_location', {
    p_record_type: recordType,
    p_record_id: recordId,
  })

  if (error) {
    throw fromPostgrestError(error)
  }
  return mapAttendanceLocation(data as unknown as AttendanceLocationRaw)
}

// -------------------------------------------------------------------------
// 3. Correcciones (B-09, B-28, B-41)
// -------------------------------------------------------------------------

/**
 * `correct_attendance_time` (B-28): cambia la hora de un inicio o fin ya
 * registrado, con motivo obligatorio. Solo para el dueño o un administrador
 * con `manage_attendance`. El servidor guarda el valor anterior, quién y
 * cuándo (`attendance_corrections`). Errores: `FORBIDDEN`, `RECORD_NOT_FOUND`,
 * `SHIFT_CANCELLED`, `REASON_REQUIRED`, `TIME_REQUIRED`, `AT_OUT_OF_RANGE`,
 * `SAME_TIME`, `INVALID_TIME_RANGE`.
 */
export async function correctAttendanceTime(
  recordId: string,
  newTime: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase.rpc('correct_attendance_time', {
    p_record_id: recordId,
    p_new_time: newTime,
    p_reason: reason,
  })

  if (error) {
    throw fromPostgrestError(error)
  }
}

/**
 * `override_geo_validation` (B-09): marca como válido un fichaje rojo o gris,
 * con motivo obligatorio. El resultado original se conserva. Errores:
 * `FORBIDDEN`, `INVALID_RECORD_TYPE`, `REASON_REQUIRED`, `RECORD_NOT_FOUND`,
 * `GEO_ALREADY_VALID`, `GEO_ALREADY_OVERRIDDEN`.
 */
export async function overrideGeoValidation(
  recordType: GeoRecordType,
  recordId: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase.rpc('override_geo_validation', {
    p_record_type: recordType,
    p_record_id: recordId,
    p_reason: reason,
  })

  if (error) {
    throw fromPostgrestError(error)
  }
}

export type CorrectionKind = 'time' | 'geo'

/** Una corrección del historial de un fichaje (`attendance_corrections`, solo administración). */
export interface AttendanceCorrection {
  id: string
  attendanceRecordId: string
  kind: CorrectionKind
  oldRecordedAt: string | null
  newRecordedAt: string | null
  reason: string
  correctedBy: string
  correctedByName: PersonName | null
  createdAt: string
}

/**
 * Historial de correcciones de una lista de fichajes (`attendance_corrections`,
 * RLS de administración), del más reciente al más antiguo. Resuelve el nombre
 * de quien corrigió con `v_people_basic`. Las supervisiones no tienen tabla de
 * correcciones (solo se les puede marcar la validación como válida).
 */
export async function fetchAttendanceCorrections(
  recordIds: string[],
): Promise<AttendanceCorrection[]> {
  const ids = Array.from(new Set(recordIds))
  if (ids.length === 0) {
    return []
  }
  const { data, error } = await supabase
    .from('attendance_corrections')
    .select(
      'id, attendance_record_id, kind, old_recorded_at, new_recorded_at, reason, corrected_by, created_at',
    )
    .in('attendance_record_id', ids)
    .order('created_at', { ascending: false })

  if (error) {
    throw fromPostgrestError(error)
  }
  const rows = data ?? []
  const names = await fetchPeopleNamesByIds(rows.map((r) => r.corrected_by))
  return rows.map((row) => ({
    id: row.id,
    attendanceRecordId: row.attendance_record_id,
    kind: row.kind,
    oldRecordedAt: row.old_recorded_at,
    newRecordedAt: row.new_recorded_at,
    reason: row.reason,
    correctedBy: row.corrected_by,
    correctedByName: names.get(row.corrected_by) ?? null,
    createdAt: row.created_at,
  }))
}

// -------------------------------------------------------------------------
// 4. Radio general (B-02, B-16)
// -------------------------------------------------------------------------

/**
 * `set_geofence_radius` (B-02): radio general de validación, de 50 a 1000 m.
 * Dueño y administradores (`require_admin`). Errores: `FORBIDDEN`,
 * `RADIUS_OUT_OF_RANGE`. El valor ya guardado en fichajes anteriores no se
 * recalcula (B-08).
 */
export async function setGeofenceRadius(radiusM: number): Promise<number> {
  const { data, error } = await supabase.rpc('set_geofence_radius', {
    p_radius: radiusM,
  })

  if (error) {
    throw fromPostgrestError(error)
  }
  return data.geofence_radius_m
}

/** Radio general y consentimiento (B-02, B-22): lectura puntual de `company_settings` (la ve cualquier persona logueada). */
export interface CompanyGeofence {
  radiusM: number
  maxAccuracyM: number
  locationConsentUpdatedAt: string | null
}

export async function fetchCompanyGeofence(): Promise<CompanyGeofence> {
  const { data, error } = await supabase
    .from('company_settings')
    .select(
      'geofence_radius_m, geofence_max_accuracy_m, location_consent_updated_at',
    )
    .eq('id', 1)
    .single()

  if (error) {
    throw fromPostgrestError(error)
  }
  return {
    radiusM: data.geofence_radius_m,
    maxAccuracyM: data.geofence_max_accuracy_m,
    locationConsentUpdatedAt: data.location_consent_updated_at,
  }
}
