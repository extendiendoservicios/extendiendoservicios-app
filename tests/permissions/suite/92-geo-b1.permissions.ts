// tests/permissions/suite/92-geo-b1.permissions.ts — P22.5 (módulo B1)
//
// Geolocalización y corrección de fichajes (migraciones 0052 a 0057) por API directa con
// `supabase-js`: cada perfil (visitante, empleado, supervisor, doble rol, administrador sin y con
// `manage_attendance`, dueño) contra
//   - las RPC `correct_attendance_time` (B-28), `override_geo_validation` (B-09),
//     `set_geofence_radius` (B-02), `get_attendance_location` (B-40), `accept_location_consent` y
//     `revoke_location_consent` (B-22) y `client_service_summary` (B-20);
//   - la vista `v_presence_today` (B-11, B-40);
//   - las columnas cerradas de `attendance_records` y `supervision_attendance` (B-40, 0054):
//     `latitude`, `longitude`, `accuracy_m`, `geo_override_by` y `geo_override_reason`, incluido
//     `select *` (42501);
//   - el `update` de `sites.geofence_radius_m`.
// Resultado esperado de lo no permitido: cero filas, `FORBIDDEN` o error de permisos (42501), y
// que el dato NO haya cambiado. Cada bloque tiene su contraprueba (lo permitido funciona), para
// que un `deny all` accidental no pase.
//
// Los datos son propios (`e2e-perm-geo-…`): un cliente con una sede (radio propio de 100 m) y un
// turno de HOY de todo el día, con fichajes reales hechos con las RPC y las sesiones de cada perfil.
// Se borran al final con `deleteClientDeep`.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isTooCloseToMidnight, todayAR } from '../../fixtures/dates.ts'
import { borrarJornadasDe, deleteClientDeep } from '../../fixtures/scenario.ts'
import { describir, filas, tabla } from './ayudas.ts'
import { clienteDe, contexto, servicio } from './contexto.ts'
import { PREFIJO } from './escenario.ts'
import {
  ES_ADMIN,
  ETIQUETA,
  PERFILES,
  type Perfil,
  type PerfilConSesion,
} from './perfiles.ts'

const U = '00000000-0000-4000-8000-000000000001'
const SEDE = { lat: -34.6037, lng: -58.3816 }
/** A 450 m al este de la sede: «Fuera de zona» con el radio de 100 m. */
const AFUERA = {
  lat: SEDE.lat,
  lng: SEDE.lng + 450 / (111_194.93 * Math.cos((SEDE.lat * Math.PI) / 180)),
}

const COLUMNAS_CERRADAS = [
  'latitude',
  'longitude',
  'accuracy_m',
  'geo_override_by',
  'geo_override_reason',
] as const
const TABLAS_DE_ASISTENCIA = [
  'attendance_records',
  'supervision_attendance',
] as const

/** Con qué se observa el resultado de una RPC: `42501`, el `hint` del servidor, o `OK`. */
async function llamar(
  perfil: Perfil,
  rpc: string,
  args: Record<string, unknown>,
): Promise<{ observado: string; data: unknown; detalle: string }> {
  const { data, error } = await clienteDe(perfil).rpc(
    rpc as 'mark_changes_seen',
    args as never,
  )
  const observado = error
    ? error.code === '42501'
      ? '42501'
      : (error.hint ?? error.code)
    : 'OK'
  return {
    observado,
    data,
    detalle: error ? `${error.code}: ${error.message}` : 'la RPC no falló',
  }
}

/** Esperado por perfil: `anon` 42501; los de `pasan`, lo que se indica; el resto, `FORBIDDEN`. */
function esperado(pasan: readonly Perfil[], ok = 'OK'): Record<Perfil, string> {
  return Object.fromEntries(
    PERFILES.map((p) => [
      p,
      p === 'anon' ? '42501' : pasan.includes(p) ? ok : 'FORBIDDEN',
    ]),
  ) as Record<Perfil, string>
}

interface Datos {
  clienteId: string
  sedeId: string
  turnoId: string
  /** Fichaje de inicio de empleado1 (perfil `empleado`), fuera de zona, con posición. */
  fichajeEmp: string
  /** Fichaje de inicio del doble rol (como empleado), sin ubicación. */
  fichajeDual: string
  /** Fichaje de inicio de supervisor1 en su supervisión, fuera de zona. */
  fichajeSup: string
  supervisionId: string
  asigEmp: string
  asigDual: string
  radioGeneral: number
  dia: string
}

let d: Datos

/**
 * A menos de 6 minutos de la medianoche (o recién pasada) el «hoy» de la base cambia durante la
 * corrida y las correcciones de hora (que se acotan al día del turno) no se pueden armar: la suite
 * se saltea entera, explícito, en vez de inventar un reloj.
 */
const CERCA_DE_MEDIANOCHE = isTooCloseToMidnight()

async function aceptar<T>(
  que: string,
  p: PromiseLike<{ data: T; error: { message: string } | null }>,
): Promise<NonNullable<T>> {
  const { data, error } = await p
  if (error || data === null || data === undefined) {
    throw new Error(`92-geo-b1 (${que}): ${error?.message ?? 'sin datos'}`)
  }
  return data
}

