// tests/permissions/suite/101-p28-9.permissions.ts — P28.9c (ajustes después de P28, migración 0084)
//
// Lo nuevo de la 0084 por API directa con `supabase-js`, contra App_dev y con DATOS REALES. Por rol
// (dueño, administrador con todas las capacidades, administrador sin capacidades, coordinador, doble
// rol, empleado y anon):
//   1. `move_assignment_to_new_shift` (OF-23): dueño y administradores; el resto FORBIDDEN / 42501 y no
//      se crea ningún turno ni se mueve nada. Con datos: turno nuevo sin servicio si el servicio ya
//      tiene turno ese día, con servicio si no, errores propios, atomicidad (si el pase falla no queda
//      un turno vacío) y «Deshacer» (el borrado del turno es solo de la dirección).
//   2. `preview_service_changes` / `apply_service_changes` con `p_create_missing` (OF-05b).
//   3. `preview_shift_series` / `create_shift_series` con `p_exclude_dates` (OF-21).
//   4. `get_leave_conflicts` con `service_id`, `service_name` y `detail` (OF-08b).
// Todo con el prefijo `e2e-perm-p28-9-` y fechas de un año lejano; lo que se crea se borra en `afterAll`.

import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { anioLejano } from '../../fixtures/accounts.ts'
import { daysFromToday } from '../../fixtures/dates.ts'
import { deleteClientDeep } from '../../fixtures/scenario.ts'
import { describir, filas, tabla } from './ayudas.ts'
import { clienteDe, contexto, servicio } from './contexto.ts'
import { cuitUnico, PREFIJO } from './escenario.ts'
import { ETIQUETA, type Perfil } from './perfiles.ts'
import type { Db } from './contexto.ts'

const P = `${PREFIJO}p28-9-`
const sfx = () => randomBytes(3).toString('hex')

const SIN_ADMIN: Perfil[] = ['empleado', 'supervisor', 'dual']
const ADMINS: Perfil[] = ['adminSin', 'admin', 'owner']

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

function codigo(res: Resp): string {
  if (!res.error) return 'OK'
  return res.error.code === '42501'
    ? '42501'
    : (res.error.hint ?? res.error.code ?? 'ERROR')
}

const json = (res: Resp) => (res.data ?? {}) as Record<string, unknown>

