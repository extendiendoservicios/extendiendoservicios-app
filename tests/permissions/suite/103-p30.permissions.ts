// tests/permissions/suite/103-p30.permissions.ts — P30.5 (observaciones de la dirección del 18 nov, migración 0087)
//
// Lo nuevo de la 0087 por API directa con `supabase-js`, contra App_dev y con DATOS REALES. Por rol
// (dueño, administrador con todas las capacidades, administrador sin capacidades, coordinador, doble
// rol, empleado y anon):
//   1. `save_employee_leave` (OH-08): solo dueño y administradores; el resto FORBIDDEN / 42501 y no se
//      guarda ninguna licencia ni se libera nada. Con datos: la vista previa no escribe, el alta y el
//      cambio liberan las asignaciones del período en una transacción, errores propios.
//   2. `employee_leaves` (OH-08): ya no se inserta, edita ni borra directo (42501) para nadie; solo
//      queda la baja lógica (`deleted_at` / `updated_by`) de dueño y administradores.
//   3. `employee_fixed_gaps` (OH-06) y `employee_fixed_pattern` (OH-07): solo dueño y administradores.
//   4. `employee_week_boards`, `get_employee_week_board` y `save_employee_week_board` (OH-07): solo
//      dueño y administradores leen y guardan; nadie escribe la tabla por PostgREST; la validación de
//      forma (`INVALID_BOARD`) no deja nada guardado.
//   5. `register_past_shift` (OH-09): dueño y administración con «Gestionar asistencia»; con datos:
//      crea el turno, asigna y carga la asistencia («Carga posterior»); todo o nada.
//   6. `create_shift` con un servicio que ya tiene turno ese día (OH-10): `SHIFT_DATE_TAKEN` con el
//      turno existente en `detail`.
//   7. `apply_service_changes` (OH-11): gana el último cambio (el horario cambiado a mano se reemplaza).
// Todo con el prefijo `e2e-perm-p30-`; lo que se crea se borra en `afterAll`.

import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { anioLejano } from '../../fixtures/accounts.ts'
import { daysFromToday } from '../../fixtures/dates.ts'
import { deleteClientDeep } from '../../fixtures/scenario.ts'
import { describir, filas, tabla } from './ayudas.ts'
import { clienteDe, contexto, idDe, servicio } from './contexto.ts'
import { cuitUnico, PREFIJO } from './escenario.ts'
import { ETIQUETA, type Perfil, type PerfilConSesion } from './perfiles.ts'
import type { Db } from './contexto.ts'

const P = `${PREFIJO}p30-`
const sfx = () => randomBytes(3).toString('hex')

const SIN_ADMIN: Perfil[] = ['empleado', 'supervisor', 'dual']
const ADMINS: Perfil[] = ['adminSin', 'admin', 'owner']
/** Con «Gestionar asistencia»: el dueño siempre y el administrador con todas las capacidades. */
const CON_ASISTENCIA: Perfil[] = ['admin', 'owner']
const TODOS: Perfil[] = [...SIN_ADMIN, ...ADMINS, 'anon']