beforeAll(async () => {
  if (CERCA_DE_MEDIANOCHE) return
  const c = contexto()
  const db = servicio()
  const owner = clienteDe('owner')
  const dia = todayAR()

  const empresa = await aceptar(
    'company_settings',
    db
      .from('company_settings')
      .select('geofence_radius_m')
      .eq('id', 1)
      .single(),
  )

  const cliente = await aceptar(
    'cliente',
    db
      .from('clients')
      .insert({
        legal_name: `${PREFIJO}geo-cliente-${Date.now().toString(36)}`,
        trade_name: `${PREFIJO}geo-cliente-${Date.now().toString(36)}`,
        cuit: `20${`${Date.now()}`.slice(-8)}${Math.floor(Math.random() * 10)}`,
        status: 'active',
      })
      .select('id')
      .single(),
  )
  const sede = await aceptar(
    'sede',
    db
      .from('sites')
      .insert({
        client_id: cliente.id,
        name: `${PREFIJO}geo-sede-${Date.now().toString(36)}`,
        address: 'Dirección de prueba 123',
        status: 'active',
        latitude: SEDE.lat,
        longitude: SEDE.lng,
        geofence_radius_m: 100,
      })
      .select('id')
      .single(),
  )
  const turno = await aceptar(
    'turno',
    db
      .from('shifts')
      .insert({
        client_id: cliente.id,
        site_id: sede.id,
        shift_date: dia,
        start_time: '00:00',
        end_time: '23:59',
        required_staff: 2,
      })
      .select('id')
      .single(),
  )
  const asignar = async (empleadoId: string) => {
    const { data, error } = await owner.rpc('assign_employee', {
      p_shift_id: turno.id,
      p_employee_id: empleadoId,
    })
    if (error) throw new Error(`assign_employee: ${error.message}`)
    return (data as unknown as { assignment: { id: string } }).assignment.id
  }
  const asigEmp = await asignar(c.ids.empleado1)
  const asigDual = await asignar(c.ids.dual)
  // Fichajes reales: cada uno con su propia sesión (la base calcula la validación).
  const ficharEmp = await clienteDe('empleado').rpc('record_check_in', {
    p_assignment_id: asigEmp,
    p_lat: AFUERA.lat,
    p_lng: AFUERA.lng,
    p_accuracy: 12,
    p_outside_reason: 'e2e-perm: motivo del empleado',
  })
  if (ficharEmp.error)
    throw new Error(`record_check_in: ${ficharEmp.error.message}`)
  const ficharDual = await clienteDe('dual').rpc('record_check_in', {
    p_assignment_id: asigDual,
  })
  if (ficharDual.error)
    throw new Error(`record_check_in dual: ${ficharDual.error.message}`)
  // P24.5: el coordinador inicia su jornada y toma el turno (`take_supervision` registra el inicio
  // con la validación de sede; ya no hay asignación manual ni `supervision_check_in`).
  const jornada = await clienteDe('supervisor').rpc('start_workday')
  if (jornada.error) throw new Error(`start_workday: ${jornada.error.message}`)
  const sup = await clienteDe('supervisor').rpc('take_supervision', {
    p_shift_id: turno.id,
    p_lat: AFUERA.lat,
    p_lng: AFUERA.lng,
    p_accuracy: 15,
  })
  if (sup.error) throw new Error(`take_supervision: ${sup.error.message}`)
  const supervisionId = (sup.data as unknown as { supervision: { id: string } })
    .supervision.id

  const idDe = async (
    tablaNombre: 'attendance_records' | 'supervision_attendance',
    col: string,
    valor: string,
  ) =>
    (
      await aceptar(
        tablaNombre,
        db
          .from(tablaNombre)
          .select('id')
          .eq(col, valor)
          .eq('kind', 'check_in')
          .single(),
      )
    ).id

  d = {
    clienteId: cliente.id,
    sedeId: sede.id,
    turnoId: turno.id,
    asigEmp,
    asigDual,
    supervisionId,
    fichajeEmp: await idDe('attendance_records', 'assignment_id', asigEmp),
    fichajeDual: await idDe('attendance_records', 'assignment_id', asigDual),
    fichajeSup: await idDe(
      'supervision_attendance',
      'supervision_id',
      supervisionId,
    ),
    radioGeneral: empresa.geofence_radius_m,
    dia,
  }
}, 120_000)

afterAll(async () => {
  if (!d) return
  const db = servicio()
  const notas = await deleteClientDeep(db, d.clienteId)
  // La jornada del coordinador de esta suite (P24.5) es dato de la prueba.
  notas.push(
    ...(await borrarJornadasDe(db, [contexto().ids.supervisor1], todayAR())),
  )
  // El rastro de los cambios de radio de esta suite (eventos propios, con el id de la sede).
  await db
    .from('security_events')
    .delete()
    .eq('event_type', 'geofence_radius_changed')
    .eq('details->>site_id', d.sedeId)
  // La fecha del consentimiento de las cuentas de esta suite no se repone: no afecta a nadie.
  if (notas.length > 0) {
    console.warn(`[92-geo-b1] limpieza con notas: ${notas.join(' | ')}`)
  }
}, 120_000)

describe.skipIf(CERCA_DE_MEDIANOCHE)(
  'datos de partida de la suite (los fichajes los calculó la base)',
  () => {
    it('el fichaje del empleado quedó «Fuera de zona» con su distancia, radio vigente y motivo; el del doble rol, sin validar (B-03, B-08)', async () => {
      const { data: emp } = await servicio()
        .from('attendance_records')
        .select(
          'geo_status, geo_unvalidated_reason, site_distance_m, geofence_radius_m, outside_reason, latitude, accuracy_m',
        )
        .eq('id', d.fichajeEmp)
        .single()
      expect(emp?.geo_status).toBe('outside')
      expect(emp?.site_distance_m).toBeGreaterThan(400)
      expect(emp?.geofence_radius_m).toBe(100)
      expect(emp?.outside_reason).toBe('e2e-perm: motivo del empleado')
      expect(emp?.latitude).not.toBeNull()
      const { data: dual } = await servicio()
        .from('attendance_records')
        .select('geo_status, geo_unvalidated_reason, latitude')
        .eq('id', d.fichajeDual)
        .single()
      expect(dual?.geo_status).toBe('unvalidated')
      expect(dual?.geo_unvalidated_reason).toBe('no_location')
      expect(dual?.latitude).toBeNull()
    })
  },
)

// ---------------------------------------------------------------------------------------------
// Columnas cerradas (B-40, 0054)
// ---------------------------------------------------------------------------------------------

