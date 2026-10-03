// tests/fixtures/movil.ts — TEST-017/TEST-018 (P18.2)
//
// Piezas compartidas por las suites móviles de empleado y supervisor: franjas que no dependen de
// la hora de la corrida, posición simulada, estado de las cuentas fijas (consentimiento de
// ubicación, "visto" de los cambios) y los pasos de preparación que se hacen por RPC con la
// sesión de la cuenta (nunca con la clave de servicio: `service_role` no tiene `auth.uid()`).

import {
  expect,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
  type TestInfo,
} from '@playwright/test'
import { crc32, deflateSync } from 'node:zlib'
import { getAdminDb, type FixedAccountKey } from './accounts.ts'
import { minutesSinceMidnightAR } from './dates.ts'
import { readId, storageStatePath, type SessionKey } from './sessions.ts'
import { sessionClient } from './scenario.ts'

/** Posición fija (Plaza de Mayo, CABA): la Base no la valida contra la sede (P-067). */
export const POSICION_SIMULADA = { latitude: -34.6083, longitude: -58.3712 }

/** Franjas extra de los tests móviles (se suman a `FRANJAS` de `dates.ts`). */
export const FRANJAS_MOVIL = {
  /**
   * Todo el día: el inicio ya pasó y el fin todavía no. Sirve para las supervisiones (la ventana
   * de calificación de P-083 es `now() <= greatest(fin previsto, fin registrado)`, así que el fin
   * previsto tiene que estar en el futuro) y para fichar con "salida anticipada".
   */
  diaCompleto: { start: '00:00', end: '23:59' },
  /** Últimos diez minutos del día: "salida anticipada" salvo en el último minuto (se saltea antes). */
  finDia: { start: '23:50', end: '23:59' },
} as const

/** Pantallas con texto fijo que usan varios archivos. */
export const TEXTO = {
  hoyVacio: 'No tenés servicios hoy',
  ubicacionConsentimiento:
    'Antes de registrar el inicio, te pedimos tu consentimiento de ubicación.',
  horaReferencia:
    'Hora de referencia de tu celular. La hora que vale y queda registrada es la del servidor.',
  avisoTarde: 'El aviso tiene que hacerse antes de la hora de inicio.',
  salidaAnticipada: 'Vas a registrar la salida antes del horario previsto.',
} as const

/** `HH:MM` a partir de minutos desde las 0:00. */
export function hhmm(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Segundos desde las 0:00 de Argentina (para los bordes exactos). */
export function secondsSinceMidnightAR(): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? '0')
  return get('hour') * 3600 + get('minute') * 60 + get('second')
}

/** Minutos actuales de Argentina (reexportado para que los specs importen de un solo lugar). */
export const minutosAhora = minutesSinceMidnightAR

/**
 * Deja el consentimiento de ubicación de la cuenta como pide el test (`true`: consentido ahora;
 * `false`: sin consentimiento, el estado de una persona que nunca fichó). Es estado de la cuenta
 * fija, no un dato por corrida: cada test que depende de él lo fija al empezar.
 */
export async function fijarConsentimiento(
  who: FixedAccountKey,
  consentido: boolean,
): Promise<void> {
  const { error } = await getAdminDb()
    .from('profiles')
    .update({
      location_consent_at: consentido ? new Date().toISOString() : null,
    })
    .eq('id', readId(who))
  if (error)
    throw new Error(`No se pudo fijar el consentimiento: ${error.message}`)
}

/**
 * Marca los cambios como vistos con la RPC real y la sesión de la cuenta (`mark_changes_seen`):
 * la hora de referencia es la del servidor, así que no hay desfase de reloj con un cambio hecho
 * después por administración.
 */
export async function marcarCambiosVistos(who: FixedAccountKey): Promise<void> {
  const client = await sessionClient(who)
  const { error } = await client.rpc('mark_changes_seen')
  if (error) throw new Error(`mark_changes_seen: ${error.message}`)
}

/** Registra el inicio de una asignación con la sesión del empleado (preparación del escenario). */
export async function fichar(
  who: FixedAccountKey,
  assignmentId: string,
  kind: 'inicio' | 'fin',
): Promise<void> {
  const client = await sessionClient(who)
  const { error } =
    kind === 'inicio'
      ? await client.rpc('record_check_in', { p_assignment_id: assignmentId })
      : await client.rpc('record_check_out', { p_assignment_id: assignmentId })
  if (error) throw new Error(`fichar ${kind}: ${error.message}`)
}