/** Suma días a una fecha `AAAA-MM-DD`. */
function mas(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

describe('lote P28.9 (0084): permisos de lo nuevo con datos reales', () => {
  const db = () => servicio()
  const c = () => contexto()
  const anio = anioLejano()
  // Un mes por tema, en el año lejano, para no pisar ningún otro dato.
  const MES_MOVER = `${anio}-02`
  const MES_CAMBIO = `${anio}-03`
  const MES_SERIE = `${anio}-04`
  const MES_LICENCIA = `${anio}-05`
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

  async function turno(
    fecha: string,
    ini: string,
    fin: string,
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    return insertar(
      db()
        .from('shifts')
        .insert({
          client_id: T.cliente,
          site_id: T.sede,
          shift_date: fecha,
          start_time: ini,
          end_time: fin,
          required_staff: 2,
          ...extra,
        })
        .select('id')
        .single(),
      `turno ${fecha}`,
    )
  }

  /** Turno de origen con el empleado3 asignado (como la dirección). Devuelve ids. */
  async function turnoConPersona(
    fecha: string,
    ini = '08:00',
    fin = '10:00',
    extra: Record<string, unknown> = {},
  ): Promise<{ turno: string; asignacion: string }> {
    const t = await turno(fecha, ini, fin, extra)
    const r = await llamar(clienteDe('owner'), 'assign_employee', {
      p_shift_id: t,
      p_employee_id: c().ids.empleado3,
    })
    if (r.error) throw new Error(`asignar: ${r.error.message}`)
    return { turno: t, asignacion: (json(r).assignment as { id: string }).id }
  }

  async function turnosDeLaSedeEl(fecha: string): Promise<string[]> {
    const r = await tabla(db(), 'shifts')
      .select('id')
      .eq('site_id', T.sede)
      .eq('shift_date', fecha)
    return filas(r).map((f) => f.id as string)
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
  })

  afterAll(async () => {
    for (const id of clientesCreados) {
      const notas = await deleteClientDeep(db(), id)
      if (notas.length)
        console.warn(`[101-p28-9] limpieza con notas: ${notas.join('; ')}`)
    }
    await db()
      .from('security_events')
      .delete()
      .eq('event_type', 'record_deleted')
      .gte('created_at', desde)
      .like('details->>name', `${P}%`)
  })

  // -----------------------------------------------------------------------------------------------
  // 1. move_assignment_to_new_shift (OF-23)
  // -----------------------------------------------------------------------------------------------
  describe('move_assignment_to_new_shift (OF-23)', () => {
    const FUERA = `${MES_MOVER}-03`
    let sinPermiso = { turno: '', asignacion: '' }

    it('prepara: una persona asignada a un turno de la sede', async () => {
      sinPermiso = await turnoConPersona(FUERA)
    })

    for (const perfil of SIN_ADMIN) {
      it(`[${ETIQUETA[perfil]}] FORBIDDEN, no se crea ningún turno y la persona sigue donde estaba (RB-X02, CB-17, OF-23)`, async () => {
        const antes = await turnosDeLaSedeEl(FUERA)
        const r = await llamar(
          clienteDe(perfil),
          'move_assignment_to_new_shift',
          {
            p_assignment_id: sinPermiso.asignacion,
            p_date: FUERA,
            p_start: '14:00',
            p_end: '16:00',
          },
        )
        expect(codigo(r), describir(r as never)).toBe('FORBIDDEN')
        expect(await turnosDeLaSedeEl(FUERA)).toEqual(antes)
        const a = await tabla(db(), 'assignments')
          .select('shift_id, removed_at')
          .eq('id', sinPermiso.asignacion)
        expect(filas(a)[0]?.shift_id).toBe(sinPermiso.turno)
        expect(filas(a)[0]?.removed_at).toBeNull()
      })
    }

    it('[anon] 42501 y no se crea nada (OF-23)', async () => {
      const antes = await turnosDeLaSedeEl(FUERA)
      const r = await llamar(
        clienteDe('anon'),
        'move_assignment_to_new_shift',
        {
          p_assignment_id: sinPermiso.asignacion,
          p_date: FUERA,
          p_start: '14:00',
          p_end: '16:00',
        },
      )
      expect(codigo(r)).toBe('42501')
      expect(await turnosDeLaSedeEl(FUERA)).toEqual(antes)
    })

    ADMINS.forEach((perfil, i) => {
      it(`[${ETIQUETA[perfil]}] crea el turno manual de la sede, pasa a la persona y devuelve lo de move_assignment más shift_id y assignment_id (OF-23)`, async () => {
        const dia = `${MES_MOVER}-${String(10 + i).padStart(2, '0')}`
        const origen = await turnoConPersona(dia, '08:00', '10:00')
        const r = await llamar(
          clienteDe(perfil),
          'move_assignment_to_new_shift',
          {
            p_assignment_id: origen.asignacion,
            p_date: dia,
            p_start: '14:00',
            p_end: '16:00',
          },
        )
        expect(codigo(r), describir(r as never)).toBe('OK')
        const j = json(r)
        const nuevo = j.shift_id as string
        expect(nuevo).toBeTruthy()
        expect(nuevo).not.toBe(origen.turno)
        expect((j.previous as { shift_id: string }).shift_id).toBe(origen.turno)
        expect(j.removed_assignment_id).toBe(origen.asignacion)
        expect(j.assignment_id).toBeTruthy()
        const t = await tabla(db(), 'shifts')
          .select(
            'site_id, client_id, shift_date, start_time, end_time, required_staff, generated, service_id',
          )
          .eq('id', nuevo)
        const f = filas(t)[0]
        expect(f?.site_id).toBe(T.sede)
        expect(f?.client_id).toBe(T.cliente)
        expect(f?.shift_date).toBe(dia)
        expect(String(f?.start_time)).toMatch(/^14:00/)
        expect(String(f?.end_time)).toMatch(/^16:00/)
        expect(f?.required_staff).toBe(1)
        expect(f?.generated).toBe(false)
        const vieja = await tabla(db(), 'assignments')
          .select('removed_at')
          .eq('id', origen.asignacion)
        expect(filas(vieja)[0]?.removed_at).not.toBeNull()
        const nueva = await tabla(db(), 'assignments')
          .select('shift_id, employee_id, removed_at')
          .eq('id', j.assignment_id)
        expect(filas(nueva)[0]?.shift_id).toBe(nuevo)
        expect(filas(nueva)[0]?.employee_id).toBe(c().ids.empleado3)
        expect(filas(nueva)[0]?.removed_at).toBeNull()
      })
    })

    it('hereda el servicio si ese día no tiene turno, y nace SIN servicio si ya lo tiene (OF-23, índice único service_id + fecha)', async () => {
      const dia1 = `${MES_MOVER}-17`
      const dia2 = `${MES_MOVER}-18`
      T.servicioMover = await insertar(
        db()
          .from('services')
          .insert({
            client_id: T.cliente,
            site_id: T.sede,
            name: `${P}mover-${sfx()}`,
            weekdays: [0, 1, 2, 3, 4, 5, 6],
            start_time: '08:00',
            end_time: '10:00',
            required_staff: 2,
            valid_from: hoy,
            status: 'paused',
          })
          .select('id')
          .single(),
        'servicio',
      )
      const origen = await turnoConPersona(dia1, '08:00', '10:00', {
        service_id: T.servicioMover,
        generated: true,
      })
      // Mismo día: el servicio ya tiene turno -> el nuevo es manual y sin servicio.
      const mismoDia = await llamar(
        clienteDe('owner'),
        'move_assignment_to_new_shift',
        {
          p_assignment_id: origen.asignacion,
          p_date: dia1,
          p_start: '14:00',
          p_end: '16:00',
        },
      )
      expect(codigo(mismoDia), describir(mismoDia as never)).toBe('OK')
      const t1 = await tabla(db(), 'shifts')
        .select('service_id')
        .eq('id', json(mismoDia).shift_id)
      expect(filas(t1)[0]?.service_id).toBeNull()

      // Otro día sin turno del servicio: el nuevo es del mismo servicio.
      const origen2 = await turnoConPersona(
        `${MES_MOVER}-19`,
        '08:00',
        '10:00',
        {
          service_id: T.servicioMover,
          generated: true,
        },
      )
      const otroDia = await llamar(
        clienteDe('admin'),
        'move_assignment_to_new_shift',
        {
          p_assignment_id: origen2.asignacion,
          p_date: dia2,
          p_start: '08:00',
          p_end: '10:00',
        },
      )
      expect(codigo(otroDia), describir(otroDia as never)).toBe('OK')
      const t2 = await tabla(db(), 'shifts')
        .select('service_id')
        .eq('id', json(otroDia).shift_id)
      expect(filas(t2)[0]?.service_id).toBe(T.servicioMover)
    })

    it('errores propios: ASSIGNMENT_NOT_FOUND e INVALID_TIME_RANGE (fin no posterior al inicio, fecha o fin faltantes) (OF-23)', async () => {
      const dia = `${MES_MOVER}-20`
      const origen = await turnoConPersona(dia, '08:00', '10:00')
      const antes = await turnosDeLaSedeEl(dia)
      const noExiste = await llamar(
        clienteDe('owner'),
        'move_assignment_to_new_shift',
        {
          p_assignment_id: '00000000-0000-4000-8000-000000000000',
          p_date: dia,
          p_start: '14:00',
          p_end: '16:00',
        },
      )
      expect(codigo(noExiste)).toBe('ASSIGNMENT_NOT_FOUND')
      for (const [p_start, p_end] of [
        ['16:00', '14:00'],
        ['14:00', '14:00'],
      ]) {
        const r = await llamar(
          clienteDe('owner'),
          'move_assignment_to_new_shift',
          {
            p_assignment_id: origen.asignacion,
            p_date: dia,
            p_start,
            p_end,
          },
        )
        expect(codigo(r), `${p_start}-${p_end}`).toBe('INVALID_TIME_RANGE')
      }
      const sinFecha = await llamar(
        clienteDe('owner'),
        'move_assignment_to_new_shift',
        {
          p_assignment_id: origen.asignacion,
          p_date: null,
          p_start: '14:00',
          p_end: '16:00',
        },
      )
      expect(codigo(sinFecha)).toBe('INVALID_TIME_RANGE')
      expect(await turnosDeLaSedeEl(dia)).toEqual(antes)
    })

    it('atomicidad: si el pase falla (ASSIGNMENT_OVERLAP) no queda el turno nuevo ni se mueve la persona (OF-23, CB-17)', async () => {
      const dia = `${MES_MOVER}-22`
      const origen = await turnoConPersona(dia, '08:00', '10:00')
      // La misma persona ya está en otro turno de la tarde.
      await turnoConPersona(dia, '14:00', '16:00')
      const antes = await turnosDeLaSedeEl(dia)
      expect(antes).toHaveLength(2)
      const r = await llamar(
        clienteDe('owner'),
        'move_assignment_to_new_shift',
        {
          p_assignment_id: origen.asignacion,
          p_date: dia,
          p_start: '15:00',
          p_end: '17:00',
        },
      )
      expect(codigo(r), describir(r as never)).toBe('ASSIGNMENT_OVERLAP')
      expect(await turnosDeLaSedeEl(dia)).toEqual(antes)
      const a = await tabla(db(), 'assignments')
        .select('removed_at')
        .eq('id', origen.asignacion)
      expect(filas(a)[0]?.removed_at).toBeNull()
    })

    it('«Deshacer»: move_assignment devuelve a la persona y el turno nuevo lo borra solo la dirección (OF-23, P27)', async () => {
      const dia = `${MES_MOVER}-24`
      const origen = await turnoConPersona(dia, '08:00', '10:00')
      const r = await llamar(
        clienteDe('owner'),
        'move_assignment_to_new_shift',
        {
          p_assignment_id: origen.asignacion,
          p_date: dia,
          p_start: '14:00',
          p_end: '16:00',
        },
      )
      expect(codigo(r), describir(r as never)).toBe('OK')
      const j = json(r)
      const previo = j.previous as {
        shift_id: string
        start_time: string
        end_time: string
      }
      const volver = await llamar(clienteDe('owner'), 'move_assignment', {
        p_assignment_id: j.assignment_id,
        p_target_shift_id: previo.shift_id,
        p_start: previo.start_time,
        p_end: previo.end_time,
      })
      expect(codigo(volver), describir(volver as never)).toBe('OK')
      // El administrador no puede borrar el turno (es solo de la dirección).
      const admin = await llamar(clienteDe('admin'), 'owner_delete_shift', {
        p_shift_id: j.shift_id,
      })
      expect(codigo(admin)).toBe('FORBIDDEN')
      expect(await turnosDeLaSedeEl(dia)).toContain(j.shift_id as string)
      const dueno = await llamar(clienteDe('owner'), 'owner_delete_shift', {
        p_shift_id: j.shift_id,
      })
      expect(codigo(dueno), describir(dueno as never)).toBe('OK')
      expect(await turnosDeLaSedeEl(dia)).toEqual([origen.turno])
    })
  })

  // -----------------------------------------------------------------------------------------------
  // 2. p_create_missing (OF-05b)
  // -----------------------------------------------------------------------------------------------
  describe('preview/apply_service_changes con p_create_missing (OF-05b)', () => {
    const DESDE = `${MES_CAMBIO}-01`
    const previo = { required_staff: 1 }
    const cuantosDelServicio = async () =>
      filas(
        await tabla(db(), 'shifts')
          .select('id')
          .eq('service_id', T.servicioCambio),
      ).length

    it('prepara: servicio de todos los días con dotación 2 y un único turno generado en el mes', async () => {
      T.servicioCambio = await insertar(
        db()
          .from('services')
          .insert({
            client_id: T.cliente,
            site_id: T.sede,
            name: `${P}cambio-${sfx()}`,
            weekdays: [0, 1, 2, 3, 4, 5, 6],
            start_time: '08:00',
            end_time: '12:00',
            required_staff: 2,
            valid_from: hoy,
            status: 'active',
          })
          .select('id')
          .single(),
        'servicio',
      )
      await insertar(
        db()
          .from('shifts')
          .insert({
            client_id: T.cliente,
            site_id: T.sede,
            service_id: T.servicioCambio,
            shift_date: `${MES_CAMBIO}-10`,
            start_time: '08:00',
            end_time: '12:00',
            required_staff: 1,
            generated: true,
          })
          .select('id')
          .single(),
        'turno',
      )
      expect(await cuantosDelServicio()).toBe(1)
    })

    for (const perfil of SIN_ADMIN) {
      it(`[${ETIQUETA[perfil]}] FORBIDDEN en las dos con p_create_missing y no se crea ningún turno (RB-X02, CB-17, OF-05b)`, async () => {
        for (const rpc of [
          'preview_service_changes',
          'apply_service_changes',
        ]) {
          const r = await llamar(clienteDe(perfil), rpc, {
            p_service_id: T.servicioCambio,
            p_from_date: DESDE,
            p_previous: previo,
            p_create_missing: true,
          })
          expect(codigo(r), `${rpc}: ${describir(r as never)}`).toBe(
            'FORBIDDEN',
          )
        }
        expect(await cuantosDelServicio()).toBe(1)
      })
    }

    it('[anon] 42501 en las dos con p_create_missing', async () => {
      for (const rpc of ['preview_service_changes', 'apply_service_changes']) {
        const r = await llamar(clienteDe('anon'), rpc, {
          p_service_id: T.servicioCambio,
          p_from_date: DESDE,
          p_create_missing: false,
        })
        expect(codigo(r), rpc).toBe('42501')
      }
    })

    for (const perfil of ADMINS) {
      it(`[${ETIQUETA[perfil]}] la vista previa con true promete turnos nuevos y con false ninguno; no escribe (OF-05b)`, async () => {
        const base = {
          p_service_id: T.servicioCambio,
          p_from_date: DESDE,
          p_previous: previo,
        }
        const con = await llamar(clienteDe(perfil), 'preview_service_changes', {
          ...base,
          p_create_missing: true,
        })
        expect(codigo(con), describir(con as never)).toBe('OK')
        expect(Number(json(con).created_count)).toBeGreaterThan(0)
        const sin = await llamar(clienteDe(perfil), 'preview_service_changes', {
          ...base,
          p_create_missing: false,
        })
        expect(codigo(sin), describir(sin as never)).toBe('OK')
        const s = json(sin)
        expect(s.preview).toBe(true)
        expect(Number(s.created_count)).toBe(0)
        expect(s.created).toEqual([])
        expect(s.months).toEqual([])
        expect(Number(s.updated_count)).toBeGreaterThanOrEqual(1)
        // Sin el parámetro vale el default (true).
        const def = await llamar(
          clienteDe(perfil),
          'preview_service_changes',
          base,
        )
        expect(Number(json(def).created_count)).toBeGreaterThan(0)
        expect(await cuantosDelServicio(), 'la vista previa escribió').toBe(1)
      })
    }

    it('[admin sin capacidades] apply con false actualiza el turno y no genera ninguno; con true genera los que faltan (OF-05b)', async () => {
      const sin = await llamar(clienteDe('adminSin'), 'apply_service_changes', {
        p_service_id: T.servicioCambio,
        p_from_date: DESDE,
        p_previous: previo,
        p_create_missing: false,
      })
      expect(codigo(sin), describir(sin as never)).toBe('OK')
      expect(json(sin).preview).toBe(false)
      expect(Number(json(sin).created_count)).toBe(0)
      expect(await cuantosDelServicio()).toBe(1)
      const t = await tabla(db(), 'shifts')
        .select('required_staff')
        .eq('service_id', T.servicioCambio)
      expect(filas(t)[0]?.required_staff).toBe(2)

      const con = await llamar(clienteDe('admin'), 'apply_service_changes', {
        p_service_id: T.servicioCambio,
        p_from_date: DESDE,
        p_previous: previo,
        p_create_missing: true,
      })
      expect(codigo(con), describir(con as never)).toBe('OK')
      expect(Number(json(con).created_count)).toBeGreaterThan(0)
      expect(await cuantosDelServicio()).toBeGreaterThan(1)
    })
  })

  // -----------------------------------------------------------------------------------------------
  // 3. p_exclude_dates (OF-21)
  // -----------------------------------------------------------------------------------------------
  describe('preview/create_shift_series con p_exclude_dates (OF-21)', () => {
    const D0 = `${MES_SERIE}-06`
    const D1 = mas(D0, 1)
    const D2 = mas(D0, 2)
    const D3 = mas(D0, 3)
    const D4 = mas(D0, 4)
    const regla = (extra: Record<string, unknown> = {}) => ({
      p_from: D0,
      p_to: D4,
      p_weekdays: [0, 1, 2, 3, 4, 5, 6],
      p_works_on_holidays: true,
      ...extra,
    })
    const crear = (extra: Record<string, unknown> = {}) => ({
      p_client_id: T.cliente,
      p_site_id: T.sede,
      p_start: '08:00',
      p_end: '10:00',
      p_required_staff: 1,
      ...regla(extra),
    })
    const fechasCreadas = async () =>
      filas(
        await tabla(db(), 'shifts')
          .select('shift_date')
          .eq('site_id', T.sede)
          .in('shift_date', [D0, D1, D2, D3, D4]),
      )
        .map((f) => f.shift_date as string)
        .sort()

    for (const perfil of SIN_ADMIN) {
      it(`[${ETIQUETA[perfil]}] FORBIDDEN en las dos con p_exclude_dates y no se crea nada (RB-X02, CB-17, OF-21)`, async () => {
        const a = await llamar(clienteDe(perfil), 'preview_shift_series', {
          ...regla({ p_exclude_dates: [D1] }),
        })
        expect(codigo(a), describir(a as never)).toBe('FORBIDDEN')
        const b = await llamar(clienteDe(perfil), 'create_shift_series', {
          ...crear({ p_exclude_dates: [D1] }),
        })
        expect(codigo(b), describir(b as never)).toBe('FORBIDDEN')
        expect(await fechasCreadas()).toEqual([])
      })
    }

    it('[anon] 42501 en las dos con p_exclude_dates', async () => {
      const a = await llamar(clienteDe('anon'), 'preview_shift_series', {
        ...regla({ p_exclude_dates: [D1] }),
      })
      expect(codigo(a)).toBe('42501')
      const b = await llamar(clienteDe('anon'), 'create_shift_series', {
        ...crear({ p_exclude_dates: [D1] }),
      })
      expect(codigo(b)).toBe('42501')
      expect(await fechasCreadas()).toEqual([])
    })

    for (const perfil of ADMINS) {
      it(`[${ETIQUETA[perfil]}] la vista previa saca las fechas excluidas (también las inexistentes en la regla) y no escribe (OF-21)`, async () => {
        const todas = await llamar(
          clienteDe(perfil),
          'preview_shift_series',
          regla(),
        )
        expect(json(todas).dates).toEqual([D0, D1, D2, D3, D4])
        const r = await llamar(clienteDe(perfil), 'preview_shift_series', {
          ...regla({ p_exclude_dates: [D1, D3, mas(D4, 30)] }),
        })
        expect(codigo(r), describir(r as never)).toBe('OK')
        expect(json(r).dates).toEqual([D0, D2, D4])
        expect(json(r).count).toBe(3)
        expect(await fechasCreadas()).toEqual([])
      })
    }

    it('excluir todas las fechas: la vista previa da count 0 y create_shift_series falla con SERIES_EMPTY sin crear nada (OF-21)', async () => {
      const todas = [D0, D1, D2, D3, D4]
      const v = await llamar(clienteDe('owner'), 'preview_shift_series', {
        ...regla({ p_exclude_dates: todas }),
      })
      expect(json(v).count).toBe(0)
      const c1 = await llamar(clienteDe('owner'), 'create_shift_series', {
        ...crear({ p_exclude_dates: todas }),
      })
      expect(codigo(c1)).toBe('SERIES_EMPTY')
      expect(await fechasCreadas()).toEqual([])
    })

    it('[admin sin capacidades] create_shift_series con p_exclude_dates crea solo las fechas no excluidas (OF-21)', async () => {
      const r = await llamar(clienteDe('adminSin'), 'create_shift_series', {
        ...crear({ p_exclude_dates: [D1, D3] }),
      })
      expect(codigo(r), describir(r as never)).toBe('OK')
      expect(await fechasCreadas()).toEqual([D0, D2, D4])
    })

    it('[dueño] sin p_exclude_dates crea la serie completa como antes (OF-21, regresión)', async () => {
      // Las fechas D0, D2 y D4 ya existen: se barren para repetir la regla limpia.
      await db()
        .from('shifts')
        .delete()
        .eq('site_id', T.sede)
        .in('shift_date', [D0, D2, D4])
      const r = await llamar(clienteDe('owner'), 'create_shift_series', crear())
      expect(codigo(r), describir(r as never)).toBe('OK')
      expect(await fechasCreadas()).toEqual([D0, D1, D2, D3, D4])
    })
  })

  // -----------------------------------------------------------------------------------------------
  // 4. get_leave_conflicts con service_id, service_name y detail (OF-08b)
  // -----------------------------------------------------------------------------------------------
  describe('get_leave_conflicts con las columnas nuevas (OF-08b)', () => {
    const DIA_CON = `${MES_LICENCIA}-12`
    const DIA_SIN = `${MES_LICENCIA}-13`
    const args = () => ({
      p_employee_id: c().ids.empleado3,
      p_starts_on: `${MES_LICENCIA}-01`,
      p_ends_on: `${MES_LICENCIA}-28`,
    })

    it('prepara: la persona en un turno con servicio y en uno manual', async () => {
      T.servicioLicencia = await insertar(
        db()
          .from('services')
          .insert({
            client_id: T.cliente,
            site_id: T.sede,
            name: `${P}licencia-${sfx()}`,
            weekdays: [0, 1, 2, 3, 4, 5, 6],
            start_time: '08:00',
            end_time: '10:00',
            valid_from: hoy,
            status: 'paused',
          })
          .select('id')
          .single(),
        'servicio',
      )
      await turnoConPersona(DIA_CON, '08:00', '10:00', {
        service_id: T.servicioLicencia,
        generated: true,
      })
      await turnoConPersona(DIA_SIN, '08:00', '10:00')
    })

    for (const perfil of SIN_ADMIN) {
      it(`[${ETIQUETA[perfil]}] FORBIDDEN (RB-X02, CB-17, OF-08b)`, async () => {
        const r = await llamar(clienteDe(perfil), 'get_leave_conflicts', args())
        expect(codigo(r), describir(r as never)).toBe('FORBIDDEN')
      })
    }

    it('[anon] 42501', async () => {
      const r = await llamar(clienteDe('anon'), 'get_leave_conflicts', args())
      expect(codigo(r)).toBe('42501')
    })

    for (const perfil of ADMINS) {
      it(`[${ETIQUETA[perfil]}] devuelve service_id, service_name y detail con shift_id, code y message (OF-08b)`, async () => {
        const r = await llamar(clienteDe(perfil), 'get_leave_conflicts', args())
        expect(codigo(r), describir(r as never)).toBe('OK')
        const f = r.data as Array<Record<string, unknown>>
        expect(f).toHaveLength(2)
        const con = f.find((x) => x.shift_date === DIA_CON)!
        const sin = f.find((x) => x.shift_date === DIA_SIN)!
        // Columnas anteriores intactas.
        for (const k of [
          'assignment_id',
          'shift_id',
          'start_time',
          'end_time',
          'open_ended',
          'client_id',
          'client_name',
          'site_id',
          'site_name',
          'shift_status',
        ]) {
          expect(con, `falta ${k}`).toHaveProperty(k)
        }
        expect(con.service_id).toBe(T.servicioLicencia)
        expect(String(con.service_name)).toContain(`${P}licencia-`)
        const d = con.detail as Record<string, unknown>
        expect(d.code).toBe('SHIFT_IN_LEAVE')
        expect(d.shift_id).toBe(con.shift_id)
        expect(d.employee_id).toBe(c().ids.empleado3)
        expect(d.site_id).toBe(T.sede)
        expect(d.service_id).toBe(T.servicioLicencia)
        expect(String(d.message).length).toBeGreaterThan(10)
        // Turno manual: sin servicio, pero con detail.
        expect(sin.service_id).toBeNull()
        expect(sin.service_name).toBeNull()
        expect((sin.detail as Record<string, unknown>).shift_id).toBe(
          sin.shift_id,
        )
      })
    }
  })
})