describe.skipIf(CERCA_DE_MEDIANOCHE)(
  'columnas cerradas de attendance_records y supervision_attendance (B-40, 0054)',
  () => {
    for (const nombreTabla of TABLAS_DE_ASISTENCIA) {
      for (const perfil of PERFILES) {
        for (const columna of COLUMNAS_CERRADAS) {
          it(`[${ETIQUETA[perfil]}] ${nombreTabla}.select(${columna}) -> 42501 (B-40, RB-X02)`, async () => {
            const res = await tabla(clienteDe(perfil), nombreTabla)
              .select(columna)
              .limit(1)
            expect(res.error?.code, describir(res)).toBe('42501')
            expect(filas(res)).toEqual([])
          })
        }
        it(`[${ETIQUETA[perfil]}] ${nombreTabla}.select(*) -> 42501: nadie lee la fila entera (B-40, RB-X02)`, async () => {
          const res = await tabla(clienteDe(perfil), nombreTabla)
            .select('*')
            .limit(1)
          expect(res.error?.code, describir(res)).toBe('42501')
          expect(filas(res)).toEqual([])
        })
        it(`[${ETIQUETA[perfil]}] ${nombreTabla}.select(id, columna abierta, columna cerrada) -> 42501: una sola cerrada alcanza (B-40)`, async () => {
          const res = await tabla(clienteDe(perfil), nombreTabla)
            .select('id, geo_status, latitude')
            .limit(1)
          expect(res.error?.code, describir(res)).toBe('42501')
        })
      }
    }

    it('contraprueba: las columnas abiertas sí se leen, y cada perfil ve solo lo que la RLS le da (B-19, B-40)', async () => {
      const abiertas =
        'id, assignment_id, kind, recorded_at, source, geo_status, geo_unvalidated_reason, site_distance_m, geofence_radius_m, outside_reason, geo_override_at, time_corrected_at'
      const ver = async (perfil: Perfil) => {
        const res = await tabla(clienteDe(perfil), 'attendance_records')
          .select(abiertas)
          .in('id', [d.fichajeEmp, d.fichajeDual])
        expect(res.error, describir(res)).toBeNull()
        return filas(res)
      }
      // El empleado ve SU fichaje (con su validación y su distancia: B-40 las permite), no el ajeno.
      const empleado = await ver('empleado')
      expect(empleado.map((f) => f.id)).toEqual([d.fichajeEmp])
      expect(empleado[0].geo_status).toBe('outside')
      expect(empleado[0].site_distance_m).toBeGreaterThan(400)
      expect(Object.keys(empleado[0])).not.toContain('latitude')
      // El doble rol (empleado en este turno) ve el suyo y no el del empleado1.
      expect((await ver('dual')).map((f) => f.id)).toEqual([d.fichajeDual])
      // El supervisor del turno ve los dos fichajes, sin las columnas cerradas.
      expect((await ver('supervisor')).map((f) => f.id).sort()).toEqual(
        [d.fichajeEmp, d.fichajeDual].sort(),
      )
      for (const perfil of ES_ADMIN) {
        expect((await ver(perfil)).map((f) => f.id).sort()).toEqual(
          [d.fichajeEmp, d.fichajeDual].sort(),
        )
      }
    })

    for (const perfil of PERFILES) {
      for (const columna of COLUMNAS_CERRADAS) {
        it(`[${ETIQUETA[perfil]}] attendance_records.update(${columna}) -> rechazado y el dato no cambia (B-40, RB-X02)`, async () => {
          const valor =
            columna === 'geo_override_reason'
              ? 'e2e-perm: pisado'
              : columna === 'geo_override_by'
                ? contexto().ids.admin
                : 1
          const res = await tabla(clienteDe(perfil), 'attendance_records')
            .update({ [columna]: valor })
            .eq('id', d.fichajeEmp)
            .select('id')
          const rechazado = !!res.error || filas(res).length === 0
          expect(rechazado, `se pisó: ${describir(res)}`).toBe(true)
          const { data } = await servicio()
            .from('attendance_records')
            .select(
              'latitude, longitude, accuracy_m, geo_override_by, geo_override_reason',
            )
            .eq('id', d.fichajeEmp)
            .single()
          expect(data?.geo_override_by).toBeNull()
          expect(data?.geo_override_reason).toBeNull()
          expect(Number(data?.accuracy_m)).toBe(12)
        })
      }
    }

    for (const perfil of PERFILES) {
      it(`[${ETIQUETA[perfil]}] supervision_attendance.update(geo_status) -> rechazado y el dato no cambia (B-08)`, async () => {
        const res = await tabla(clienteDe(perfil), 'supervision_attendance')
          .update({ geo_status: 'valid' })
          .eq('id', d.fichajeSup)
          .select('id')
        const rechazado = !!res.error || filas(res).length === 0
        expect(rechazado, `se pisó: ${describir(res)}`).toBe(true)
        const { data } = await servicio()
          .from('supervision_attendance')
          .select('geo_status')
          .eq('id', d.fichajeSup)
          .single()
        expect(data?.geo_status).toBe('outside')
      })
    }
  },
)

// ---------------------------------------------------------------------------------------------
// v_presence_today (B-11, B-40)
// ---------------------------------------------------------------------------------------------

