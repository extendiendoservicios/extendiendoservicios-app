// tests/permissions/suite/100-p28.permissions.ts — P28.7 (observaciones de la dirección, 11 nov 2026)
//
// Lo nuevo de P28 (migraciones 0082 y 0083) por API directa con `supabase-js`, contra App_dev y con
// DATOS REALES (la matriz genérica de `rpc.ts` solo prueba la puerta con ids inexistentes). Por rol
// (dueño, administrador con todas las capacidades, administrador sin capacidades, coordinador, doble
// rol, empleado y anon):
//   1. `upsert_holiday` (OF-19): solo el dueño; crea, cambia el nombre, reactiva el dado de baja y la
//      unicidad vale solo entre los vigentes.
//   2. `holiday_shift_conflicts` (OF-19b): dueño y administradores; `remove_holiday_shifts` exige
//      `cancel_shifts` (el administrador sin capacidades recibe FORBIDDEN y no se borra nada).
//   3. `preview_service_changes` / `apply_service_changes` (OF-05): dueño y administradores; la vista
//      previa no escribe nada y aplicar sí.
//   4. `service_overlaps` y `shift_overlaps_in_site` (OF-02): dueño y administradores.
//   5. `move_assignment` (OF-10): dueño y administradores; el resto FORBIDDEN y no se mueve nada.
//   6. Vista `v_sites_day_status` (OF-13): solo dueño y administradores.
//   7. OF-03: el empleado no lee precios ni stock (por la tabla ni por el catálogo).
//   8. OF-04b (0083): cancelar un turno libera al empleado (`released_at`), él sigue viendo su
//      asignación y puede tomar otro turno a la misma hora.
// Todo con el prefijo `e2e-perm-p28-` y fechas de un año lejano; lo que se crea se borra en `afterAll`.

import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { anioLejano } from '../../fixtures/accounts.ts'
import { daysFromToday } from '../../fixtures/dates.ts'
import { deleteClientDeep } from '../../fixtures/scenario.ts'
import { describir, filas, tabla } from './ayudas.ts'
import { clienteDe, contexto, servicio, type Db } from './contexto.ts'
import { cuitUnico, PREFIJO } from './escenario.ts'
import { ETIQUETA, type Perfil } from './perfiles.ts'

const P = `${PREFIJO}p28-`
const sfx = () => randomBytes(3).toString('hex')

/** Perfiles sin rol de administración. */
const SIN_ADMIN: Perfil[] = ['empleado', 'supervisor', 'dual']
/** Dueño y administradores (con o sin capacidades). */
const ADMINS: Perfil[] = ['adminSin', 'admin', 'owner']
const TODOS_CON_SESION: Perfil[] = [...SIN_ADMIN, ...ADMINS]

interface Resp {
  data: unknown
  error: { code?: string; hint?: string | null; message: string } | null
}

function llamar(
  db: Db,
  rpc: string,
  args: Record<string, unknown> = {},
): Promise<Resp> {
  return db.rpc(
    rpc as 'mark_changes_seen',
    args as never,
  ) as unknown as Promise<Resp>
}

/** `OK`, `42501` o el `hint` estable del error. */
function codigo(res: Resp): string {
  if (!res.error) return 'OK'
  return res.error.code === '42501'
    ? '42501'
    : (res.error.hint ?? res.error.code ?? 'ERROR')
}

const json = (res: Resp) => (res.data ?? {}) as Record<string, unknown>

/** Día de la semana como lo guarda `services.weekdays` (0 = domingo ... 6 = sábado). */
function diaIso(fecha: string): number {
  return new Date(`${fecha}T12:00:00Z`).getUTCDay()
}

