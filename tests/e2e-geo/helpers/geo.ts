// tests/e2e-geo/helpers/geo.ts — P22.5
//
// Piezas comunes de la suite del módulo B1: puntos con distancias conocidas respecto de una sede,
// sedes con radio propio (para no depender del radio general, que otros tests pueden mover),
// lectura de lo que quedó guardado en la Base con la clave de servicio y la preparación de un turno
// de hoy con su asignación.

import type { BrowserContext } from '@playwright/test'
import { getAdminDb, type FixedAccountKey } from '../../fixtures/accounts.ts'
import { FRANJAS_MOVIL } from '../../fixtures/movil.ts'
import { readId } from '../../fixtures/sessions.ts'
import {
  Scenario,
  sessionClient,
  uniqueName,
  type MadeClient,
} from '../../fixtures/scenario.ts'

/** Sede de referencia (Obelisco, CABA). */
export const SEDE_COORDS = { lat: -34.6037, lng: -58.3816 }

/** Radio terrestre de la regla (6 371 000 m, B-36). */
const RADIO_TIERRA_M = 6_371_000
const M_POR_GRADO_LAT = (Math.PI / 180) * RADIO_TIERRA_M

export interface Punto {
  lat: number
  lng: number
}

/** Punto a `norteM` metros al norte y `esteM` al este de `base` (aproximación plana, sirve a estas escalas). */
export function desplazar(base: Punto, norteM: number, esteM = 0): Punto {
  const lat = base.lat + norteM / M_POR_GRADO_LAT
  const lng =
    base.lng + esteM / (M_POR_GRADO_LAT * Math.cos((base.lat * Math.PI) / 180))
  return { lat, lng }
}

/** Haversine con el mismo radio que la base (B-36), sin redondear. */
export function distanciaM(a: Punto, b: Punto): number {
  const rad = (g: number) => (g * Math.PI) / 180
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) *
      Math.cos(rad(b.lat)) *
      Math.sin(rad(b.lng - a.lng) / 2) ** 2
  return 2 * RADIO_TIERRA_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Lo que guarda la base: el entero más cercano (`floor(d + 0.5)`). */
export function redondear(metros: number): number {
  return Math.floor(metros + 0.5)
}

/** Posición simulada del navegador (`setGeolocation` acepta `accuracy`, en metros). */
export async function simularPosicion(
  context: BrowserContext,
  punto: Punto,
  accuracy: number,
): Promise<void> {
  await context.setGeolocation({
    latitude: punto.lat,
    longitude: punto.lng,
    accuracy,
  })
}

export interface OpcionesSede {
  /** Coordenadas de la sede; `null` = sede sin coordenadas (CB-20). Por omisión, `SEDE_COORDS`. */
  coords?: Punto | null
  /** Radio propio en metros; `null` = usa el general. Por omisión, 100 m. */
  radio?: number | null
}

/**
 * Sede con radio propio desde el alta (el `insert` no deja rastro en `security_events`, que sí deja
 * un `update` del radio). Se borra con el cliente en `Scenario.cleanup`.
 */
export async function sedeGeo(
  sc: Scenario,
  cliente: MadeClient,
  slug: string,
  opciones: OpcionesSede = {},
): Promise<MadeClient> {
  const coords = opciones.coords === undefined ? SEDE_COORDS : opciones.coords
  const radio = opciones.radio === undefined ? 100 : opciones.radio
  const name = uniqueName(slug)
  const { data, error } = await sc.db
    .from('sites')
    .insert({
      client_id: cliente.id,
      name,
      address: 'Dirección de prueba 123',
      status: 'active',
      latitude: coords?.lat ?? null,
      longitude: coords?.lng ?? null,
      geofence_radius_m: radio,
    })
    .select('id')
    .single()
  if (error) throw new Error(`No se pudo crear la sede: ${error.message}`)
  return { id: data.id, name }
}

export interface TurnoGeo {
  cliente: MadeClient
  sede: MadeClient
  turnoId: string
  asignacionId: string
}

/** Cliente, sede, turno de hoy (todo el día) y la asignación de `quien`. */
export async function turnoDeHoy(
  sc: Scenario,
  slug: string,
  quien: FixedAccountKey,
  opciones: OpcionesSede = {},
): Promise<TurnoGeo> {
  const cliente = await sc.client(slug)
  const sede = await sedeGeo(sc, cliente, slug, opciones)
  const turnoId = await sc.shift(
    cliente.id,
    sede.id,
    sc.today,
    FRANJAS_MOVIL.diaCompleto,
  )
  const asignacionId = await sc.assign(turnoId, quien)
  return { cliente, sede, turnoId, asignacionId }
}