describe.skipIf(CERCA_DE_MEDIANOCHE)(
  'v_presence_today: solo dueño y administradores, con la posición del fichaje (B-11, B-40)',
  () => {
    for (const perfil of PERFILES) {
      const admin = ES_ADMIN.includes(perfil)
      it(`[${ETIQUETA[perfil]}] v_presence_today -> ${perfil === 'anon' ? 'denegado' : admin ? 've a los que están trabajando, con posición' : 'cero filas'} (B-40, RB-X02)`, async () => {
        const res = await tabla(clienteDe(perfil), 'v_presence_today').select(
          '*',
        )
        if (perfil === 'anon') {
          expect(res.error?.code, describir(res)).toBe('42501')
          return
        }
        expect(res.error, describir(res)).toBeNull()
        const filasVista = filas(res)
        if (!admin) {
          // Incluye al empleado que fichó y al supervisor de la supervisión: ni a ellos se les muestra.
          expect(
            filasVista,
            'una persona sin rol de administración no ve la presencia',
          ).toEqual([])
          return
        }
        const suyas = filasVista.filter((f) => f.shift_id === d.turnoId)
        // `record_id` de la vista es el de la asignación (empleado) o el de la supervisión.
        const emp = suyas.find((f) => f.record_id === d.asigEmp)
        expect(emp, 'el fichaje del empleado figura').toBeDefined()
        expect(emp?.kind).toBe('employee')
        expect(emp?.geo_status).toBe('outside')
        expect(emp?.latitude, 'administración sí ve la posición').not.toBeNull()
        expect(Number(emp?.accuracy_m)).toBe(12)
        expect(emp?.site_radius_m).toBe(100)
        const dual = suyas.find((f) => f.record_id === d.asigDual)
        expect(dual?.latitude, 'sin ubicación no hay posición').toBeNull()
        expect(dual?.in_progress).toBe(true)
        const sup = suyas.find((f) => f.record_id === d.supervisionId)
        expect(sup?.kind).toBe('supervisor')
        expect(sup?.latitude).not.toBeNull()
        expect(
          filasVista.find((f) => f.kind === 'site' && f.site_id === d.sedeId)
            ?.site_radius_m === 100,
          'la sede con turno hoy figura con su radio vigente (100 m)',
        ).toBe(true)
      })
    }

    it('contraprueba de privacidad: las vistas de administración muestran la precisión solo a administración (B-40)', async () => {
      const campos = 'id, check_in_accuracy_m, check_in_geo_status'
      const supervisor = await tabla(
        clienteDe('supervisor'),
        'v_supervisions_admin',
      )
        .select(campos)
        .eq('id', d.supervisionId)
      expect(supervisor.error, describir(supervisor)).toBeNull()
      expect(filas(supervisor)).toHaveLength(1)
      expect(filas(supervisor)[0].check_in_geo_status).toBe('outside')
      expect(
        filas(supervisor)[0].check_in_accuracy_m,
        'el supervisor no ve la precisión',
      ).toBeNull()
      const admin = await tabla(clienteDe('admin'), 'v_supervisions_admin')
        .select(campos)
        .eq('id', d.supervisionId)
      expect(Number(filas(admin)[0].check_in_accuracy_m)).toBe(15)
    })
  },
)

// ---------------------------------------------------------------------------------------------
// attendance_corrections
// ---------------------------------------------------------------------------------------------

describe.skipIf(CERCA_DE_MEDIANOCHE)(
  'attendance_corrections: solo la leen dueño y administradores; nadie la escribe por API (B-41)',
  () => {
    for (const perfil of PERFILES) {
      it(`[${ETIQUETA[perfil]}] attendance_corrections.insert -> rechazado (B-41, RB-X02)`, async () => {
        const res = await tabla(clienteDe(perfil), 'attendance_corrections')
          .insert({
            attendance_record_id: d.fichajeEmp,
            kind: 'geo',
            reason: 'e2e-perm: insert directo',
            corrected_by: contexto().ids.admin,
          })
          .select('id')
        expect(!!res.error || filas(res).length === 0, describir(res)).toBe(
          true,
        )
        const { count } = await servicio()
          .from('attendance_corrections')
          .select('id', { count: 'exact', head: true })
          .eq('attendance_record_id', d.fichajeEmp)
        expect(count).toBe(0)
      })
    }
  },
)

// ---------------------------------------------------------------------------------------------
// RPC de corrección y lectura
// ---------------------------------------------------------------------------------------------

const AHORA_MENOS = () => `${d.dia}T00:01:00-03:00`