/** Inicio o fin de una supervisión con la sesión del supervisor (preparación del escenario). */
export async function supervisionFichar(
  who: FixedAccountKey,
  supervisionId: string,
  kind: 'inicio' | 'fin',
): Promise<void> {
  const client = await sessionClient(who)
  const { error } =
    kind === 'inicio'
      ? await client.rpc('supervision_check_in', {
          p_supervision_id: supervisionId,
        })
      : await client.rpc('supervision_check_out', {
          p_supervision_id: supervisionId,
        })
  if (error) throw new Error(`supervisión ${kind}: ${error.message}`)
}

/** Califica con la RPC real y la sesión del supervisor (preparación del escenario). */
export async function calificar(
  who: FixedAccountKey,
  supervisionId: string,
  assignmentId: string,
  score: number,
  comment?: string,
): Promise<void> {
  const client = await sessionClient(who)
  const { error } = await client.rpc('rate_employee', {
    p_supervision_id: supervisionId,
    p_assignment_id: assignmentId,
    p_score: score,
    ...(comment ? { p_comment: comment } : {}),
  })
  if (error) throw new Error(`rate_employee: ${error.message}`)
}

/** Agrega tareas al turno (el turno puntual del escenario no copia ninguna plantilla). */
export async function tareasDelTurno(
  shiftId: string,
  tareas: Array<{ title: string; required?: boolean }>,
): Promise<void> {
  const { error } = await getAdminDb()
    .from('shift_tasks')
    .insert(
      tareas.map((t, i) => ({
        shift_id: shiftId,
        position: i,
        title: t.title,
        is_required: t.required ?? true,
        status: 'pending' as const,
      })),
    )
  if (error)
    throw new Error(`No se pudieron crear las tareas: ${error.message}`)
}

/** Espera a que la pantalla de Hoy del empleado haya cargado (la tarjeta del servicio o el vacío). */
export async function esperarHoy(page: Page): Promise<void> {
  await expect(page.getByText('Cargando…')).toHaveCount(0)
}

/**
 * Espera, sin `sleep`, hasta que el reloj de Argentina pase de los segundos indicados desde la
 * medianoche (más un margen para el desfase entre este reloj y el del servidor).
 */
export async function esperarHastaSegundo(
  segundoDelDia: number,
  margenSegundos = 3,
  timeoutMs = 200_000,
): Promise<void> {
  await expect
    .poll(() => secondsSinceMidnightAR() >= segundoDelDia + margenSegundos, {
      timeout: timeoutMs,
      intervals: [500],
    })
    .toBe(true)
}

/**
 * Contexto de navegador de OTRA cuenta fija con la misma configuración del proyecto (viewport
 * táctil, agente de usuario, zona horaria): para los tests que necesitan dos personas a la vez.
 */
export async function contextoDe(
  browser: Browser,
  testInfo: TestInfo,
  key: SessionKey,
  extra: BrowserContextOptions = {},
): Promise<BrowserContext> {
  const use = testInfo.project.use
  return browser.newContext({
    baseURL: use.baseURL,
    viewport: use.viewport ?? undefined,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
    userAgent: use.userAgent,
    deviceScaleFactor: use.deviceScaleFactor,
    locale: use.locale,
    timezoneId: use.timezoneId,
    storageState: storageStatePath(key),
    ...extra,
  })
}

/** PNG cuadrado de un solo color (para cargar una foto de perfil sin depender de ningún archivo). */
export function pngSolido(lado = 64): Buffer {
  const firma = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const trozo = (tipo: string, datos: Buffer): Buffer => {
    const largo = Buffer.alloc(4)
    largo.writeUInt32BE(datos.length)
    const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(cuerpo))
    return Buffer.concat([largo, cuerpo, crc])
  }
  const cabecera = Buffer.alloc(13)
  cabecera.writeUInt32BE(lado, 0)
  cabecera.writeUInt32BE(lado, 4)
  cabecera[8] = 8 // profundidad de bits
  cabecera[9] = 2 // color verdadero (RGB)
  // Cada fila: byte de filtro 0 + `lado` píxeles RGB teal.
  const fila = Buffer.concat([
    Buffer.from([0]),
    Buffer.concat(
      Array.from({ length: lado }, () => Buffer.from([0x0d, 0x94, 0x88])),
    ),
  ])
  const crudo = Buffer.concat(Array.from({ length: lado }, () => fila))
  return Buffer.concat([
    firma,
    trozo('IHDR', cabecera),
    trozo('IDAT', deflateSync(crudo)),
    trozo('IEND', Buffer.alloc(0)),
  ])
}