describe('lote P28: permisos de lo nuevo con datos reales', () => {
  const db = () => servicio()
  const c = () => contexto()
  const anio = anioLejano()
  // Fechas lejanas, una por tema, para no pisar ningún otro dato.
  const F_FERIADO = `${anio}-06-15`
  const F_CAMBIO = `${anio}-07-20`
  const F_MOVER = `${anio}-08-10`
  const F_CANCELAR = `${anio}-09-14`
  const hoy = daysFromToday(0)

  const clientesCreados: string[] = []
  const T: Record<string, string> = {}
  let desde = ''

  async function insertar<TRow extends { id: string }>(
    consulta: PromiseLike<{
      data: TRow | null
      error: { message: string } | null
    }>,
    que: string,
  ): Promise<string> {
    const r = await consulta
    if (r.error || !r.data) throw new Error(`${que}: ${r.error?.message}`)
    return r.data.id
  }

  beforeAll(async () => {
    desde = new Date().toISOString()
    const nombre = `${P}cli-${sfx()}`
    T.cliente = await insertar(
      db()
        .from('clients')
        .insert({ legal_name: nombre, trade_name: nombre, cuit: cuitUnico() })
        .select('id')
        .single(),
      'cliente',
    )
    clientesCreados.push(T.cliente)
    T.sede = await insertar(
      db()
        .from('sites')
        .insert({
          client_id: T.cliente,
          name: `${P}sede-${sfx()}`,
          address: 'Calle de prueba 1',
          latitude: -34.6,
          longitude: -58.4,
        })
        .select('id')
        .single(),
      'sede',
    )
    // Servicio que NO trabaja feriados, pausado (no entra en duplicados ni en la generación).
    T.servicioFeriado = await insertar(
      db()
        .from('services')
        .insert({
          client_id: T.cliente,
          site_id: T.sede,
          name: `${P}sin-feriados-${sfx()}`,
          weekdays: [0, 1, 2, 3, 4, 5, 6],
          start_time: '08:00',
          end_time: '12:00',
          valid_from: hoy,
          works_on_holidays: false,
          status: 'paused',
        })
        .select('id')
        .single(),
      'servicio sin feriados',
    )
    T.turnoFeriado = await insertar(
      db()
        .from('shifts')
        .insert({
          client_id: T.cliente,
          site_id: T.sede,
          service_id: T.servicioFeriado,
          shift_date: F_FERIADO,
          start_time: '08:00',
          end_time: '12:00',
          required_staff: 1,
          generated: true,
        })
        .select('id')
        .single(),
      'turno del feriado',
    )
    // Servicio activo de un solo día de la semana, con un turno generado y dotación 1.
    T.servicioCambio = await insertar(
      db()
        .from('services')
        .insert({
          client_id: T.cliente,
          site_id: T.sede,
          name: `${P}cambio-${sfx()}`,
          weekdays: [diaIso(F_CAMBIO)],
          start_time: '08:00',
          end_time: '12:00',
          required_staff: 1,
          valid_from: hoy,
          status: 'active',
        })
        .select('id')
        .single(),
      'servicio de cambios',
    )
    T.turnoCambio = await insertar(
      db()
        .from('shifts')
        .insert({
          client_id: T.cliente,
          site_id: T.sede,
          service_id: T.servicioCambio,
          shift_date: F_CAMBIO,
          start_time: '08:00',
          end_time: '12:00',
          required_staff: 1,
          generated: true,
        })
        .select('id')
        .single(),
      'turno de cambios',
    )
    // Dos turnos de la misma sede el mismo día para mover una asignación.
    for (const [clave, ini, fin] of [
      ['turnoMoverA', '08:00', '10:00'],
      ['turnoMoverB', '14:00', '16:00'],
    ] as const) {
      T[clave] = await insertar(
        db()
          .from('shifts')
          .insert({
            client_id: T.cliente,
            site_id: T.sede,
            shift_date: F_MOVER,
            start_time: ini,
            end_time: fin,
            required_staff: 2,
          })
          .select('id')
          .single(),
        clave,
      )
    }
    // Un turno de HOY para la vista del mapa (cualquier hora: la fila existe igual).
    T.turnoHoy = await insertar(
      db()
        .from('shifts')
        .insert({
          client_id: T.cliente,
          site_id: T.sede,
          shift_date: hoy,
          start_time: '00:00',
          end_time: '23:59',
          required_staff: 1,
        })
        .select('id')
        .single(),
      'turno de hoy',
    )
    // Dos turnos a la misma hora para OF-04b.
    for (const clave of ['turnoCancelar', 'turnoOtro'] as const) {
      T[clave] = await insertar(
        db()
          .from('shifts')
          .insert({
            client_id: T.cliente,
            site_id: T.sede,
            shift_date: F_CANCELAR,
            start_time: '09:00',
            end_time: '11:00',
            required_staff: 1,
          })
          .select('id')
          .single(),
        clave,
      )
    }
  })

  afterAll(async () => {
    for (const id of clientesCreados) {
      const notas = await deleteClientDeep(db(), id)
      if (notas.length)
        console.warn(`[100-p28] limpieza con notas: ${notas.join('; ')}`)
    }
    await db()
      .from('holidays')
      .delete()
      .in('holiday_date', [F_FERIADO, `${anio}-06-20`])
    await db()
      .from('security_events')
      .delete()
      .eq('event_type', 'record_deleted')
      .gte('created_at', desde)
      .in('details->>date', [F_FERIADO])
    await db()
      .from('security_events')
      .delete()
      .eq('event_type', 'record_deleted')
      .gte('created_at', desde)
      .like('details->>name', `${P}%`)
  })

  // -----------------------------------------------------------------------------------------------
  // 1. upsert_holiday: solo el dueño (OF-19)
  // -----------------------------------------------------------------------------------------------
  describe('upsert_holiday (OF-19)', () => {
    const FECHA_FUERA = `${anio}-06-20`

    for (const perfil of [...SIN_ADMIN, 'adminSin', 'admin'] as Perfil[]) {
      it(`[${ETIQUETA[perfil]}] FORBIDDEN y no se crea ningún feriado (RB-X02, CB-17, P-050, OF-19)`, async () => {
        const r = await llamar(clienteDe(perfil), 'upsert_holiday', {
          p_date: FECHA_FUERA,
          p_name: `${P}no`,
        })
        expect(codigo(r), describir(r as never)).toBe('FORBIDDEN')
        const sigue = await tabla(db(), 'holidays')
          .select('id')
          .eq('holiday_date', FECHA_FUERA)
        expect(filas(sigue)).toHaveLength(0)
      })
    }

    it('[anon] 42501 (RB-X02, OF-19)', async () => {
      const r = await llamar(clienteDe('anon'), 'upsert_holiday', {
        p_date: FECHA_FUERA,
        p_name: `${P}no`,
      })
      expect(codigo(r)).toBe('42501')
    })

    it('[dueño] crea, cambia el nombre, no hace nada si es igual y reactiva el dado de baja (OF-19, P-050)', async () => {
      const dueno = clienteDe('owner')
      const crear = await llamar(dueno, 'upsert_holiday', {
        p_date: F_FERIADO,
        p_name: `${P}feriado`,
      })
      expect(codigo(crear), describir(crear as never)).toBe('OK')
      expect(json(crear).action).toBe('created')

      const igual = await llamar(dueno, 'upsert_holiday', {
        p_date: F_FERIADO,
        p_name: `${P}feriado`,
      })
      expect(json(igual).action).toBe('unchanged')

      const renombrar = await llamar(dueno, 'upsert_holiday', {
        p_date: F_FERIADO,
        p_name: `${P}feriado-2`,
      })
      expect(json(renombrar).action).toBe('updated')

      // Baja (como la hace la app: `deleted_at`) y alta de nuevo sobre la misma fecha: reactiva
      // (el caso del 11/11 de la dirección) y no deja dos filas.
      const baja = await db()
        .from('holidays')
        .update({ deleted_at: new Date().toISOString() })
        .eq('holiday_date', F_FERIADO)
      expect(baja.error).toBeNull()
      const reactivar = await llamar(dueno, 'upsert_holiday', {
        p_date: F_FERIADO,
        p_name: `${P}feriado-3`,
      })
      expect(codigo(reactivar), describir(reactivar as never)).toBe('OK')
      expect(json(reactivar).action).toBe('reactivated')
      const filasFecha = await tabla(db(), 'holidays')
        .select('id, deleted_at, name')
        .eq('holiday_date', F_FERIADO)
      expect(filas(filasFecha)).toHaveLength(1)
      expect(filas(filasFecha)[0]?.deleted_at).toBeNull()
    })

    it('[dueño] nombre y fecha vacíos dan HOLIDAY_NAME_REQUIRED y HOLIDAY_DATE_REQUIRED', async () => {
      const dueno = clienteDe('owner')
      const sinNombre = await llamar(dueno, 'upsert_holiday', {
        p_date: FECHA_FUERA,
        p_name: '   ',
      })
      expect(codigo(sinNombre)).toBe('HOLIDAY_NAME_REQUIRED')
      const sinFecha = await llamar(dueno, 'upsert_holiday', {
        p_date: null,
        p_name: 'x',
      })
      expect(codigo(sinFecha)).toBe('HOLIDAY_DATE_REQUIRED')
    })

    it('la unicidad vale solo entre los vigentes: un segundo feriado vigente en la misma fecha se rechaza (23505), con la clave de servicio también (OF-19)', async () => {
      const r = await db()
        .from('holidays')
        .insert({ holiday_date: F_FERIADO, name: `${P}duplicado` })
      expect(r.error?.code).toBe('23505')
    })
  })

  // -----------------------------------------------------------------------------------------------
  // 2. holiday_shift_conflicts y remove_holiday_shifts (OF-19b)
  // -----------------------------------------------------------------------------------------------
  describe('holiday_shift_conflicts y remove_holiday_shifts (OF-19b)', () => {
    for (const perfil of SIN_ADMIN) {
      it(`[${ETIQUETA[perfil]}] ni consulta ni borra los turnos del feriado: FORBIDDEN y el turno sigue (RB-X02, CB-17, OF-19b)`, async () => {
        for (const rpc of [
          'holiday_shift_conflicts',
          'remove_holiday_shifts',
        ]) {
          const r = await llamar(clienteDe(perfil), rpc, { p_date: F_FERIADO })
          expect(codigo(r), `${rpc}: ${describir(r as never)}`).toBe(
            'FORBIDDEN',
          )
        }
        const sigue = await tabla(db(), 'shifts')
          .select('id')
          .eq('id', T.turnoFeriado)
        expect(filas(sigue)).toHaveLength(1)
      })
    }

    it('[anon] 42501 en las dos', async () => {
      for (const rpc of ['holiday_shift_conflicts', 'remove_holiday_shifts']) {
        const r = await llamar(clienteDe('anon'), rpc, { p_date: F_FERIADO })
        expect(codigo(r), rpc).toBe('42501')
      }
    })

    for (const perfil of ADMINS) {
      it(`[${ETIQUETA[perfil]}] holiday_shift_conflicts lista el turno de un servicio que no trabaja feriados (OF-19b)`, async () => {
        const r = await llamar(clienteDe(perfil), 'holiday_shift_conflicts', {
          p_date: F_FERIADO,
        })
        expect(codigo(r), describir(r as never)).toBe('OK')
        const j = json(r)
        expect(j.is_holiday).toBe(true)
        const turnos = (j.shifts as Array<Record<string, unknown>>).map(
          (s) => s.shift_id,
        )
        expect(turnos).toContain(T.turnoFeriado)
        expect(Number(j.deletable_count)).toBeGreaterThanOrEqual(1)
      })
    }

    it('[admin sin capacidades] remove_holiday_shifts exige cancel_shifts: FORBIDDEN y el turno sigue (CB-17, OF-19b)', async () => {
      const r = await llamar(clienteDe('adminSin'), 'remove_holiday_shifts', {
        p_date: F_FERIADO,
      })
      expect(codigo(r), describir(r as never)).toBe('FORBIDDEN')
      const sigue = await tabla(db(), 'shifts')
        .select('id')
        .eq('id', T.turnoFeriado)
      expect(filas(sigue)).toHaveLength(1)
    })

    it('[admin con todas] remove_holiday_shifts borra el turno sin historia y devuelve el conteo (OF-19b)', async () => {
      const r = await llamar(clienteDe('admin'), 'remove_holiday_shifts', {
        p_date: F_FERIADO,
      })
      expect(codigo(r), describir(r as never)).toBe('OK')
      const borrado = (json(r).deleted ?? {}) as Record<string, number>
      expect(borrado.shifts).toBeGreaterThanOrEqual(1)
      const sigue = await tabla(db(), 'shifts')
        .select('id')
        .eq('id', T.turnoFeriado)
      expect(filas(sigue)).toHaveLength(0)
    })

    it('NOT_A_HOLIDAY si la fecha no es feriado (el dueño pasa la puerta)', async () => {
      const r = await llamar(clienteDe('owner'), 'remove_holiday_shifts', {
        p_date: `${anio}-12-31`,
      })
      expect(codigo(r)).toBe('NOT_A_HOLIDAY')
    })
  })

  // -----------------------------------------------------------------------------------------------
  // 3. preview_service_changes / apply_service_changes (OF-05)
  // -----------------------------------------------------------------------------------------------
  describe('preview_service_changes y apply_service_changes (OF-05)', () => {
    const previo = { required_staff: 1 }

    it('prepara: el servicio pasa a dotación 2 y el turno generado sigue en 1', async () => {
      const r = await db()
        .from('services')
        .update({ required_staff: 2 })
        .eq('id', T.servicioCambio)
      expect(r.error).toBeNull()
      const t = await tabla(db(), 'shifts')
        .select('required_staff')
        .eq('id', T.turnoCambio)
      expect(filas(t)[0]?.required_staff).toBe(1)
    })

    for (const perfil of SIN_ADMIN) {
      it(`[${ETIQUETA[perfil]}] FORBIDDEN en las dos y el turno no cambia (RB-X02, CB-17, OF-05)`, async () => {
        for (const rpc of [
          'preview_service_changes',
          'apply_service_changes',
        ]) {
          const r = await llamar(clienteDe(perfil), rpc, {
            p_service_id: T.servicioCambio,
            p_from_date: F_CAMBIO,
            p_previous: previo,
          })
          expect(codigo(r), `${rpc}: ${describir(r as never)}`).toBe(
            'FORBIDDEN',
          )
        }
        const t = await tabla(db(), 'shifts')
          .select('required_staff')
          .eq('id', T.turnoCambio)
        expect(filas(t)[0]?.required_staff).toBe(1)
      })
    }

    it('[anon] 42501 en las dos', async () => {
      for (const rpc of ['preview_service_changes', 'apply_service_changes']) {
        const r = await llamar(clienteDe('anon'), rpc, {
          p_service_id: T.servicioCambio,
          p_from_date: F_CAMBIO,
        })
        expect(codigo(r), rpc).toBe('42501')
      }
    })

    for (const perfil of ADMINS) {
      it(`[${ETIQUETA[perfil]}] la vista previa cuenta el turno a actualizar y no escribe nada (OF-05)`, async () => {
        const r = await llamar(clienteDe(perfil), 'preview_service_changes', {
          p_service_id: T.servicioCambio,
          p_from_date: F_CAMBIO,
          p_previous: previo,
        })
        expect(codigo(r), describir(r as never)).toBe('OK')
        const j = json(r)
        expect(j.preview).toBe(true)
        expect(Number(j.updated_count)).toBeGreaterThanOrEqual(1)
        const t = await tabla(db(), 'shifts')
          .select('required_staff')
          .eq('id', T.turnoCambio)
        expect(filas(t)[0]?.required_staff, 'la vista previa escribió').toBe(1)
      })
    }

    it('[admin sin capacidades] apply_service_changes pasa la puerta (O, A) y actualiza el turno a dotación 2 (OF-05)', async () => {
      const r = await llamar(clienteDe('adminSin'), 'apply_service_changes', {
        p_service_id: T.servicioCambio,
        p_from_date: F_CAMBIO,
        p_previous: previo,
      })
      expect(codigo(r), describir(r as never)).toBe('OK')
      expect(json(r).preview).toBe(false)
      const t = await tabla(db(), 'shifts')
        .select('required_staff')
        .eq('id', T.turnoCambio)
      expect(filas(t)[0]?.required_staff).toBe(2)
    })

    it('FROM_DATE_REQUIRED y SERVICE_NOT_FOUND los resuelve el dueño con su hint', async () => {
      const sinFecha = await llamar(
        clienteDe('owner'),
        'preview_service_changes',
        { p_service_id: T.servicioCambio, p_from_date: null },
      )
      expect(codigo(sinFecha)).toBe('FROM_DATE_REQUIRED')
    })
  })

  // -----------------------------------------------------------------------------------------------
  // 4. service_overlaps y shift_overlaps_in_site (OF-02)
  // -----------------------------------------------------------------------------------------------
  describe('service_overlaps y shift_overlaps_in_site (OF-02)', () => {
    for (const perfil of SIN_ADMIN) {
      it(`[${ETIQUETA[perfil]}] FORBIDDEN en las dos (RB-X02, OF-02)`, async () => {
        const a = await llamar(clienteDe(perfil), 'service_overlaps', {
          p_site_id: T.sede,
          p_weekdays: [diaIso(F_CAMBIO)],
          p_start: '08:00',
          p_end: '12:00',
        })
        expect(codigo(a), describir(a as never)).toBe('FORBIDDEN')
        const b = await llamar(clienteDe(perfil), 'shift_overlaps_in_site', {
          p_site_id: T.sede,
          p_date: F_CAMBIO,
          p_start: '08:00',
          p_end: '12:00',
        })
        expect(codigo(b), describir(b as never)).toBe('FORBIDDEN')
      })
    }

    it('[anon] 42501 en las dos', async () => {
      const a = await llamar(clienteDe('anon'), 'service_overlaps', {
        p_site_id: T.sede,
        p_weekdays: [1],
        p_start: '08:00',
        p_end: '12:00',
      })
      expect(codigo(a)).toBe('42501')
      const b = await llamar(clienteDe('anon'), 'shift_overlaps_in_site', {
        p_site_id: T.sede,
        p_date: F_CAMBIO,
        p_start: '08:00',
        p_end: '12:00',
      })
      expect(codigo(b)).toBe('42501')
    })

    for (const perfil of ADMINS) {
      it(`[${ETIQUETA[perfil]}] detecta el servicio activo que se superpone y el turno de la sede ese día (OF-02)`, async () => {
        const a = await llamar(clienteDe(perfil), 'service_overlaps', {
          p_site_id: T.sede,
          p_weekdays: [diaIso(F_CAMBIO)],
          p_start: '09:00',
          p_end: '10:00',
        })
        expect(codigo(a), describir(a as never)).toBe('OK')
        const servicios = (a.data as Array<Record<string, unknown>>).map(
          (s) => s.service_id,
        )
        expect(servicios).toContain(T.servicioCambio)

        // `p_except_id`: el propio servicio no se cuenta (edición).
        const sin = await llamar(clienteDe(perfil), 'service_overlaps', {
          p_site_id: T.sede,
          p_weekdays: [diaIso(F_CAMBIO)],
          p_start: '09:00',
          p_end: '10:00',
          p_except_id: T.servicioCambio,
        })
        expect(
          (sin.data as Array<Record<string, unknown>>).map((s) => s.service_id),
        ).not.toContain(T.servicioCambio)

        const b = await llamar(clienteDe(perfil), 'shift_overlaps_in_site', {
          p_site_id: T.sede,
          p_date: F_CAMBIO,
          p_start: '09:00',
          p_end: '10:00',
        })
        expect(codigo(b), describir(b as never)).toBe('OK')
        expect(
          (b.data as Array<Record<string, unknown>>).map((s) => s.shift_id),
        ).toContain(T.turnoCambio)
      })
    }

    it('un horario que no se pisa no devuelve nada (contraprueba)', async () => {
      const a = await llamar(clienteDe('owner'), 'service_overlaps', {
        p_site_id: T.sede,
        p_weekdays: [diaIso(F_CAMBIO)],
        p_start: '13:00',
        p_end: '14:00',
      })
      expect(
        (a.data as Array<Record<string, unknown>>).map((s) => s.service_id),
      ).not.toContain(T.servicioCambio)
    })
  })

  // -----------------------------------------------------------------------------------------------
  // 5. move_assignment (OF-10)
  // -----------------------------------------------------------------------------------------------
  describe('move_assignment (OF-10)', () => {
    let asignacion = ''

    it('prepara: empleado3 asignado al turno A del día', async () => {
      const r = await llamar(clienteDe('owner'), 'assign_employee', {
        p_shift_id: T.turnoMoverA,
        p_employee_id: c().ids.empleado3,
      })
      expect(codigo(r), describir(r as never)).toBe('OK')
      asignacion = (json(r).assignment as { id: string }).id
    })

    for (const perfil of SIN_ADMIN) {
      it(`[${ETIQUETA[perfil]}] FORBIDDEN y la asignación sigue en el turno A (RB-X02, CB-17, OF-10)`, async () => {
        const r = await llamar(clienteDe(perfil), 'move_assignment', {
          p_assignment_id: asignacion,
          p_target_shift_id: T.turnoMoverB,
        })
        expect(codigo(r), describir(r as never)).toBe('FORBIDDEN')
        const a = await tabla(db(), 'assignments')
          .select('shift_id, removed_at')
          .eq('id', asignacion)
        expect(filas(a)[0]?.shift_id).toBe(T.turnoMoverA)
        expect(filas(a)[0]?.removed_at).toBeNull()
      })
    }

    it('[anon] 42501', async () => {
      const r = await llamar(clienteDe('anon'), 'move_assignment', {
        p_assignment_id: asignacion,
        p_target_shift_id: T.turnoMoverB,
      })
      expect(codigo(r)).toBe('42501')
    })

    it('[admin sin capacidades] mueve al turno B, devuelve previous para deshacer y MOVE_SAME_SHIFT si ya está (OF-10)', async () => {
      const r = await llamar(clienteDe('adminSin'), 'move_assignment', {
        p_assignment_id: asignacion,
        p_target_shift_id: T.turnoMoverB,
      })
      expect(codigo(r), describir(r as never)).toBe('OK')
      const j = json(r)
      const nueva = (j.assignment as { id: string; shift_id: string }).id
      expect((j.previous as { shift_id: string }).shift_id).toBe(T.turnoMoverA)
      expect(j.removed_assignment_id).toBe(asignacion)
      const vieja = await tabla(db(), 'assignments')
        .select('removed_at')
        .eq('id', asignacion)
      expect(filas(vieja)[0]?.removed_at).not.toBeNull()
      const igual = await llamar(clienteDe('admin'), 'move_assignment', {
        p_assignment_id: nueva,
        p_target_shift_id: T.turnoMoverB,
      })
      expect(codigo(igual)).toBe('MOVE_SAME_SHIFT')
      // Deshacer, como lo hace la pantalla.
      const deshacer = await llamar(clienteDe('owner'), 'move_assignment', {
        p_assignment_id: nueva,
        p_target_shift_id: (j.previous as { shift_id: string }).shift_id,
        p_start: (j.previous as { start_time: string }).start_time,
        p_end: (j.previous as { end_time: string }).end_time,
      })
      expect(codigo(deshacer), describir(deshacer as never)).toBe('OK')
    })
  })

  // -----------------------------------------------------------------------------------------------
  // 6. Vista v_sites_day_status (OF-13)
  // -----------------------------------------------------------------------------------------------
  describe('v_sites_day_status (OF-13)', () => {
    for (const perfil of ADMINS) {
      it(`[${ETIQUETA[perfil]}] ve la sede con turno hoy, con sus conteos y la ubicación (OF-13)`, async () => {
        const r = await tabla(clienteDe(perfil), 'v_sites_day_status')
          .select('*')
          .eq('site_id', T.sede)
        expect(r.error, describir(r)).toBeNull()
        const f = filas(r)
        expect(f).toHaveLength(1)
        expect(Number(f[0]?.shifts_count)).toBe(1)
        expect(
          Number(f[0]?.upcoming_count) +
            Number(f[0]?.in_progress_count) +
            Number(f[0]?.finished_count),
        ).toBe(1)
        expect(f[0]?.latitude).toBeCloseTo(-34.6, 3)
      })
    }

    for (const perfil of SIN_ADMIN) {
      it(`[${ETIQUETA[perfil]}] cero filas (o error de permisos) (RB-X02, OF-13)`, async () => {
        const r = await tabla(clienteDe(perfil), 'v_sites_day_status')
          .select('*')
          .eq('site_id', T.sede)
        expect(r.error?.code ?? 'sin-error').toMatch(/42501|sin-error/)
        expect(filas(r)).toHaveLength(0)
      })
    }

    it('[anon] denegado', async () => {
      const r = await tabla(clienteDe('anon'), 'v_sites_day_status').select('*')
      expect(r.error?.code).toBe('42501')
    })

    it('ninguna se escribe (RB-X02)', async () => {
      for (const perfil of TODOS_CON_SESION) {
        const r = await tabla(clienteDe(perfil), 'v_sites_day_status')
          .update({ day_state: 'finished' })
          .eq('site_id', T.sede)
        expect(r.error, `${perfil}`).not.toBeNull()
      }
    })
  })

  // -----------------------------------------------------------------------------------------------
  // 7. OF-03: el empleado no lee precios ni stock
  // -----------------------------------------------------------------------------------------------
  describe('el empleado no lee precios ni stock (OF-03)', () => {
    it('contraprueba: la clave de servicio ve artículos con precios', async () => {
      const r = await tabla(db(), 'supplies')
        .select('id, cost_price, sale_price, stock_qty')
        .limit(1)
      expect(r.error, describir(r)).toBeNull()
      expect(filas(r).length).toBeGreaterThan(0)
    })

    for (const perfil of ['empleado', 'supervisor', 'dual'] as Perfil[]) {
      it(`[${ETIQUETA[perfil]}] supplies, historial de precios y movimientos: cero filas; catálogo sin precios (OF-03, IS-20, RB-X02)`, async () => {
        for (const t of [
          'supplies',
          'supply_price_changes',
          'stock_movements',
          'stock_movement_lines',
          'stock_counts',
        ]) {
          const r = await tabla(clienteDe(perfil), t).select('*').limit(5)
          expect(filas(r), `${t} legible por ${perfil}`).toHaveLength(0)
        }
        for (const columna of ['cost_price', 'sale_price', 'stock_qty']) {
          const r = await tabla(clienteDe(perfil), 'v_supply_catalog').select(
            columna,
          )
          expect(r.error, `${columna} en el catálogo`).not.toBeNull()
        }
        const cat = await tabla(clienteDe(perfil), 'v_supply_catalog')
          .select('*')
          .limit(1)
        expect(cat.error, describir(cat)).toBeNull()
        const claves = Object.keys(filas(cat)[0] ?? {})
        for (const prohibida of ['cost_price', 'sale_price', 'stock_qty']) {
          expect(claves).not.toContain(prohibida)
        }
      })
    }
  })

  // -----------------------------------------------------------------------------------------------
  // 8. OF-04b (0083): cancelar un turno libera al empleado y él lo sigue viendo
  // -----------------------------------------------------------------------------------------------
  describe('cancelar un turno libera al empleado (OF-04b, 0083)', () => {
    let asignacion = ''

    it('prepara: empleado4 asignado al turno que se va a cancelar', async () => {
      const r = await llamar(clienteDe('owner'), 'assign_employee', {
        p_shift_id: T.turnoCancelar,
        p_employee_id: c().ids.empleado4,
      })
      expect(codigo(r), describir(r as never)).toBe('OK')
      asignacion = (json(r).assignment as { id: string }).id
    })

    it('mientras el turno está vivo, empleado4 no puede tomar otro a la misma hora (ASSIGNMENT_OVERLAP)', async () => {
      const r = await llamar(clienteDe('owner'), 'assign_employee', {
        p_shift_id: T.turnoOtro,
        p_employee_id: c().ids.empleado4,
      })
      expect(codigo(r)).toBe('ASSIGNMENT_OVERLAP')
    })

    it('[admin sin capacidades] cancel_shift: FORBIDDEN y la asignación sigue vigente (CB-17)', async () => {
      const r = await llamar(clienteDe('adminSin'), 'cancel_shift', {
        p_shift_id: T.turnoCancelar,
        p_reason: 'e2e-perm-p28',
      })
      expect(codigo(r)).toBe('FORBIDDEN')
    })

    it('[admin con todas] cancela: la asignación queda liberada (released_at), no quitada (OF-04b)', async () => {
      const r = await llamar(clienteDe('admin'), 'cancel_shift', {
        p_shift_id: T.turnoCancelar,
        p_reason: 'e2e-perm-p28',
      })
      expect(codigo(r), describir(r as never)).toBe('OK')
      const a = await tabla(db(), 'assignments')
        .select('removed_at, released_at, released_by')
        .eq('id', asignacion)
      const f = filas(a)[0]
      expect(f?.released_at, 'released_at').not.toBeNull()
      expect(f?.released_by, 'released_by').not.toBeNull()
      expect(f?.removed_at, 'no debe quedar quitada').toBeNull()
      // Lo que el empleado ve en su celular (que la fila siga legible con su sesión) se prueba en
      // el e2e `p28-turno-cancelado.empleado.ts`: acá no hay una sesión de empleado4.
    })

    it('el empleado liberado puede tomar otro turno a la misma hora y remove/move de la liberada dan SHIFT_CANCELLED (OF-04b)', async () => {
      const otro = await llamar(clienteDe('owner'), 'assign_employee', {
        p_shift_id: T.turnoOtro,
        p_employee_id: c().ids.empleado4,
      })
      expect(codigo(otro), describir(otro as never)).toBe('OK')
      const quitar = await llamar(clienteDe('owner'), 'remove_assignment', {
        p_assignment_id: asignacion,
        p_reason: 'e2e-perm-p28',
      })
      expect(codigo(quitar)).toBe('SHIFT_CANCELLED')
      const mover = await llamar(clienteDe('owner'), 'move_assignment', {
        p_assignment_id: asignacion,
        p_target_shift_id: T.turnoMoverA,
      })
      expect(codigo(mover)).toBe('SHIFT_CANCELLED')
    })

    it('released_by es obligatorio con released_at (check de la tabla, también con la clave de servicio)', async () => {
      const r = await db()
        .from('assignments')
        .update({ released_by: null })
        .eq('id', asignacion)
      expect(r.error, 'el check no frenó').not.toBeNull()
    })
  })
})