describe.skipIf(CERCA_DE_MEDIANOCHE)(
  'correct_attendance_time: solo dueño y administrador con manage_attendance (B-28)',
  () => {
    const ESPERADO = esperado(['admin', 'owner'], 'OK')
    for (const perfil of PERFILES) {
      if (ESPERADO[perfil] === 'OK') continue
      it(`[${ETIQUETA[perfil]}] correct_attendance_time -> ${ESPERADO[perfil]} y la hora no cambia (B-28, RB-X02)`, async () => {
        const { observado, detalle } = await llamar(
          perfil,
          'correct_attendance_time',
          {
            p_record_id: d.fichajeEmp,
            p_new_time: AHORA_MENOS(),
            p_reason: 'e2e-perm: intento ajeno',
          },
        )
        expect(observado, detalle).toBe(ESPERADO[perfil])
        const { data } = await servicio()
          .from('attendance_records')
          .select('recorded_at, time_corrected_at')
          .eq('id', d.fichajeEmp)
          .single()
        expect(data?.time_corrected_at).toBeNull()
        expect(Date.parse(data!.recorded_at)).toBeGreaterThan(
          Date.parse(AHORA_MENOS()),
        )
        const { count } = await servicio()
          .from('attendance_corrections')
          .select('id', { count: 'exact', head: true })
          .eq('attendance_record_id', d.fichajeEmp)
        expect(count).toBe(0)
      })
    }

    it('[admin con todas] correct_attendance_time: motivo obligatorio, hora futura y hora igual se rechazan sin cambiar nada (B-28)', async () => {
      const sinMotivo = await llamar('admin', 'correct_attendance_time', {
        p_record_id: d.fichajeEmp,
        p_new_time: AHORA_MENOS(),
        p_reason: '   ',
      })
      expect(sinMotivo.observado, sinMotivo.detalle).toBe('REASON_REQUIRED')
      const futura = await llamar('admin', 'correct_attendance_time', {
        p_record_id: d.fichajeEmp,
        p_new_time: new Date(Date.now() + 3_600_000).toISOString(),
        p_reason: 'e2e-perm',
      })
      expect(futura.observado, futura.detalle).toBe('AT_OUT_OF_RANGE')
      const ayer = await llamar('admin', 'correct_attendance_time', {
        p_record_id: d.fichajeEmp,
        p_new_time: new Date(Date.now() - 36 * 3_600_000).toISOString(),
        p_reason: 'e2e-perm',
      })
      expect(ayer.observado, ayer.detalle).toBe('AT_OUT_OF_RANGE')
      const inexistente = await llamar('admin', 'correct_attendance_time', {
        p_record_id: U,
        p_new_time: AHORA_MENOS(),
        p_reason: 'e2e-perm',
      })
      expect(inexistente.observado, inexistente.detalle).toBe(
        'RECORD_NOT_FOUND',
      )
      const { data } = await servicio()
        .from('attendance_records')
        .select('time_corrected_at')
        .eq('id', d.fichajeEmp)
        .single()
      expect(data?.time_corrected_at).toBeNull()
    })

    it('contraprueba [admin con todas] y [dueño]: corrigen la hora, queda el valor anterior, quién y por qué (B-28, B-41)', async () => {
      for (const [perfil, fichaje] of [
        ['admin', d.fichajeEmp],
        ['owner', d.fichajeDual],
      ] as const) {
        const { data: antes } = await servicio()
          .from('attendance_records')
          .select('recorded_at')
          .eq('id', fichaje)
          .single()
        const res = await llamar(perfil, 'correct_attendance_time', {
          p_record_id: fichaje,
          p_new_time: AHORA_MENOS(),
          p_reason: `e2e-perm: corrección de ${perfil}`,
        })
        expect(res.observado, res.detalle).toBe('OK')
        const { data: corr } = await servicio()
          .from('attendance_corrections')
          .select(
            'kind, old_recorded_at, new_recorded_at, reason, corrected_by',
          )
          .eq('attendance_record_id', fichaje)
        expect(corr).toHaveLength(1)
        expect(corr![0].kind).toBe('time')
        expect(Date.parse(corr![0].old_recorded_at!)).toBe(
          Date.parse(antes!.recorded_at),
        )
        expect(Date.parse(corr![0].new_recorded_at!)).toBe(
          Date.parse(AHORA_MENOS()),
        )
        expect(corr![0].corrected_by).toBe(contexto().ids[perfil])
        const { data: despues } = await servicio()
          .from('attendance_records')
          .select('recorded_at, time_corrected_at')
          .eq('id', fichaje)
          .single()
        expect(Date.parse(despues!.recorded_at)).toBe(Date.parse(AHORA_MENOS()))
        expect(despues?.time_corrected_at).not.toBeNull()
      }
    })

    it('las correcciones quedan en attendance_corrections: las leen los tres perfiles administrativos y no las lee nadie más (B-41)', async () => {
      for (const perfil of PERFILES) {
        const res = await tabla(clienteDe(perfil), 'attendance_corrections')
          .select('id, kind')
          .in('attendance_record_id', [d.fichajeEmp, d.fichajeDual])
        if (perfil === 'anon') {
          expect(res.error?.code).toBe('42501')
        } else if (ES_ADMIN.includes(perfil)) {
          expect(res.error, describir(res)).toBeNull()
          expect(filas(res)).toHaveLength(2)
        } else {
          expect(res.error, describir(res)).toBeNull()
          expect(
            filas(res),
            'ni siquiera el empleado ve que su hora se corrigió, en esta tabla',
          ).toEqual([])
        }
      }
    })

    it('el empleado ve «Corregido» (time_corrected_at) pero no el motivo ni el valor anterior (B-28)', async () => {
      const res = await tabla(clienteDe('empleado'), 'attendance_records')
        .select('id, time_corrected_at')
        .eq('id', d.fichajeEmp)
      expect(res.error, describir(res)).toBeNull()
      expect(filas(res)[0].time_corrected_at).not.toBeNull()
      const motivo = await tabla(clienteDe('empleado'), 'attendance_records')
        .select('id, geo_override_reason')
        .eq('id', d.fichajeEmp)
      expect(motivo.error?.code).toBe('42501')
    })
  },
)