/** Fila de `attendance_records` con lo que guardó la validación (clave de servicio: ve todas las columnas). */
export async function fichajeGuardado(
  sc: Scenario,
  asignacionId: string,
  kind: 'check_in' | 'check_out',
) {
  const { data, error } = await sc.db
    .from('attendance_records')
    .select(
      'id, kind, recorded_at, latitude, longitude, accuracy_m, geo_status, geo_unvalidated_reason, site_distance_m, geofence_radius_m, outside_reason, geo_override_at, geo_override_reason, time_corrected_at, source',
    )
    .eq('assignment_id', asignacionId)
    .eq('kind', kind)
    .single()
  if (error) throw new Error(`No se pudo leer el ${kind}: ${error.message}`)
  return data
}

/** Fila de `supervision_attendance` con lo que guardó la validación. */
export async function fichajeSupervisionGuardado(
  sc: Scenario,
  supervisionId: string,
  kind: 'check_in' | 'check_out',
) {
  const { data, error } = await sc.db
    .from('supervision_attendance')
    .select(
      'id, kind, recorded_at, latitude, longitude, accuracy_m, geo_status, geo_unvalidated_reason, site_distance_m, geofence_radius_m, outside_reason, geo_override_at, geo_override_reason',
    )
    .eq('supervision_id', supervisionId)
    .eq('kind', kind)
    .single()
  if (error) {
    throw new Error(
      `No se pudo leer el ${kind} de la supervisión: ${error.message}`,
    )
  }
  return data
}

/**
 * Deja el consentimiento de `quien` dado hace una hora y el texto de la empresa cambiado hace media
 * hora (B-22: el texto nuevo es posterior al consentimiento). Devuelve la función que repone el
 * valor anterior de `company_settings.location_consent_updated_at` (singleton compartido: hay que
 * llamarla siempre, en el `finally`).
 */
export async function consentimientoVencido(
  quien: FixedAccountKey,
): Promise<() => Promise<void>> {
  const db = getAdminDb()
  const { data: antes, error: errAntes } = await db
    .from('company_settings')
    .select('location_consent_updated_at')
    .eq('id', 1)
    .single()
  if (errAntes) throw new Error(`company_settings: ${errAntes.message}`)
  const restaurar = async () => {
    const { error } = await db
      .from('company_settings')
      .update({
        location_consent_updated_at: antes.location_consent_updated_at,
      })
      .eq('id', 1)
    if (error)
      throw new Error(`No se repuso company_settings: ${error.message}`)
  }
  try {
    const haceUnaHora = new Date(Date.now() - 3_600_000).toISOString()
    const haceMediaHora = new Date(Date.now() - 1_800_000).toISOString()
    const a = await db
      .from('profiles')
      .update({ location_consent_at: haceUnaHora })
      .eq('id', readId(quien))
    if (a.error) throw new Error(`profiles: ${a.error.message}`)
    const b = await db
      .from('company_settings')
      .update({ location_consent_updated_at: haceMediaHora })
      .eq('id', 1)
    if (b.error) throw new Error(`company_settings: ${b.error.message}`)
  } catch (error) {
    await restaurar()
    throw error
  }
  return restaurar
}

export interface Lectura {
  punto: Punto
  precision: number
}

/** Inicio o fin de un empleado con la RPC real y la sesión de la cuenta (como lo hace el celular). */
export async function ficharComoEmpleado(
  quien: FixedAccountKey,
  asignacionId: string,
  kind: 'inicio' | 'fin',
  lectura?: Lectura,
  motivo?: string,
): Promise<void> {
  const cliente = await sessionClient(quien)
  const args = {
    p_assignment_id: asignacionId,
    ...(lectura
      ? {
          p_lat: lectura.punto.lat,
          p_lng: lectura.punto.lng,
          p_accuracy: lectura.precision,
        }
      : {}),
    ...(motivo ? { p_outside_reason: motivo } : {}),
  }
  const { error } =
    kind === 'inicio'
      ? await cliente.rpc('record_check_in', args)
      : await cliente.rpc('record_check_out', args)
  if (error) throw new Error(`fichar ${kind} de ${quien}: ${error.message}`)
}