interface Resp {
  data: unknown
  error: {
    code?: string
    hint?: string | null
    message: string
    details?: string | null
  } | null
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
const lista = (res: Resp) =>
  (Array.isArray(res.data) ? res.data : []) as Array<Record<string, unknown>>

const INEXISTENTE = '00000000-0000-4000-8000-0000000000aa'

describe('lote P30.1 (0087): permisos de lo nuevo con datos reales', () => {
  const db = () => servicio()
  const c = () => contexto()
  const anio = anioLejano()
  // Un mes por tema, en el año lejano del conjunto, para no pisar ningún otro dato.
  const MES_LICENCIA = `${anio}-02`
  const MES_FIJOS = `${anio}-03`
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

  /** Asigna con la RPC real, como el dueño; devuelve el id de la asignación. */
  async function asignar(turnoId: string, empleado: string): Promise<string> {
    const r = await llamar(clienteDe('owner'), 'assign_employee', {
      p_shift_id: turnoId,
      p_employee_id: empleado,
    })
    if (r.error) throw new Error(`asignar: ${r.error.message}`)
    return (json(r).assignment as { id: string }).id
  }

  async function asignadosDe(turnoId: string): Promise<string[]> {
    const { data } = await db()
      .from('assignments')
      .select('employee_id')
      .eq('shift_id', turnoId)
      .is('removed_at', null)
    return (data ?? []).map((f) => f.employee_id)
  }

  async function licenciasDe(empleado: string) {
    const { data } = await db()
      .from('employee_leaves')
      .select('id, starts_on, ends_on, reason, deleted_at')
      .eq('employee_id', empleado)
      .like('reason', `${P}%`)
    return data ?? []
  }

  async function turnosDeLaSede(): Promise<string[]> {
    const { data } = await db()
      .from('shifts')
      .select('id')
      .eq('site_id', T.sede)
      .is('deleted_at', null)
    return (data ?? []).map((f) => f.id)
  }

  async function pizarraDe(empleado: string) {
    const { data } = await db()
      .from('employee_week_boards')
      .select('blocks, updated_by')
      .eq('employee_id', empleado)
      .maybeSingle()
    return data
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
    T.emp = c().ids.empleado4
    T.fijo = c().ids.empleado3
  })

  afterAll(async () => {
    for (const empleado of [T.emp, T.fijo]) {
      await db()
        .from('employee_week_boards')
        .delete()
        .eq('employee_id', empleado)
      await db()
        .from('employee_leaves')
        .delete()
        .eq('employee_id', empleado)
        .like('reason', `${P}%`)
    }
    for (const id of clientesCreados) {
      const notas = await deleteClientDeep(db(), id)
      if (notas.length)
        console.warn(`[103-p30] limpieza con notas: ${notas.join('; ')}`)
    }
    await db()
      .from('security_events')
      .delete()
      .eq('event_type', 'record_deleted')
      .gte('created_at', desde)
      .like('details->>name', `${P}%`)
  })

  // -----------------------------------------------------------------------------------------------
  // 1. save_employee_leave (OH-08)
  // -----------------------------------------------------------------------------------------------
  describe('save_employee_leave (OH-08)', () => {
    const D1 = `${MES_LICENCIA}-03`
    const D2 = `${MES_LICENCIA}-04`
    const D3 = `${MES_LICENCIA}-20`
    const argsLicencia = (extra: Record<string, unknown> = {}) => ({
      p_leave_id: null,
      p_employee_id: T.emp,
      p_starts_on: D1,
      p_ends_on: D2,
      p_reason: `${P}licencia`,
      ...extra,
    })

    it('prepara: dos turnos del período y uno fuera, con la persona asignada', async () => {
      T.l1 = await turno(D1, '08:00', '10:00')
      T.l2 = await turno(D2, '14:00', '16:00')
      T.l3 = await turno(D3, '08:00', '10:00')
      for (const t of [T.l1, T.l2, T.l3]) await asignar(t, T.emp)
    })

    for (const perfil of SIN_ADMIN) {
      it(`[${ETIQUETA[perfil]}] FORBIDDEN: no guarda la licencia ni libera nada (RB-X02, CB-17, OH-08)`, async () => {
        const r = await llamar(
          clienteDe(perfil),
          'save_employee_leave',
          argsLicencia(),
        )
        expect(codigo(r), describir(r as never)).toBe('FORBIDDEN')
        expect(await licenciasDe(T.emp)).toHaveLength(0)
        expect(await asignadosDe(T.l1)).toEqual([T.emp])
      })
    }

    it('[anon] 42501 y no guarda nada (RB-X02, OH-08)', async () => {
      const r = await llamar(
        clienteDe('anon'),
        'save_employee_leave',
        argsLicencia(),
      )
      expect(codigo(r)).toBe('42501')
      expect(await licenciasDe(T.emp)).toHaveLength(0)
    })

    for (const perfil of ADMINS) {
      it(`[${ETIQUETA[perfil]}] la vista previa devuelve lo que liberaría y no escribe nada (RB-A03, OH-08)`, async () => {
        const r = await llamar(
          clienteDe(perfil),
          'save_employee_leave',
          argsLicencia({ p_preview: true }),
        )
        expect(codigo(r), describir(r as never)).toBe('OK')
        const j = json(r)
        expect(j.preview).toBe(true)
        expect(j.released_count).toBe(2)
        expect(
          (j.released as Array<{ shift_id: string }>).map((e) => e.shift_id),
        ).toEqual(expect.arrayContaining([T.l1, T.l2]))
        expect(j.kept_count).toBe(0)
        expect(await licenciasDe(T.emp)).toHaveLength(0)
        expect(await asignadosDe(T.l1)).toEqual([T.emp])
        expect(await asignadosDe(T.l2)).toEqual([T.emp])
      })
    }

    it('errores propios: fecha «hasta» anterior, sin «desde», persona inexistente y licencia inexistente (OH-08)', async () => {
      const dueno = clienteDe('owner')
      const rango = await llamar(
        dueno,
        'save_employee_leave',
        argsLicencia({ p_starts_on: D2, p_ends_on: D1 }),
      )
      expect(codigo(rango)).toBe('INVALID_DATE_RANGE')
      const sinDesde = await llamar(
        dueno,
        'save_employee_leave',
        argsLicencia({ p_starts_on: null }),
      )
      expect(codigo(sinDesde)).toBe('INVALID_DATE_RANGE')
      const persona = await llamar(
        dueno,
        'save_employee_leave',
        argsLicencia({ p_employee_id: INEXISTENTE }),
      )
      expect(codigo(persona)).toBe('EMPLOYEE_NOT_FOUND')
      const licencia = await llamar(
        dueno,
        'save_employee_leave',
        argsLicencia({ p_leave_id: INEXISTENTE }),
      )
      expect(codigo(licencia)).toBe('LEAVE_NOT_FOUND')
      expect(await licenciasDe(T.emp)).toHaveLength(0)
      expect(await asignadosDe(T.l1)).toEqual([T.emp])
    })

    it('[administrador sin capacidades] guarda la licencia y libera los dos turnos del período, no el de afuera, con el motivo «Licencia (…)» (RB-A03, OH-08)', async () => {
      const r = await llamar(
        clienteDe('adminSin'),
        'save_employee_leave',
        argsLicencia(),
      )
      expect(codigo(r), describir(r as never)).toBe('OK')
      const j = json(r)
      expect(j.preview).toBe(false)
      expect(j.released_count).toBe(2)
      T.licencia = (j.leave as { id: string }).id
      expect(T.licencia).toBeTruthy()
      expect(await asignadosDe(T.l1)).toEqual([])
      expect(await asignadosDe(T.l2)).toEqual([])
      expect(await asignadosDe(T.l3)).toEqual([T.emp])
      const quitadas = await tabla(db(), 'assignments')
        .select('removed_reason, removed_by')
        .eq('shift_id', T.l1)
      const motivo = filas(quitadas).find((f) => f.removed_reason)
      expect(String(motivo?.removed_reason)).toMatch(/^Licencia \(/)
      expect(motivo?.removed_by).toBe(idDe('adminSin'))
      const { data: t } = await db()
        .from('shifts')
        .select('status')
        .eq('id', T.l1)
        .single()
      expect(t?.status).toBe('scheduled')
      expect(await licenciasDe(T.emp)).toHaveLength(1)
    })

    it('[dueño] ampliar la licencia hacia el tercer turno lo libera también (cambio con p_leave_id) (RB-A03, OH-08)', async () => {
      const r = await llamar(
        clienteDe('owner'),
        'save_employee_leave',
        argsLicencia({ p_leave_id: T.licencia, p_ends_on: D3 }),
      )
      expect(codigo(r), describir(r as never)).toBe('OK')
      expect(json(r).released_count).toBe(1)
      expect(await asignadosDe(T.l3)).toEqual([])
      const licencias = await licenciasDe(T.emp)
      expect(licencias).toHaveLength(1)
      expect(licencias[0]?.ends_on).toBe(D3)
    })
  })

  // -----------------------------------------------------------------------------------------------
  // 2. employee_leaves: sin insert, update ni delete directos (OH-08)
  // -----------------------------------------------------------------------------------------------
  describe('employee_leaves: solo la baja lógica es directa (OH-08)', () => {
    const FECHA = `${MES_LICENCIA}-25`

    it('prepara: una licencia propia (con la clave de servicio)', async () => {
      T.licenciaDirecta = await insertar(
        db()
          .from('employee_leaves')
          .insert({
            employee_id: T.fijo,
            starts_on: FECHA,
            ends_on: FECHA,
            reason: `${P}directa`,
          })
          .select('id')
          .single(),
        'licencia directa',
      )
    })

    for (const perfil of TODOS) {
      it(`[${ETIQUETA[perfil]}] no inserta, no edita (reason) y no borra directo: 42501 y la licencia queda igual (RB-X02, CB-17, OH-08)`, async () => {
        const cliente = clienteDe(perfil)
        const insertar = await tabla(cliente, 'employee_leaves').insert({
          employee_id: T.fijo,
          starts_on: FECHA,
          ends_on: FECHA,
          reason: `${P}nueva`,
        })
        expect(codigo(insertar as never), describir(insertar)).toBe('42501')
        const editar = await tabla(cliente, 'employee_leaves')
          .update({ reason: `${P}editada` })
          .eq('id', T.licenciaDirecta)
        expect(codigo(editar as never), describir(editar)).toBe('42501')
        const fechas = await tabla(cliente, 'employee_leaves')
          .update({ ends_on: `${MES_LICENCIA}-26` })
          .eq('id', T.licenciaDirecta)
        expect(codigo(fechas as never), describir(fechas)).toBe('42501')
        const borrar = await tabla(cliente, 'employee_leaves')
          .delete()
          .eq('id', T.licenciaDirecta)
        expect(codigo(borrar as never), describir(borrar)).toBe('42501')
        const despues = await tabla(db(), 'employee_leaves')
          .select('reason, ends_on, deleted_at')
          .eq('employee_id', T.fijo)
          .eq('starts_on', FECHA)
        expect(filas(despues)).toEqual([
          { reason: `${P}directa`, ends_on: FECHA, deleted_at: null },
        ])
      })
    }

    for (const perfil of SIN_ADMIN) {
      it(`[${ETIQUETA[perfil]}] tampoco da de baja una licencia: ninguna fila afectada (RB-X02, CB-17, OH-08)`, async () => {
        const r = await tabla(clienteDe(perfil), 'employee_leaves')
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', T.licenciaDirecta)
          .select('id')
        expect(filas(r), describir(r)).toHaveLength(0)
        const { data } = await db()
          .from('employee_leaves')
          .select('deleted_at')
          .eq('id', T.licenciaDirecta)
          .single()
        expect(data?.deleted_at).toBeNull()
      })
    }

    it('[anon] no da de baja nada (RB-X02, OH-08)', async () => {
      const r = await tabla(clienteDe('anon'), 'employee_leaves')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', T.licenciaDirecta)
        .select('id')
      expect(filas(r)).toHaveLength(0)
    })

    for (const perfil of ADMINS) {
      it(`[${ETIQUETA[perfil]}] sí da de baja (deleted_at / updated_by): la baja lógica sigue siendo directa (RB-A03, OH-08)`, async () => {
        // Se repone entre perfiles para que cada uno la dé de baja.
        await db()
          .from('employee_leaves')
          .update({ deleted_at: null, updated_by: null })
          .eq('id', T.licenciaDirecta)
        const r = await tabla(clienteDe(perfil), 'employee_leaves')
          .update({
            deleted_at: new Date().toISOString(),
            updated_by: idDe(perfil as PerfilConSesion),
          })
          .eq('id', T.licenciaDirecta)
          .select('id, deleted_at')
        expect(r.error, describir(r)).toBeNull()
        expect(filas(r)).toHaveLength(1)
        expect(filas(r)[0]?.deleted_at).not.toBeNull()
      })
    }
  })

  // -----------------------------------------------------------------------------------------------
  // 3. employee_fixed_gaps y employee_fixed_pattern (OH-06, OH-07)
  // -----------------------------------------------------------------------------------------------
  describe('employee_fixed_gaps y employee_fixed_pattern (OH-06, OH-07)', () => {
    const FECHA = `${MES_FIJOS}-10`

    it('prepara: un servicio activo con un turno de ese día y, DESPUÉS, la persona como fija', async () => {
      T.servicioFijo = await insertar(
        db()
          .from('services')
          .insert({
            client_id: T.cliente,
            site_id: T.sede,
            name: `${P}servicio-${sfx()}`,
            weekdays: [0, 1, 2, 3, 4, 5, 6],
            start_time: '09:00',
            end_time: '11:00',
            required_staff: 1,
            valid_from: hoy,
            status: 'active',
          })
          .select('id')
          .single(),
        'servicio',
      )
      T.turnoFijo = await turno(FECHA, '09:00', '11:00', {
        service_id: T.servicioFijo,
        required_staff: 1,
      })
      const r = await db()
        .from('service_fixed_employees')
        .insert({ service_id: T.servicioFijo, employee_id: T.fijo })
      if (r.error) throw new Error(`fijo: ${r.error.message}`)
    })

    const argsHuecos = () => ({
      p_employee_id: T.fijo,
      p_from: `${MES_FIJOS}-01`,
      p_to: `${MES_FIJOS}-28`,
    })

    for (const perfil of SIN_ADMIN) {
      it(`[${ETIQUETA[perfil]}] FORBIDDEN en employee_fixed_gaps y employee_fixed_pattern (RB-X02, CB-17, OH-06, OH-07)`, async () => {
        const huecos = await llamar(
          clienteDe(perfil),
          'employee_fixed_gaps',
          argsHuecos(),
        )
        expect(codigo(huecos), describir(huecos as never)).toBe('FORBIDDEN')
        const patron = await llamar(
          clienteDe(perfil),
          'employee_fixed_pattern',
          { p_employee_id: T.fijo },
        )
        expect(codigo(patron), describir(patron as never)).toBe('FORBIDDEN')
      })
    }

    it('[anon] 42501 en las dos (RB-X02, OH-06, OH-07)', async () => {
      const huecos = await llamar(
        clienteDe('anon'),
        'employee_fixed_gaps',
        argsHuecos(),
      )
      expect(codigo(huecos)).toBe('42501')
      const patron = await llamar(clienteDe('anon'), 'employee_fixed_pattern', {
        p_employee_id: T.fijo,
      })
      expect(codigo(patron)).toBe('42501')
    })

    for (const perfil of ADMINS) {
      it(`[${ETIQUETA[perfil]}] employee_fixed_gaps devuelve el turno con el motivo ADDED_AFTER y su color y cliente (RB-A04, OH-06)`, async () => {
        const r = await llamar(
          clienteDe(perfil),
          'employee_fixed_gaps',
          argsHuecos(),
        )
        expect(codigo(r), describir(r as never)).toBe('OK')
        const hueco = lista(r).find((f) => f.shift_id === T.turnoFijo)
        expect(hueco, 'el turno sin asignar aparece').toBeTruthy()
        expect(hueco?.reason).toBe('ADDED_AFTER')
        expect(hueco?.shift_date).toBe(FECHA)
        expect(hueco?.client_id).toBe(T.cliente)
        expect(hueco?.service_id).toBe(T.servicioFijo)
      })

      it(`[${ETIQUETA[perfil]}] employee_fixed_pattern devuelve el servicio activo donde es fija con días y horario (RB-A05, OH-07)`, async () => {
        const r = await llamar(clienteDe(perfil), 'employee_fixed_pattern', {
          p_employee_id: T.fijo,
        })
        expect(codigo(r), describir(r as never)).toBe('OK')
        const fila = lista(r).find((f) => f.service_id === T.servicioFijo)
        expect(fila, 'el servicio fijo aparece').toBeTruthy()
        expect(fila?.weekdays).toEqual([0, 1, 2, 3, 4, 5, 6])
        expect(String(fila?.start_time).slice(0, 5)).toBe('09:00')
        expect(String(fila?.end_time).slice(0, 5)).toBe('11:00')
        expect(fila?.client_id).toBe(T.cliente)
      })
    }

    it('[dueño] el período inválido y el de más de 400 días se rechazan (OH-06)', async () => {
      const invertido = await llamar(
        clienteDe('owner'),
        'employee_fixed_gaps',
        {
          p_employee_id: T.fijo,
          p_from: `${MES_FIJOS}-10`,
          p_to: `${MES_FIJOS}-01`,
        },
      )
      expect(codigo(invertido)).toBe('INVALID_DATE_RANGE')
      const largo = await llamar(clienteDe('owner'), 'employee_fixed_gaps', {
        p_employee_id: T.fijo,
        p_from: `${anio}-01-01`,
        p_to: `${anio + 2}-01-01`,
      })
      expect(codigo(largo)).toBe('INVALID_DATE_RANGE')
    })

    it('[dueño] una vez asignada la persona, el hueco desaparece (OH-06)', async () => {
      await asignar(T.turnoFijo, T.fijo)
      const r = await llamar(
        clienteDe('owner'),
        'employee_fixed_gaps',
        argsHuecos(),
      )
      expect(lista(r).find((f) => f.shift_id === T.turnoFijo)).toBeUndefined()
    })
  })

  // -----------------------------------------------------------------------------------------------
  // 4. employee_week_boards y la pizarra semanal (OH-07)
  // -----------------------------------------------------------------------------------------------
  describe('pizarra semanal: employee_week_boards, get_employee_week_board y save_employee_week_board (OH-07)', () => {
    const bloque = (extra: Record<string, unknown> = {}) => ({
      id: `${P}b1`,
      weekday: 1,
      start: '09:00',
      end: '11:00',
      label: 'SEDE UNO',
      color_index: 3,
      service_id: null,
      ...extra,
    })

    for (const perfil of SIN_ADMIN) {
      it(`[${ETIQUETA[perfil]}] FORBIDDEN al guardar y al leer la pizarra; la tabla queda sin fila (RB-X02, CB-15, CB-17, OH-07)`, async () => {
        const guardar = await llamar(
          clienteDe(perfil),
          'save_employee_week_board',
          { p_employee_id: T.emp, p_blocks: [bloque()] },
        )
        expect(codigo(guardar), describir(guardar as never)).toBe('FORBIDDEN')
        const leer = await llamar(
          clienteDe(perfil),
          'get_employee_week_board',
          {
            p_employee_id: T.emp,
          },
        )
        expect(codigo(leer), describir(leer as never)).toBe('FORBIDDEN')
        expect(await pizarraDe(T.emp)).toBeNull()
      })
    }

    it('[anon] 42501 al guardar y al leer (RB-X02, OH-07)', async () => {
      const guardar = await llamar(
        clienteDe('anon'),
        'save_employee_week_board',
        { p_employee_id: T.emp, p_blocks: [bloque()] },
      )
      expect(codigo(guardar)).toBe('42501')
      const leer = await llamar(clienteDe('anon'), 'get_employee_week_board', {
        p_employee_id: T.emp,
      })
      expect(codigo(leer)).toBe('42501')
      expect(await pizarraDe(T.emp)).toBeNull()
    })

    it('[dueño] sin pizarra guardada get_employee_week_board devuelve null (OH-07)', async () => {
      const r = await llamar(clienteDe('owner'), 'get_employee_week_board', {
        p_employee_id: T.emp,
      })
      expect(codigo(r), describir(r as never)).toBe('OK')
      expect(r.data).toBeNull()
    })

    it('forma inválida: INVALID_BOARD en cada caso y no se guarda nada (OH-07)', async () => {
      const casos: Array<[string, unknown]> = [
        ['no es un arreglo', { a: 1 }],
        [
          'más de 60 bloques',
          Array.from({ length: 61 }, (_, i) => bloque({ id: `${P}x${i}` })),
        ],
        ['día 7', [bloque({ weekday: 7 })]],
        ['hora de inicio mal escrita', [bloque({ start: '9:00' })]],
        ['hora de fin mal escrita', [bloque({ end: '25:00' })]],
        ['identificador repetido', [bloque(), bloque()]],
        ['sin identificador', [bloque({ id: '' })]],
        ['texto de más de 80 caracteres', [bloque({ label: 'x'.repeat(81) })]],
        ['color 12', [bloque({ color_index: 12 })]],
        ['servicio que no es un uuid', [bloque({ service_id: 'no-es-uuid' })]],
        ['un bloque que no es un objeto', [1]],
      ]
      for (const [nombre, bloques] of casos) {
        const r = await llamar(clienteDe('owner'), 'save_employee_week_board', {
          p_employee_id: T.emp,
          p_blocks: bloques,
        })
        expect(codigo(r), `${nombre}: ${describir(r as never)}`).toBe(
          'INVALID_BOARD',
        )
      }
      const persona = await llamar(
        clienteDe('owner'),
        'save_employee_week_board',
        {
          p_employee_id: INEXISTENTE,
          p_blocks: [],
        },
      )
      expect(codigo(persona)).toBe('EMPLOYEE_NOT_FOUND')
      expect(await pizarraDe(T.emp)).toBeNull()
    })

    for (const perfil of ADMINS) {
      it(`[${ETIQUETA[perfil]}] guarda la pizarra (reemplaza todo), la lee con quién y cuándo, y NO toca turnos ni asignaciones (RB-A05, OH-07)`, async () => {
        const antes = await asignadosDe(T.l3)
        const r = await llamar(clienteDe(perfil), 'save_employee_week_board', {
          p_employee_id: T.emp,
          p_blocks: [
            bloque({ id: `${P}${perfil}` }),
            bloque({ id: `${P}${perfil}-2`, weekday: 0, end: null }),
          ],
        })
        expect(codigo(r), describir(r as never)).toBe('OK')
        const guardada = json(r)
        expect(guardada.employee_id).toBe(T.emp)
        expect((guardada.blocks as unknown[]).length).toBe(2)
        const leer = await llamar(
          clienteDe(perfil),
          'get_employee_week_board',
          {
            p_employee_id: T.emp,
          },
        )
        expect(codigo(leer)).toBe('OK')
        expect(json(leer).updated_by).toBe(idDe(perfil as PerfilConSesion))
        expect(json(leer).updated_at).toBeTruthy()
        expect(await asignadosDe(T.l3)).toEqual(antes)
      })
    }

    for (const perfil of TODOS) {
      it(`[${ETIQUETA[perfil]}] no escribe la tabla employee_week_boards por PostgREST: insertar, editar y borrar dan 42501 (RB-X02, CB-17, OH-07)`, async () => {
        const cliente = clienteDe(perfil)
        const insertar = await tabla(cliente, 'employee_week_boards').insert({
          employee_id: T.fijo,
          blocks: [],
        })
        expect(codigo(insertar as never), describir(insertar)).toBe('42501')
        const editar = await tabla(cliente, 'employee_week_boards')
          .update({ blocks: [] })
          .eq('employee_id', T.emp)
        expect(codigo(editar as never), describir(editar)).toBe('42501')
        const borrar = await tabla(cliente, 'employee_week_boards')
          .delete()
          .eq('employee_id', T.emp)
        expect(codigo(borrar as never), describir(borrar)).toBe('42501')
        expect(await pizarraDe(T.fijo)).toBeNull()
        expect((await pizarraDe(T.emp))?.blocks).toHaveLength(2)
      })
    }

    for (const perfil of ADMINS) {
      it(`[${ETIQUETA[perfil]}] lee la tabla employee_week_boards (RLS de lectura de la administración) (RB-A05, OH-07)`, async () => {
        const r = await tabla(clienteDe(perfil), 'employee_week_boards')
          .select('employee_id, blocks')
          .eq('employee_id', T.emp)
        expect(r.error, describir(r)).toBeNull()
        expect(filas(r)).toHaveLength(1)
      })
    }

    for (const perfil of [...SIN_ADMIN, 'anon'] as Perfil[]) {
      it(`[${ETIQUETA[perfil]}] no lee la tabla employee_week_boards: cero filas o error de permisos (RB-X02, CB-15, OH-07)`, async () => {
        const r = await tabla(clienteDe(perfil), 'employee_week_boards').select(
          'employee_id',
        )
        expect(filas(r), describir(r)).toHaveLength(0)
      })
    }
  })

  // -----------------------------------------------------------------------------------------------
  // 5. register_past_shift (OH-09)
  // -----------------------------------------------------------------------------------------------
  describe('register_past_shift (OH-09)', () => {
    const PASADO = daysFromToday(-12)
    const argsPasado = (extra: Record<string, unknown> = {}) => ({
      p_client_id: T.cliente,
      p_site_id: T.sede,
      p_date: PASADO,
      p_start: '08:00',
      p_end: '10:00',
      p_employee_ids: [T.fijo],
      ...extra,
    })

    for (const perfil of [...SIN_ADMIN, 'adminSin'] as Perfil[]) {
      it(`[${ETIQUETA[perfil]}] FORBIDDEN (hace falta ser de la dirección o de la administración con «Gestionar asistencia») y no se crea el turno (RB-X02, CB-17, OH-09)`, async () => {
        const antes = await turnosDeLaSede()
        const r = await llamar(
          clienteDe(perfil),
          'register_past_shift',
          argsPasado(),
        )
        expect(codigo(r), describir(r as never)).toBe('FORBIDDEN')
        expect(await turnosDeLaSede()).toEqual(antes)
      })
    }

    it('[anon] 42501 y no se crea nada (RB-X02, OH-09)', async () => {
      const antes = await turnosDeLaSede()
      const r = await llamar(
        clienteDe('anon'),
        'register_past_shift',
        argsPasado(),
      )
      expect(codigo(r)).toBe('42501')
      expect(await turnosDeLaSede()).toEqual(antes)
    })

    it('errores propios: SHIFT_NOT_PAST, INVALID_TIME_RANGE y EMPLOYEES_REQUIRED, sin crear nada (OH-09)', async () => {
      const antes = await turnosDeLaSede()
      const dueno = clienteDe('owner')
      const futuro = await llamar(
        dueno,
        'register_past_shift',
        argsPasado({ p_date: daysFromToday(5) }),
      )
      expect(codigo(futuro)).toBe('SHIFT_NOT_PAST')
      const rango = await llamar(
        dueno,
        'register_past_shift',
        argsPasado({ p_start: '10:00', p_end: '08:00' }),
      )
      expect(codigo(rango)).toBe('INVALID_TIME_RANGE')
      const sinGente = await llamar(
        dueno,
        'register_past_shift',
        argsPasado({ p_employee_ids: [] }),
      )
      expect(codigo(sinGente)).toBe('EMPLOYEES_REQUIRED')
      expect(await turnosDeLaSede()).toEqual(antes)
    })

    it('todo o nada: si una persona no se puede asignar no queda ni el turno ni la asistencia (OH-09)', async () => {
      const antes = await turnosDeLaSede()
      const r = await llamar(
        clienteDe('owner'),
        'register_past_shift',
        argsPasado({ p_employee_ids: [T.fijo, INEXISTENTE] }),
      )
      expect(
        r.error,
        'la asignación de una persona inexistente falla',
      ).not.toBeNull()
      expect(await turnosDeLaSede()).toEqual(antes)
    })

    CON_ASISTENCIA.forEach((perfil, i) => {
      it(`[${ETIQUETA[perfil]}] crea el turno, asigna y carga inicio y fin con «Carga posterior» a su nombre (RB-A04, RB-A06, RB-A08, OH-09)`, async () => {
        // Un día distinto por perfil (la persona no puede estar dos veces en el mismo horario).
        const fecha = daysFromToday(-12 - 3 * (i + 1))
        const r = await llamar(
          clienteDe(perfil),
          'register_past_shift',
          argsPasado({ p_date: fecha }),
        )
        expect(codigo(r), describir(r as never)).toBe('OK')
        const j = json(r)
        const turnoId = (j.shift as { id: string }).id
        expect((j.shift as { status: string }).status).toBe('completed')
        expect((j.attendance as unknown[]).length).toBe(1)
        const { data: asig } = await db()
          .from('assignments')
          .select('id, employee_id')
          .eq('shift_id', turnoId)
          .is('removed_at', null)
        expect(asig?.map((a) => a.employee_id)).toEqual([T.fijo])
        const { data: fichajes } = await db()
          .from('attendance_records')
          .select('kind, reason, recorded_by')
          .eq('assignment_id', asig![0].id)
          .order('recorded_at')
        expect(fichajes?.map((f) => f.kind)).toEqual(['check_in', 'check_out'])
        expect(fichajes?.every((f) => f.reason === 'Carga posterior')).toBe(
          true,
        )
        expect(
          fichajes?.every(
            (f) => f.recorded_by === idDe(perfil as PerfilConSesion),
          ),
          'quién lo cargó',
        ).toBe(true)
      })
    })
  })

  // -----------------------------------------------------------------------------------------------
  // 6. create_shift con un servicio que ya tiene turno ese día (OH-10)
  // -----------------------------------------------------------------------------------------------
  describe('create_shift: SHIFT_DATE_TAKEN con el turno existente (OH-10)', () => {
    const FECHA = `${MES_FIJOS}-10`

    ADMINS.forEach((perfil) => {
      it(`[${ETIQUETA[perfil]}] el servicio ya tiene turno ese día: SHIFT_DATE_TAKEN y el detalle trae el turno y sus asignados, sin crear un segundo (RB-A04, OH-10)`, async () => {
        const antes = await turnosDeLaSede()
        const r = await llamar(clienteDe(perfil), 'create_shift', {
          p_client_id: T.cliente,
          p_site_id: T.sede,
          p_date: FECHA,
          p_start: '15:00',
          p_end: '17:00',
          p_required_staff: 1,
          p_service_id: T.servicioFijo,
        })
        expect(codigo(r), describir(r as never)).toBe('SHIFT_DATE_TAKEN')
        const detalle = JSON.parse(String(r.error?.details ?? '{}')) as {
          shift_id?: string
          assigned?: Array<{ employee_id: string }>
          code?: string
          start_time?: string
        }
        expect(detalle.shift_id).toBe(T.turnoFijo)
        expect(detalle.code).toBe('SHIFT_DATE_TAKEN')
        expect(detalle.assigned?.map((a) => a.employee_id)).toEqual([T.fijo])
        expect(String(detalle.start_time).slice(0, 5)).toBe('09:00')
        expect(await turnosDeLaSede()).toEqual(antes)
      })
    })

    for (const perfil of [...SIN_ADMIN, 'anon'] as Perfil[]) {
      it(`[${ETIQUETA[perfil]}] no crea turnos con create_shift (FORBIDDEN / 42501) (RB-X02, CB-17, OH-10)`, async () => {
        const r = await llamar(clienteDe(perfil), 'create_shift', {
          p_client_id: T.cliente,
          p_site_id: T.sede,
          p_date: FECHA,
          p_start: '15:00',
          p_end: '17:00',
          p_required_staff: 1,
          p_service_id: T.servicioFijo,
        })
        expect(codigo(r)).toBe(perfil === 'anon' ? '42501' : 'FORBIDDEN')
      })
    }
  })

  // -----------------------------------------------------------------------------------------------
  // 7. apply_service_changes: gana el último cambio (OH-11)
  // -----------------------------------------------------------------------------------------------
  describe('apply_service_changes: el último cambio gana (OH-11)', () => {
    const FECHAS = [`${anio}-04-06`, `${anio}-04-07`, `${anio}-04-08`]

    it('prepara: un servicio de 08:00 a 12:00 con tres turnos, el del medio con el horario cambiado a mano', async () => {
      T.servicioGana = await insertar(
        db()
          .from('services')
          .insert({
            client_id: T.cliente,
            site_id: T.sede,
            name: `${P}gana-${sfx()}`,
            weekdays: [0, 1, 2, 3, 4, 5, 6],
            start_time: '07:00',
            end_time: '12:00',
            required_staff: 1,
            valid_from: `${anio}-04-01`,
            status: 'active',
          })
          .select('id')
          .single(),
        'servicio',
      )
      T.ganaTurnos = ''
      const ids: string[] = []
      for (const f of FECHAS) {
        ids.push(
          await turno(f, '08:00', '12:00', {
            service_id: T.servicioGana,
            required_staff: 1,
            generated: true,
          }),
        )
      }
      T.ganaTurnos = ids.join(',')
      await db()
        .from('shifts')
        .update({ start_time: '09:30:00' })
        .eq('id', ids[1])
      // El servicio ya está guardado con 07:00 (el «antes» era 08:00).
    })

    for (const perfil of [...SIN_ADMIN, 'anon'] as Perfil[]) {
      it(`[${ETIQUETA[perfil]}] no aplica cambios al servicio (FORBIDDEN / 42501) y los turnos quedan como estaban (RB-X02, CB-17, OH-11)`, async () => {
        const r = await llamar(clienteDe(perfil), 'apply_service_changes', {
          p_service_id: T.servicioGana,
          p_from_date: `${anio}-04-01`,
          p_previous: { start_time: '08:00', end_time: '12:00' },
        })
        expect(codigo(r)).toBe(perfil === 'anon' ? '42501' : 'FORBIDDEN')
        const { data } = await db()
          .from('shifts')
          .select('start_time')
          .in('id', T.ganaTurnos.split(','))
        expect(data?.map((t) => t.start_time.slice(0, 5)).sort()).toEqual([
          '08:00',
          '08:00',
          '09:30',
        ])
      })
    }

    it('[dueño] la vista previa cuenta el turno cambiado a mano como «overridden» y no escribe nada (RB-A04, OH-11)', async () => {
      const r = await llamar(clienteDe('owner'), 'preview_service_changes', {
        p_service_id: T.servicioGana,
        p_from_date: `${anio}-04-01`,
        p_previous: {
          start_time: '08:00',
          end_time: '12:00',
          open_ended: false,
        },
        p_create_missing: false,
      })
      expect(codigo(r), describir(r as never)).toBe('OK')
      const j = json(r)
      expect(j.preview).toBe(true)
      expect(j.updated_count).toBe(3)
      expect(j.overridden_count).toBe(1)
      const { data } = await db()
        .from('shifts')
        .select('start_time')
        .in('id', T.ganaTurnos.split(','))
      expect(data?.map((t) => t.start_time.slice(0, 5)).sort()).toEqual([
        '08:00',
        '08:00',
        '09:30',
      ])
    })

    it('[administrador sin capacidades] aplicar actualiza TODOS los turnos, también el cambiado a mano (RB-A04, OH-11)', async () => {
      const r = await llamar(clienteDe('adminSin'), 'apply_service_changes', {
        p_service_id: T.servicioGana,
        p_from_date: `${anio}-04-01`,
        p_previous: {
          start_time: '08:00',
          end_time: '12:00',
          open_ended: false,
        },
        p_create_missing: false,
      })
      expect(codigo(r), describir(r as never)).toBe('OK')
      expect(json(r).updated_count).toBe(3)
      expect(json(r).overridden_count).toBe(1)
      const { data } = await db()
        .from('shifts')
        .select('start_time')
        .in('id', T.ganaTurnos.split(','))
      expect(
        data?.map((t) => t.start_time.slice(0, 5)),
        'los tres toman el horario del servicio',
      ).toEqual(['07:00', '07:00', '07:00'])
    })
  })
})