describe.skipIf(CERCA_DE_MEDIANOCHE)(
  'override_geo_validation: solo dueño y administrador con manage_attendance (B-09)',
  () => {
    const ESPERADO = esperado(['admin', 'owner'], 'OK')
    for (const tipo of ['attendance', 'supervision'] as const) {
      const fichaje = () =>
        tipo === 'attendance' ? d.fichajeDual : d.fichajeSup
      for (const perfil of PERFILES) {
        if (ESPERADO[perfil] === 'OK') continue
        it(`[${ETIQUETA[perfil]}] override_geo_validation(${tipo}) -> ${ESPERADO[perfil]} y el fichaje no cambia (B-09, RB-X02)`, async () => {
          const { observado, detalle } = await llamar(
            perfil,
            'override_geo_validation',
            {
              p_record_type: tipo,
              p_record_id: fichaje(),
              p_reason: 'e2e-perm: intento ajeno',
            },
          )
          expect(observado, detalle).toBe(ESPERADO[perfil])
          const { data } = await servicio()
            .from(
              tipo === 'attendance'
                ? 'attendance_records'
                : 'supervision_attendance',
            )
            .select('geo_status, geo_override_at')
            .eq('id', fichaje())
            .single()
          expect(data?.geo_override_at).toBeNull()
        })
      }
    }

    it('[admin con todas] se rechazan el tipo inválido, el motivo vacío y el registro inexistente (B-09)', async () => {
      const tipo = await llamar('admin', 'override_geo_validation', {
        p_record_type: 'otro',
        p_record_id: d.fichajeSup,
        p_reason: 'e2e-perm',
      })
      expect(tipo.observado, tipo.detalle).toBe('INVALID_RECORD_TYPE')
      const motivo = await llamar('admin', 'override_geo_validation', {
        p_record_type: 'supervision',
        p_record_id: d.fichajeSup,
        p_reason: '',
      })
      expect(motivo.observado, motivo.detalle).toBe('REASON_REQUIRED')
      const nada = await llamar('admin', 'override_geo_validation', {
        p_record_type: 'attendance',
        p_record_id: U,
        p_reason: 'e2e-perm',
      })
      expect(nada.observado, nada.detalle).toBe('RECORD_NOT_FOUND')
    })

    it('contraprueba: el administrador marca como válido un fichaje sin validar y el dueño uno de supervisión; el original se conserva y no se repite (B-09, B-41)', async () => {
      const a = await llamar('admin', 'override_geo_validation', {
        p_record_type: 'attendance',
        p_record_id: d.fichajeDual,
        p_reason: 'e2e-perm: el GPS no anda en el subsuelo',
      })
      expect(a.observado, a.detalle).toBe('OK')
      const s = await llamar('owner', 'override_geo_validation', {
        p_record_type: 'supervision',
        p_record_id: d.fichajeSup,
        p_reason: 'e2e-perm: visita autorizada',
      })
      expect(s.observado, s.detalle).toBe('OK')
      const { data: att } = await servicio()
        .from('attendance_records')
        .select(
          'geo_status, geo_unvalidated_reason, geo_override_by, geo_override_reason',
        )
        .eq('id', d.fichajeDual)
        .single()
      expect(att?.geo_status, 'el resultado original se conserva').toBe(
        'unvalidated',
      )
      expect(att?.geo_override_by).toBe(contexto().ids.admin)
      expect(att?.geo_override_reason).toBe(
        'e2e-perm: el GPS no anda en el subsuelo',
      )
      const { data: sup } = await servicio()
        .from('supervision_attendance')
        .select('geo_status, geo_override_by')
        .eq('id', d.fichajeSup)
        .single()
      expect(sup?.geo_status).toBe('outside')
      expect(sup?.geo_override_by).toBe(contexto().ids.owner)
      const otra = await llamar('owner', 'override_geo_validation', {
        p_record_type: 'attendance',
        p_record_id: d.fichajeDual,
        p_reason: 'e2e-perm: otra vez',
      })
      expect(otra.observado, otra.detalle).toBe('GEO_ALREADY_OVERRIDDEN')
      // El empleado ve «Validado (corregido)» (geo_override_at) pero no el motivo ni quién fue.
      const propio = await tabla(clienteDe('dual'), 'attendance_records')
        .select('id, geo_status, geo_override_at')
        .eq('id', d.fichajeDual)
      expect(filas(propio)[0].geo_override_at).not.toBeNull()
      const motivo = await tabla(clienteDe('dual'), 'attendance_records')
        .select('id, geo_override_by')
        .eq('id', d.fichajeDual)
      expect(motivo.error?.code).toBe('42501')
    })

    it('un fichaje ya validado no se puede marcar como válido (B-09)', async () => {
      // Un fichaje dentro de la zona de otra persona (empleado3, sin sesión en la matriz): se asigna
      // con la RPC real y el fichaje válido se deja con la clave de servicio, como lo dejaría la RPC.
      const db = servicio()
      const { data: turno } = await db
        .from('shifts')
        .insert({
          client_id: d.clienteId,
          site_id: d.sedeId,
          shift_date: d.dia,
          start_time: '00:00',
          end_time: '23:59',
          required_staff: 1,
        })
        .select('id')
        .single()
      const asignar = await clienteDe('owner').rpc('assign_employee', {
        p_shift_id: turno!.id,
        p_employee_id: contexto().ids.empleado3,
      })
      expect(asignar.error, asignar.error?.message).toBeNull()
      const asigId = (asignar.data as unknown as { assignment: { id: string } })
        .assignment.id
      const { data: fichaje, error } = await db
        .from('attendance_records')
        .insert({
          assignment_id: asigId,
          kind: 'check_in',
          recorded_at: new Date().toISOString(),
          source: 'employee_app',
          latitude: SEDE.lat,
          longitude: SEDE.lng,
          accuracy_m: 10,
          geo_status: 'valid',
          geo_unvalidated_reason: null,
          site_distance_m: 0,
          geofence_radius_m: 100,
        })
        .select('id')
        .single()
      expect(error, error?.message).toBeNull()
      const res = await llamar('admin', 'override_geo_validation', {
        p_record_type: 'attendance',
        p_record_id: fichaje!.id,
        p_reason: 'e2e-perm: no hace falta',
      })
      expect(res.observado, res.detalle).toBe('GEO_ALREADY_VALID')
    })
  },
)