/** Inicio o fin de una supervisión con la RPC real y la sesión del supervisor. */
export async function ficharComoSupervisor(
  quien: FixedAccountKey,
  supervisionId: string,
  kind: 'inicio' | 'fin',
  lectura?: Lectura,
  motivo?: string,
): Promise<void> {
  const cliente = await sessionClient(quien)
  const args = {
    p_supervision_id: supervisionId,
    ...(lectura
      ? {
          p_lat: lectura.punto.lat,
          p_lng: lectura.punto.lng,
          p_accuracy: lectura.precision,
        }
      : {}),
    ...(motivo ? { p_outside_reason: motivo } : {}),
  }
  const { error } =
    kind === 'inicio'
      ? await cliente.rpc('supervision_check_in', args)
      : await cliente.rpc('supervision_check_out', args)
  if (error)
    throw new Error(`supervisión ${kind} de ${quien}: ${error.message}`)
}

/**
 * Borra el rastro que dejaron las correcciones (`attendance_time_corrected` y
 * `geo_validation_overridden` en `security_events`, que no cuelga del fichaje por clave foránea):
 * son eventos de este test y no tienen que quedar en `App_dev`.
 */
export async function borrarEventosDeCorrecciones(
  sc: Scenario,
  idsDeFichajes: string[],
): Promise<void> {
  if (idsDeFichajes.length === 0) return
  await sc.db
    .from('security_events')
    .delete()
    .in('event_type', [
      'attendance_time_corrected',
      'geo_validation_overridden',
    ])
    .in('details->>record_id', idsDeFichajes)
}

export interface DatoGeo {
  estado: 'valid' | 'outside' | 'unvalidated'
  /** Motivo de «Sin validar» (por omisión `no_location`). */
  motivo?:
    'no_location' | 'site_without_coords' | 'low_accuracy' | 'admin_record'
  /** Distancia guardada (solo si hay posición). */
  distanciaM?: number
  /** La administración lo marcó como válido (B-09). */
  corregido?: boolean
}

export interface PedidoJornadaGeo {
  cliente: MadeClient
  sede: MadeClient
  fecha: string
  franja: { start: string; end: string }
  quien: FixedAccountKey
  /** `HH:MM:SS` del inicio y del fin. */
  entrada: string
  salida: string
  inicio: DatoGeo
  fin: DatoGeo
}

/**
 * Turno + asignación + inicio y fin ya fichados con la validación calculada, en cualquier fecha
 * (también pasada). La asistencia se carga con la clave de servicio (la RPC de fichaje solo ficha
 * hoy); el resto —turno, asignación— usa las RPC reales. Mismo recurso que las suites de horas.
 */
export async function cargarJornadaConGeo(
  sc: Scenario,
  pedido: PedidoJornadaGeo,
): Promise<{ turnoId: string; asignacionId: string }> {
  const turnoId = await sc.shift(
    pedido.cliente.id,
    pedido.sede.id,
    pedido.fecha,
    pedido.franja,
  )
  const asignacionId = await sc.assign(turnoId, pedido.quien)
  const fila = (kind: 'check_in' | 'check_out', hora: string, g: DatoGeo) => {
    const conPosicion = g.estado !== 'unvalidated'
    return {
      assignment_id: asignacionId,
      kind,
      recorded_at: `${pedido.fecha}T${hora}-03:00`,
      source: 'employee_app' as const,
      recorded_by: readId(pedido.quien),
      latitude: conPosicion ? SEDE_COORDS.lat : null,
      longitude: conPosicion ? SEDE_COORDS.lng : null,
      accuracy_m: conPosicion ? 12 : null,
      geo_status: g.estado,
      geo_unvalidated_reason:
        g.estado === 'unvalidated' ? (g.motivo ?? 'no_location') : null,
      site_distance_m: conPosicion ? (g.distanciaM ?? 0) : null,
      geofence_radius_m: 100,
      ...(g.corregido
        ? {
            geo_override_by: readId('admin'),
            geo_override_at: new Date().toISOString(),
            geo_override_reason: 'e2e: corregido por la administración',
          }
        : {}),
    }
  }
  const { error } = await sc.db
    .from('attendance_records')
    .insert([
      fila('check_in', pedido.entrada, pedido.inicio),
      fila('check_out', pedido.salida, pedido.fin),
    ])
  if (error) throw new Error(`fichajes de la jornada: ${error.message}`)
  await sc.db
    .from('assignments')
    .update({ status: 'finished' })
    .eq('id', asignacionId)
  await sc.db.from('shifts').update({ status: 'completed' }).eq('id', turnoId)
  return { turnoId, asignacionId }
}