describe.skipIf(CERCA_DE_MEDIANOCHE)(
  'set_geofence_radius y el radio propio de la sede (B-02)',
  () => {
    const ESPERADO = esperado(['adminSin', 'admin', 'owner'], 'OK')
    for (const perfil of PERFILES) {
      it(`[${ETIQUETA[perfil]}] set_geofence_radius(radio vigente) -> ${ESPERADO[perfil]} (B-02, RB-X02)`, async () => {
        const { observado, detalle } = await llamar(
          perfil,
          'set_geofence_radius',
          {
            p_radius: d.radioGeneral,
          },
        )
        expect(observado, detalle).toBe(ESPERADO[perfil])
      })
    }

    for (const perfil of PERFILES) {
      if (ESPERADO[perfil] === 'OK') continue
      it(`[${ETIQUETA[perfil]}] set_geofence_radius(otro valor) -> ${ESPERADO[perfil]} y el radio general no cambia (B-02)`, async () => {
        const otro = d.radioGeneral === 300 ? 301 : 300
        const { observado, detalle } = await llamar(
          perfil,
          'set_geofence_radius',
          {
            p_radius: otro,
          },
        )
        expect(observado, detalle).toBe(ESPERADO[perfil])
        const { data } = await servicio()
          .from('company_settings')
          .select('geofence_radius_m')
          .eq('id', 1)
          .single()
        expect(data?.geofence_radius_m).toBe(d.radioGeneral)
      })
    }

    for (const valor of [49, 1001, 0, -10, null]) {
      it(`[admin con todas] set_geofence_radius(${valor}) -> RADIUS_OUT_OF_RANGE y no cambia nada (B-02)`, async () => {
        const { observado, detalle } = await llamar(
          'admin',
          'set_geofence_radius',
          {
            p_radius: valor,
          },
        )
        expect(observado, detalle).toBe('RADIUS_OUT_OF_RANGE')
        const { data } = await servicio()
          .from('company_settings')
          .select('geofence_radius_m')
          .eq('id', 1)
          .single()
        expect(data?.geofence_radius_m).toBe(d.radioGeneral)
      })
    }

    for (const perfil of PERFILES) {
      const edita = ES_ADMIN.includes(perfil)
      it(`[${ETIQUETA[perfil]}] sites.update(geofence_radius_m) -> ${perfil === 'anon' ? 'denegado' : edita ? 'permitido' : 'cero filas'} (B-02, RB-X02)`, async () => {
        const res = await tabla(clienteDe(perfil), 'sites')
          .update({ geofence_radius_m: 250 })
          .eq('id', d.sedeId)
          .select('id, geofence_radius_m')
        const { data } = await servicio()
          .from('sites')
          .select('geofence_radius_m')
          .eq('id', d.sedeId)
          .single()
        if (edita) {
          expect(res.error, describir(res)).toBeNull()
          expect(filas(res)).toHaveLength(1)
          expect(data?.geofence_radius_m).toBe(250)
          // Se repone para el siguiente perfil.
          await servicio()
            .from('sites')
            .update({ geofence_radius_m: 100 })
            .eq('id', d.sedeId)
        } else {
          expect(!!res.error || filas(res).length === 0, describir(res)).toBe(
            true,
          )
          expect(data?.geofence_radius_m, 'el radio de la sede no cambia').toBe(
            100,
          )
        }
      })
    }

    for (const valor of [49, 1001]) {
      it(`[admin con todas] sites.update(geofence_radius_m = ${valor}) -> error de check (50 a 1000) y no cambia nada (B-02)`, async () => {
        const res = await tabla(clienteDe('admin'), 'sites')
          .update({ geofence_radius_m: valor })
          .eq('id', d.sedeId)
          .select('id')
        expect(res.error?.code, describir(res)).toBe('23514')
        const { data } = await servicio()
          .from('sites')
          .select('geofence_radius_m')
          .eq('id', d.sedeId)
          .single()
        expect(data?.geofence_radius_m).toBe(100)
      })
    }

    it('[admin con todas] sites.update(geofence_radius_m = null) vuelve al radio general y deja rastro del cambio (B-02, security_events)', async () => {
      const res = await tabla(clienteDe('admin'), 'sites')
        .update({ geofence_radius_m: null })
        .eq('id', d.sedeId)
        .select('id, geofence_radius_m')
      expect(res.error, describir(res)).toBeNull()
      expect(filas(res)[0].geofence_radius_m).toBeNull()
      const { data: eventos } = await servicio()
        .from('security_events')
        .select('details, actor_id')
        .eq('event_type', 'geofence_radius_changed')
        .eq('details->>site_id', d.sedeId)
      expect(
        eventos!.length,
        'el cambio de radio de la sede queda en security_events',
      ).toBeGreaterThan(0)
      expect(eventos!.some((e) => e.actor_id === contexto().ids.admin)).toBe(
        true,
      )
      await servicio()
        .from('sites')
        .update({ geofence_radius_m: 100 })
        .eq('id', d.sedeId)
    })
  },
)

describe.skipIf(CERCA_DE_MEDIANOCHE)(
  'get_attendance_location: la posición de un fichaje solo la ve administración (B-40)',
  () => {
    const ESPERADO = esperado(['adminSin', 'admin', 'owner'], 'OK')
    for (const tipo of ['attendance', 'supervision'] as const) {
      const fichaje = () =>
        tipo === 'attendance' ? d.fichajeEmp : d.fichajeSup
      for (const perfil of PERFILES) {
        it(`[${ETIQUETA[perfil]}] get_attendance_location(${tipo}) -> ${ESPERADO[perfil]}${perfil === 'empleado' || perfil === 'supervisor' ? ' (aunque el fichaje sea suyo)' : ''} (B-40, RB-X02)`, async () => {
          const { observado, data, detalle } = await llamar(
            perfil,
            'get_attendance_location',
            {
              p_record_type: tipo,
              p_record_id: fichaje(),
            },
          )
          expect(observado, detalle).toBe(ESPERADO[perfil])
          if (ESPERADO[perfil] === 'OK') {
            const r = data as Record<string, unknown>
            expect(r.record_type).toBe(tipo)
            expect(r.geo_status).toBe('outside')
            expect(
              r.latitude,
              'administración ve la posición guardada',
            ).not.toBeNull()
            expect(Number(r.accuracy_m)).toBe(tipo === 'attendance' ? 12 : 15)
            expect(r.site_radius_m).toBe(100)
            expect(r.site_latitude).toBe(SEDE.lat)
          } else {
            expect(data ?? null).toBeNull()
          }
        })
      }
    }

    it('[admin con todas] tipo inválido o registro inexistente se rechazan (B-40)', async () => {
      const tipo = await llamar('admin', 'get_attendance_location', {
        p_record_type: 'otro',
        p_record_id: d.fichajeEmp,
      })
      expect(tipo.observado, tipo.detalle).toBe('INVALID_RECORD_TYPE')
      const nada = await llamar('admin', 'get_attendance_location', {
        p_record_type: 'supervision',
        p_record_id: U,
      })
      expect(nada.observado, nada.detalle).toBe('RECORD_NOT_FOUND')
    })
  },
)

describe.skipIf(CERCA_DE_MEDIANOCHE)(
  'accept_location_consent y revoke_location_consent: cada persona solo toca su consentimiento (B-22)',
  () => {
    const CON_SESION = PERFILES.filter(
      (p): p is PerfilConSesion => p !== 'anon',
    )

    async function consentimientos(): Promise<Record<string, string | null>> {
      const c = contexto()
      const { data } = await servicio()
        .from('profiles')
        .select('id, location_consent_at')
        .in('id', [
          c.ids.empleado1,
          c.ids.supervisor1,
          c.ids.dual,
          c.ids.adminSin,
          c.ids.admin,
          c.ids.owner,
        ])
      return Object.fromEntries(
        (data ?? []).map((p) => [p.id, p.location_consent_at]),
      )
    }

    it('[anon] accept_location_consent y revoke_location_consent -> 42501 (B-22, RB-X02)', async () => {
      for (const rpc of [
        'accept_location_consent',
        'revoke_location_consent',
      ]) {
        const r = await llamar('anon', rpc, {})
        expect(r.observado, r.detalle).toBe('42501')
      }
    })

    it('[service_role] sin sesión no hay a quién tocar: FORBIDDEN, y ningún consentimiento cambia (B-22)', async () => {
      const antes = await consentimientos()
      for (const rpc of [
        'accept_location_consent',
        'revoke_location_consent',
      ]) {
        const { error } = await servicio().rpc(rpc as 'accept_location_consent')
        expect(error?.hint ?? error?.code, error?.message).toBe('FORBIDDEN')
      }
      expect(await consentimientos()).toEqual(antes)
    })

    for (const perfil of CON_SESION) {
      it(`[${ETIQUETA[perfil]}] accept_location_consent fecha el suyo con la hora del servidor y no toca el de los demás; revoke_location_consent lo deja en null (B-22)`, async () => {
        const c = contexto()
        const miId =
          c.ids[
            perfil === 'empleado'
              ? 'empleado1'
              : perfil === 'supervisor'
                ? 'supervisor1'
                : perfil
          ]
        const antes = await consentimientos()
        const antesDeLlamar = Date.now()
        const acepto = await llamar(perfil, 'accept_location_consent', {})
        expect(acepto.observado, acepto.detalle).toBe('OK')
        const instante = Date.parse(acepto.data as string)
        expect(instante).toBeGreaterThan(antesDeLlamar - 60_000)
        expect(instante).toBeLessThan(Date.now() + 60_000)
        const medio = await consentimientos()
        expect(Date.parse(medio[miId]!)).toBe(instante)
        for (const [id, valor] of Object.entries(antes)) {
          if (id !== miId)
            expect(medio[id], 'el consentimiento ajeno no cambia').toBe(valor)
        }
        const retiro = await llamar(perfil, 'revoke_location_consent', {})
        expect(retiro.observado, retiro.detalle).toBe('OK')
        const despues = await consentimientos()
        expect(despues[miId]).toBeNull()
        for (const [id, valor] of Object.entries(antes)) {
          if (id !== miId)
            expect(despues[id], 'el consentimiento ajeno no cambia').toBe(valor)
        }
      })
    }

    it('la RPC no recibe de quién es el consentimiento: no hay forma de tocar el de otra persona (B-22)', async () => {
      const antes = await consentimientos()
      const { error } = await clienteDe('empleado').rpc(
        'accept_location_consent',
        {
          p_profile_id: contexto().ids.admin,
        } as never,
      )
      expect(error, 'la firma no admite argumentos').not.toBeNull()
      expect(await consentimientos()).toEqual(antes)
    })
  },
)

describe.skipIf(CERCA_DE_MEDIANOCHE)(
  'client_service_summary: solo administración, con la validación y sin coordenadas (B-20)',
  () => {
    const ESPERADO = esperado(['adminSin', 'admin', 'owner'], 'OK')
    for (const perfil of PERFILES) {
      it(`[${ETIQUETA[perfil]}] client_service_summary -> ${ESPERADO[perfil]} (B-20, RB-X02)`, async () => {
        const { observado, detalle } = await llamar(
          perfil,
          'client_service_summary',
          {
            p_client_id: d.clienteId,
            p_from: d.dia,
            p_to: d.dia,
          },
        )
        expect(observado, detalle).toBe(ESPERADO[perfil])
      })
    }

    it('devuelve el estado de cada fichaje y nunca latitud, longitud ni precisión (B-20, B-40)', async () => {
      // El turno de hoy todavía no terminó: se cierra el fin del empleado y del doble rol con la
      // clave de servicio para que cuente como «realizado» en el resumen.
      const db = servicio()
      for (const [asig, lat] of [
        [d.asigEmp, true],
        [d.asigDual, false],
      ] as const) {
        await db.from('attendance_records').insert({
          assignment_id: asig,
          kind: 'check_out',
          recorded_at: new Date().toISOString(),
          source: 'employee_app',
          latitude: lat ? AFUERA.lat : null,
          longitude: lat ? AFUERA.lng : null,
          accuracy_m: lat ? 12 : null,
          geo_status: lat ? 'outside' : 'unvalidated',
          geo_unvalidated_reason: lat ? null : 'no_location',
          site_distance_m: lat ? 450 : null,
          geofence_radius_m: 100,
        })
      }
      await db
        .from('shifts')
        .update({ status: 'completed' })
        .eq('id', d.turnoId)
      const { observado, data, detalle } = await llamar(
        'admin',
        'client_service_summary',
        {
          p_client_id: d.clienteId,
          p_from: d.dia,
          p_to: d.dia,
        },
      )
      expect(observado, detalle).toBe('OK')
      const texto = JSON.stringify(data)
      expect(texto).toContain('check_in_geo_status')
      expect(texto).toContain('"outside"')
      expect(texto).toContain('check_out_geo_status')
      for (const clave of [
        'latitude',
        'longitude',
        'accuracy',
        'geo_override_reason',
        'outside_reason',
      ]) {
        expect(texto, `el resumen no debe traer «${clave}»`).not.toContain(
          clave,
        )
      }
      expect(texto).not.toContain(String(AFUERA.lng).slice(0, 8))
    })
  },
)
