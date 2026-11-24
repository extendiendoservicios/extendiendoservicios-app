// tests/permissions/suite/104-p31.permissions.ts — P31.6 (observaciones de la dirección del 23 nov, migración 0088)
//
// Lo nuevo de la 0088 por API directa con `supabase-js`, contra App_dev y con DATOS REALES. Por rol
// (dueño, administrador con todas las capacidades, administrador sin capacidades, coordinador, doble
// rol, empleado y anon):
//   1. `employee_calendar_notes` y sus RPC (D-08): solo dueño y administradores leen y escriben
//      (`save_employee_calendar_note`, `delete_employee_calendar_note`, `list_employee_calendar_notes`);
//      el empleado y el coordinador reciben cero filas o FORBIDDEN; nadie escribe la tabla directo.
//   2. `v_supervisor_upcoming` (D-09): solo el coordinador; de mañana a hoy + 7, sin cancelados.
//   3. `v_assignments_board` (D-10): `supervision_state` y `supervisor_name` nulos para quien no es
//      dueño ni administrador.
//   4. `update_shift_time` sobre un turno finalizado (D-07): coordinador y empleado rechazados; dueño
//      y administradores cambian la franja y las horas se recalculan; la fecha no se cambia.
//   5. `p_geo_reason` (D-14): `INVALID_GEO_REASON` con un texto que no es motivo técnico, en
//      `record_check_in`, `record_check_out`, `take_supervision` y `complete_supervision`; con un
//      motivo válido sin coordenadas se guarda; con coordenadas se ignora.
// Todo con el prefijo `e2e-perm-p31-`; lo que se crea se borra en `afterAll`.

import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { daysFromToday, isTooCloseToMidnight } from '../../fixtures/dates.ts'
import { borrarJornadasDe, deleteClientDeep } from '../../fixtures/scenario.ts'
import { describir, filas, tabla } from './ayudas.ts'
import { clienteDe, contexto, servicio, type Db } from './contexto.ts'
import { cuitUnico, PREFIJO } from './escenario.ts'
import { ETIQUETA, type Perfil } from './perfiles.ts'

const P = `${PREFIJO}p31-`
const sfx = () => randomBytes(3).toString('hex')

const SIN_ADMIN: Perfil[] = ['empleado', 'supervisor', 'dual']
const ADMINS: Perfil[] = ['adminSin', 'admin', 'owner']
const TODOS: Perfil[] = [...SIN_ADMIN, ...ADMINS, 'anon']
const CERCA_DE_MEDIANOCHE = isTooCloseToMidnight()

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

/** `OK`, `42501` (sin permiso de ejecución) o el `hint` estable de la RPC. */
function codigo(res: Resp): string {
  if (!res.error) return 'OK'
  return res.error.code === '42501'
    ? '42501'
    : (res.error.hint ?? res.error.code ?? 'ERROR')
}

/** Lo que tiene que dar una RPC de administración según el perfil. */
const soloAdmin = (perfil: Perfil) =>
  perfil === 'anon' ? '42501' : ADMINS.includes(perfil) ? 'OK' : 'FORBIDDEN'

const json = (res: Resp) => (res.data ?? {}) as Record<string, unknown>
const lista = (res: Resp) =>
  (Array.isArray(res.data) ? res.data : []) as Array<Record<string, unknown>>

const INEXISTENTE = '00000000-0000-4000-8000-0000000000bb'
/** Obelisco, CABA: la sede con coordenadas de este archivo. */
const SEDE = { lat: -34.6037, lng: -58.3816 }

describe('lote P31.1 (0088): permisos de lo nuevo con datos reales', () => {
  const db = () => servicio()
  const c = () => contexto()
  const T: Record<string, string> = {}
  const hoy = daysFromToday(0)

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
    sede: string,
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
          site_id: sede,
          shift_date: fecha,
          start_time: ini,
          end_time: fin,
          required_staff: 1,
          ...extra,
        })
        .select('id')
        .single(),
      `turno ${fecha} ${ini}`,
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

  async function notasDe(empleado: string) {
    const { data } = await db()
      .from('employee_calendar_notes')
      .select('id, body, color, note_date, deleted_at, created_by, updated_by')
      .eq('employee_id', empleado)
      .like('body', `${P}%`)
      .order('created_at')
    return data ?? []
  }

  /** Minutos trabajados de una asignación, con la sesión del dueño (la vista es de administración). */
  async function minutos(asignacion: string): Promise<number> {
    const { data } = await clienteDe('owner')
      .from('v_assignments_board')
      .select('worked_minutes')
      .eq('id', asignacion)
      .single()
    return Number(data?.worked_minutes ?? -1)
  }

  beforeAll(async () => {
    const nombre = `${P}cli-${sfx()}`
    T.cliente = await insertar(
      db()
        .from('clients')
        .insert({ legal_name: nombre, trade_name: nombre, cuit: cuitUnico() })
        .select('id')
        .single(),
      'cliente',
    )
    T.sede = await insertar(
      db()
        .from('sites')
        .insert({
          client_id: T.cliente,
          name: `${P}sede-geo-${sfx()}`,
          address: 'Calle de prueba 1',
          latitude: SEDE.lat,
          longitude: SEDE.lng,
          geofence_radius_m: 100,
        })
        .select('id')
        .single(),
      'sede con coordenadas',
    )
    T.sedeSin = await insertar(
      db()
        .from('sites')
        .insert({
          client_id: T.cliente,
          name: `${P}sede-sin-${sfx()}`,
          address: 'Calle de prueba 2',
        })
        .select('id')
        .single(),
      'sede sin coordenadas',
    )
  })

  afterAll(async () => {
    const notas: string[] = []
    const nota = (que: string, error: { message: string } | null) => {
      if (error) notas.push(`${que}: ${error.message}`)
    }
    nota(
      'observaciones',
      (
        await db()
          .from('employee_calendar_notes')
          .delete()
          .like('body', `${P}%`)
      ).error,
    )
    // Las jornadas del coordinador de hoy (take_supervision las exige) y las prioridades.
    notas.push(
      ...(await borrarJornadasDe(
        db(),
        [c().ids.supervisor1, c().ids.dual],
        hoy,
      )),
    )
    if (T.sede) {
      nota(
        'prioridades',
        (
          await db()
            .from('supervisor_priorities')
            .delete()
            .eq('site_id', T.sede)
        ).error,
      )
    }
    if (T.cliente) notas.push(...(await deleteClientDeep(db(), T.cliente)))
    if (notas.length) {
      console.warn(`[104-p31] limpieza con notas: ${notas.join('; ')}`)
    }
  })

  // -----------------------------------------------------------------------------------------------
  // 1. employee_calendar_notes y sus RPC (D-08)
  // -----------------------------------------------------------------------------------------------
  describe('observaciones del calendario del empleado (D-08)', () => {
    const FECHA = daysFromToday(5)
    const args = (extra: Record<string, unknown> = {}) => ({
      p_note_id: null,
      p_employee_id: c().ids.empleado4,
      p_date: FECHA,
      p_body: `${P}observación`,
      p_color: null,
      ...extra,
    })

    it('prepara: una observación propia (con la clave de servicio)', async () => {
      T.nota = await insertar(
        db()
          .from('employee_calendar_notes')
          .insert({
            employee_id: c().ids.empleado4,
            note_date: FECHA,
            body: `${P}sembrada`,
            color: 1,
          })
          .select('id')
          .single(),
        'observación sembrada',
      )
    })

    for (const perfil of TODOS) {
      it(`[${ETIQUETA[perfil]}] ${ADMINS.includes(perfil) ? 've la observación' : 'no ve ninguna fila (anon: 42501)'} (RB-X02, CB-17, D-08)`, async () => {
        const res = await tabla(clienteDe(perfil), 'employee_calendar_notes')
          .select('id, body')
          .eq('employee_id', c().ids.empleado4)
        if (perfil === 'anon') {
          expect(res.error?.code, describir(res)).toBe('42501')
        } else if (ADMINS.includes(perfil)) {
          expect(res.error, describir(res)).toBeNull()
          expect(filas(res).map((f) => f.id)).toContain(T.nota)
        } else {
          expect(res.error, describir(res)).toBeNull()
          expect(filas(res), describir(res)).toEqual([])
        }
      })
    }

    for (const perfil of TODOS) {
      it(`[${ETIQUETA[perfil]}] no inserta, no edita y no borra directo: 42501 y la observación queda igual (RB-X02, CB-17, D-08)`, async () => {
        const cliente = clienteDe(perfil)
        const insertar = await tabla(cliente, 'employee_calendar_notes').insert(
          {
            employee_id: c().ids.empleado4,
            note_date: FECHA,
            body: `${P}directa`,
          },
        )
        expect(codigo(insertar as never), describir(insertar)).toBe('42501')
        const editar = await tabla(cliente, 'employee_calendar_notes')
          .update({ body: `${P}editada` })
          .eq('id', T.nota)
        expect(codigo(editar as never), describir(editar)).toBe('42501')
        const borrar = await tabla(cliente, 'employee_calendar_notes')
          .delete()
          .eq('id', T.nota)
        expect(codigo(borrar as never), describir(borrar)).toBe('42501')
        const despues = await notasDe(c().ids.empleado4)
        expect(despues.map((n) => [n.id, n.body, n.deleted_at])).toEqual([
          [T.nota, `${P}sembrada`, null],
        ])
      })
    }

    for (const perfil of TODOS.filter((p) => !ADMINS.includes(p))) {
      it(`[${ETIQUETA[perfil]}] save, delete y list son FORBIDDEN (anon: 42501) y no cambian nada (RB-X02, CB-17, D-08)`, async () => {
        const esperado = soloAdmin(perfil)
        const cliente = clienteDe(perfil)
        expect(
          codigo(await llamar(cliente, 'save_employee_calendar_note', args())),
        ).toBe(esperado)
        expect(
          codigo(
            await llamar(
              cliente,
              'save_employee_calendar_note',
              args({ p_note_id: T.nota, p_body: `${P}pisada` }),
            ),
          ),
        ).toBe(esperado)
        expect(
          codigo(
            await llamar(cliente, 'delete_employee_calendar_note', {
              p_note_id: T.nota,
            }),
          ),
        ).toBe(esperado)
        expect(
          codigo(
            await llamar(cliente, 'list_employee_calendar_notes', {
              p_employee_id: c().ids.empleado4,
              p_from: FECHA,
              p_to: FECHA,
            }),
          ),
        ).toBe(esperado)
        const despues = await notasDe(c().ids.empleado4)
        expect(despues.map((n) => [n.id, n.body, n.deleted_at])).toEqual([
          [T.nota, `${P}sembrada`, null],
        ])
      })
    }

    it('[dueño] guarda, cambia, lista y da de baja (baja lógica); queda quién la cargó (D-08)', async () => {
      const dueno = clienteDe('owner')
      const alta = await llamar(dueno, 'save_employee_calendar_note', args())
      expect(codigo(alta), describir(alta as never)).toBe('OK')
      const nueva = json(alta)
      expect(nueva.created_by).toBe(c().ids.owner)
      expect(nueva.color).toBeNull()

      const cambio = await llamar(
        dueno,
        'save_employee_calendar_note',
        args({
          p_note_id: nueva.id,
          p_body: `  ${P}observación cambiada  `,
          p_color: 7,
        }),
      )
      expect(codigo(cambio), describir(cambio as never)).toBe('OK')
      expect(json(cambio).body).toBe(`${P}observación cambiada`)
      expect(json(cambio).color).toBe(7)

      const listada = await llamar(dueno, 'list_employee_calendar_notes', {
        p_employee_id: c().ids.empleado4,
        p_from: FECHA,
        p_to: FECHA,
      })
      expect(codigo(listada), describir(listada as never)).toBe('OK')
      const delDia = lista(listada).filter((n) => String(n.body).startsWith(P))
      expect(delDia.map((n) => n.id)).toEqual(
        expect.arrayContaining([T.nota, nueva.id]),
      )
      expect(delDia.every((n) => n.note_date === FECHA)).toBe(true)

      const baja = await llamar(dueno, 'delete_employee_calendar_note', {
        p_note_id: nueva.id,
      })
      expect(codigo(baja), describir(baja as never)).toBe('OK')
      expect(json(baja).deleted_at).not.toBeNull()
      const otra = await llamar(dueno, 'delete_employee_calendar_note', {
        p_note_id: nueva.id,
      })
      expect(codigo(otra)).toBe('NOTE_NOT_FOUND')
      const despues = await llamar(dueno, 'list_employee_calendar_notes', {
        p_employee_id: c().ids.empleado4,
        p_from: FECHA,
        p_to: FECHA,
      })
      expect(lista(despues).map((n) => n.id)).not.toContain(nueva.id)
    })

    for (const perfil of ['adminSin', 'admin'] as const) {
      it(`[${ETIQUETA[perfil]}] también guarda y da de baja, sin ninguna capacidad extra (D-08)`, async () => {
        const cliente = clienteDe(perfil)
        const alta = await llamar(
          cliente,
          'save_employee_calendar_note',
          args({ p_body: `${P}de ${perfil}` }),
        )
        expect(codigo(alta), describir(alta as never)).toBe('OK')
        const baja = await llamar(cliente, 'delete_employee_calendar_note', {
          p_note_id: json(alta).id,
        })
        expect(codigo(baja), describir(baja as never)).toBe('OK')
      })
    }

    it('[dueño] las validaciones dan su código y no guardan nada (D-08)', async () => {
      const dueno = clienteDe('owner')
      const antes = (await notasDe(c().ids.empleado4)).length
      const caso = async (extra: Record<string, unknown>) =>
        codigo(await llamar(dueno, 'save_employee_calendar_note', args(extra)))
      expect(await caso({ p_body: '   ' })).toBe('INVALID_NOTE_BODY')
      expect(await caso({ p_body: 'x'.repeat(501) })).toBe('INVALID_NOTE_BODY')
      expect(await caso({ p_color: 12 })).toBe('INVALID_COLOR')
      expect(await caso({ p_color: -1 })).toBe('INVALID_COLOR')
      expect(await caso({ p_date: null })).toBe('INVALID_DATE')
      expect(await caso({ p_employee_id: INEXISTENTE })).toBe(
        'EMPLOYEE_NOT_FOUND',
      )
      expect(await caso({ p_note_id: INEXISTENTE })).toBe('NOTE_NOT_FOUND')
      expect(
        codigo(
          await llamar(dueno, 'list_employee_calendar_notes', {
            p_employee_id: c().ids.empleado4,
            p_from: FECHA,
            p_to: daysFromToday(-30),
          }),
        ),
      ).toBe('INVALID_DATE_RANGE')
      expect(
        codigo(
          await llamar(dueno, 'list_employee_calendar_notes', {
            p_employee_id: c().ids.empleado4,
            p_from: FECHA,
            p_to: daysFromToday(500),
          }),
        ),
      ).toBe('INVALID_DATE_RANGE')
      expect(
        codigo(
          await llamar(dueno, 'delete_employee_calendar_note', {
            p_note_id: INEXISTENTE,
          }),
        ),
      ).toBe('NOTE_NOT_FOUND')
      expect((await notasDe(c().ids.empleado4)).length).toBe(antes)
    })

    it('[dueño] no cambia la observación de otra persona con el id de la ajena: NOTE_NOT_FOUND (D-08)', async () => {
      const r = await llamar(
        clienteDe('owner'),
        'save_employee_calendar_note',
        args({ p_note_id: T.nota, p_employee_id: c().ids.empleado3 }),
      )
      expect(codigo(r)).toBe('NOTE_NOT_FOUND')
      const despues = await notasDe(c().ids.empleado4)
      expect(despues.find((n) => n.id === T.nota)?.body).toBe(`${P}sembrada`)
    })
  })

  // -----------------------------------------------------------------------------------------------
  // 2. v_supervisor_upcoming (D-09)
  // -----------------------------------------------------------------------------------------------
  describe('próximos turnos del coordinador: v_supervisor_upcoming (D-09)', () => {
    const MANANA = daysFromToday(1)
    const EN7 = daysFromToday(7)

    it('prepara: turnos de mañana, hoy + 7 (entran) y de hoy, hoy + 8 y uno cancelado (no entran)', async () => {
      T.upcManana = await turno(T.sede, MANANA, '08:00', '12:00')
      T.upcEn7 = await turno(T.sedeSin, EN7, '08:00', '12:00')
      T.upcHoy = await turno(T.sede, hoy, '20:00', '22:00')
      T.upcEn8 = await turno(T.sede, daysFromToday(8), '08:00', '12:00')
      T.upcCancelado = await turno(T.sede, MANANA, '14:00', '16:00')
      const { error } = await db()
        .from('shifts')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancelled_by: c().ids.owner,
          cancel_reason: `${P}cancelado`,
        })
        .eq('id', T.upcCancelado)
      expect(error, error?.message).toBeNull()
      T.prioridad = await insertar(
        db()
          .from('supervisor_priorities')
          .insert({
            supervisor_id: c().ids.supervisor1,
            site_id: T.sede,
            created_by: c().ids.owner,
          })
          .select('id')
          .single(),
        'preferencia',
      )
    })

    const propios = () => [
      T.upcManana,
      T.upcEn7,
      T.upcHoy,
      T.upcEn8,
      T.upcCancelado,
    ]

    for (const perfil of TODOS) {
      const ve = perfil === 'supervisor' || perfil === 'dual'
      it(`[${ETIQUETA[perfil]}] ${ve ? 've mañana y hoy + 7, y no hoy, hoy + 8 ni el cancelado' : perfil === 'anon' ? 'no lee la vista (42501)' : 'obtiene cero filas'} (RB-X02, CB-17, D-09)`, async () => {
        const res = await tabla(clienteDe(perfil), 'v_supervisor_upcoming')
          .select('shift_id, shift_date, is_priority, priority_kind')
          .in('shift_id', propios())
        if (perfil === 'anon') {
          expect(res.error?.code, describir(res)).toBe('42501')
          return
        }
        expect(res.error, describir(res)).toBeNull()
        if (!ve) {
          expect(filas(res), describir(res)).toEqual([])
          return
        }
        const ids = filas(res).map((f) => f.shift_id)
        expect(ids.sort()).toEqual([T.upcManana, T.upcEn7].sort())
        const mia = filas(res).find((f) => f.shift_id === T.upcManana)
        // «Mis sedes»: solo el coordinador con la preferencia de esa sede.
        expect(mia?.is_priority).toBe(perfil === 'supervisor')
        expect(mia?.priority_kind).toBe(perfil === 'supervisor' ? 'site' : null)
      })
    }

    for (const perfil of TODOS) {
      it(`[${ETIQUETA[perfil]}] la vista es de solo lectura: insert, update y delete fallan (RB-X02, D-09)`, async () => {
        const cliente = clienteDe(perfil)
        const insertar = await tabla(cliente, 'v_supervisor_upcoming').insert({
          shift_id: INEXISTENTE,
        })
        expect(insertar.error, describir(insertar)).not.toBeNull()
        const editar = await tabla(cliente, 'v_supervisor_upcoming')
          .update({ site_name: 'x' })
          .eq('shift_id', T.upcManana)
        expect(denegadoOSinFilas(editar), describir(editar)).toBe(true)
        const borrar = await tabla(cliente, 'v_supervisor_upcoming')
          .delete()
          .eq('shift_id', T.upcManana)
        expect(denegadoOSinFilas(borrar), describir(borrar)).toBe(true)
        const { data } = await db()
          .from('shifts')
          .select('id')
          .eq('id', T.upcManana)
        expect(data).toHaveLength(1)
      })
    }
  })

  // -----------------------------------------------------------------------------------------------
  // 3. v_assignments_board: supervisión solo para la administración (D-10)
  // -----------------------------------------------------------------------------------------------
  describe('v_assignments_board: supervision_state y supervisor_name (D-10)', () => {
    const FECHA = daysFromToday(2)

    it('prepara: dos turnos con la misma persona asignada; uno ya supervisado por supervisor1', async () => {
      T.tableroUno = await turno(T.sede, FECHA, '08:00', '10:00')
      T.tableroDos = await turno(T.sede, FECHA, '11:00', '12:00')
      T.asigUno = await asignar(T.tableroUno, c().ids.empleado1)
      T.asigDos = await asignar(T.tableroDos, c().ids.empleado1)
      const sup = await insertar(
        db()
          .from('supervisions')
          .insert({
            shift_id: T.tableroUno,
            supervisor_id: c().ids.supervisor1,
            status: 'completed',
            general_notes: `${P}supervisada`,
            criteria_snapshot: [],
          })
          .select('id')
          .single(),
        'supervisión',
      )
      const { error } = await db()
        .from('supervision_attendance')
        .insert([
          {
            supervision_id: sup,
            kind: 'check_in',
            recorded_at: `${FECHA}T08:10:00-03:00`,
          },
          {
            supervision_id: sup,
            kind: 'check_out',
            recorded_at: `${FECHA}T08:50:00-03:00`,
          },
        ])
      expect(error, error?.message).toBeNull()
    })

    for (const perfil of TODOS) {
      it(`[${ETIQUETA[perfil]}] ${ADMINS.includes(perfil) ? 've «Supervisado» y «Sin supervisión» con el nombre del coordinador' : perfil === 'anon' ? 'no lee la vista (42501)' : 'las columnas de supervisión son nulas en todas sus filas'} (RB-X02, CB-17, D-10)`, async () => {
        const res = await tabla(clienteDe(perfil), 'v_assignments_board')
          .select('id, supervision_state, supervisor_name')
          .in('id', [T.asigUno, T.asigDos])
        if (perfil === 'anon') {
          expect(res.error?.code, describir(res)).toBe('42501')
          return
        }
        expect(res.error, describir(res)).toBeNull()
        const porId = new Map(filas(res).map((f) => [f.id, f]))
        if (ADMINS.includes(perfil)) {
          expect(porId.get(T.asigUno)?.supervision_state).toBe('done')
          expect(String(porId.get(T.asigUno)?.supervisor_name)).toContain(
            'Supervisor',
          )
          expect(porId.get(T.asigDos)?.supervision_state).toBe('none')
          expect(porId.get(T.asigDos)?.supervisor_name).toBeNull()
          return
        }
        // Quien no es administración: o no lee ninguna fila de esta vista (hoy es lo que pasa: la
        // vista es de administración) o, si alguna vez lee la propia, no trae datos de supervisión.
        for (const fila of filas(res)) {
          expect(fila.supervision_state, JSON.stringify(fila)).toBeNull()
          expect(fila.supervisor_name, JSON.stringify(fila)).toBeNull()
        }
      })
    }
  })

  // -----------------------------------------------------------------------------------------------
  // 4. update_shift_time sobre un turno finalizado (D-07)
  // -----------------------------------------------------------------------------------------------
  describe('update_shift_time de un turno finalizado (D-07)', () => {
    const FECHA = daysFromToday(-3)
    const franja = async () => {
      const { data } = await db()
        .from('shifts')
        .select('status, start_time, end_time, shift_date, updated_by')
        .eq('id', T.finalizado)
        .single()
      return data!
    }
    const cambiar = (
      perfil: Perfil,
      ini: string,
      fin: string,
      extra: Record<string, unknown> = {},
    ) =>
      llamar(clienteDe(perfil), 'update_shift_time', {
        p_shift_id: T.finalizado,
        p_start: ini,
        p_end: fin,
        ...extra,
      })

    it('prepara: turno finalizado de 10:30 a 14:30 con fichaje de 10:02 a 14:56 (240 min)', async () => {
      T.finalizado = await turno(T.sede, FECHA, '10:30', '14:30')
      T.asigFinal = await asignar(T.finalizado, c().ids.empleado1)
      const { error } = await db()
        .from('attendance_records')
        .insert([
          {
            assignment_id: T.asigFinal,
            kind: 'check_in',
            recorded_at: `${FECHA}T10:02:00-03:00`,
            source: 'admin',
            reason: `${P}historia`,
          },
          {
            assignment_id: T.asigFinal,
            kind: 'check_out',
            recorded_at: `${FECHA}T14:56:00-03:00`,
            source: 'admin',
            reason: `${P}historia`,
          },
        ])
      expect(error, error?.message).toBeNull()
      await db()
        .from('assignments')
        .update({ status: 'finished' })
        .eq('id', T.asigFinal)
      await db()
        .from('shifts')
        .update({ status: 'completed' })
        .eq('id', T.finalizado)
      expect(await minutos(T.asigFinal)).toBe(240)
    })

    for (const perfil of [...SIN_ADMIN, 'anon'] as Perfil[]) {
      it(`[${ETIQUETA[perfil]}] no cambia el horario del finalizado: ${perfil === 'anon' ? '42501' : 'FORBIDDEN'} y todo queda igual (RB-X02, CB-17, D-07)`, async () => {
        const res = await cambiar(perfil, '10:00', '15:00')
        expect(codigo(res), describir(res as never)).toBe(soloAdmin(perfil))
        const f = await franja()
        expect([f.status, f.start_time, f.end_time]).toEqual([
          'completed',
          '10:30:00',
          '14:30:00',
        ])
        expect(await minutos(T.asigFinal)).toBe(240)
      })
    }

    it('[dueño] cambia la franja a 10:00–15:00: sigue finalizado y las horas pasan a 294 min (D-07)', async () => {
      const res = await cambiar('owner', '10:00', '15:00')
      expect(codigo(res), describir(res as never)).toBe('OK')
      const f = await franja()
      expect([f.status, f.start_time, f.end_time]).toEqual([
        'completed',
        '10:00:00',
        '15:00:00',
      ])
      expect(f.updated_by).toBe(c().ids.owner)
      expect(await minutos(T.asigFinal)).toBe(294)
    })

    it('[admin con todas] acorta a 10:00–14:30 y las horas bajan a 268 min (D-07)', async () => {
      const res = await cambiar('admin', '10:00', '14:30')
      expect(codigo(res), describir(res as never)).toBe('OK')
      expect(await minutos(T.asigFinal)).toBe(268)
      expect((await franja()).updated_by).toBe(c().ids.admin)
    })

    it('[admin sin capacidades] también cambia la franja: vuelve a 10:30–14:30 y a 240 min (D-07)', async () => {
      const res = await cambiar('adminSin', '10:30', '14:30')
      expect(codigo(res), describir(res as never)).toBe('OK')
      expect(await minutos(T.asigFinal)).toBe(240)
      expect((await franja()).updated_by).toBe(c().ids.adminSin)
    })

    for (const perfil of ADMINS) {
      it(`[${ETIQUETA[perfil]}] cambiar la fecha de un finalizado da SHIFT_COMPLETED y no mueve el turno (D-07, CB-14)`, async () => {
        const res = await cambiar(perfil, '10:30', '14:30', {
          p_date: daysFromToday(1),
        })
        expect(codigo(res), describir(res as never)).toBe('SHIFT_COMPLETED')
        expect(res.error?.message).toBe(
          'Este turno ya terminó: solo se puede cambiar el horario, no la fecha.',
        )
        const f = await franja()
        expect(f.shift_date).toBe(FECHA)
        expect([f.start_time, f.end_time]).toEqual(['10:30:00', '14:30:00'])
      })
    }

    it('[dueño] pasarlo a «A terminar» o dejar la fin antes del inicio no se acepta (D-07)', async () => {
      const aTerminar = await cambiar('owner', '10:30', '14:30', {
        p_open_ended: true,
      })
      expect(codigo(aTerminar)).toBe('SHIFT_COMPLETED')
      const invertido = await cambiar('owner', '15:00', '14:00')
      expect(codigo(invertido)).toBe('INVALID_TIME_RANGE')
      const f = await franja()
      expect([f.start_time, f.end_time]).toEqual(['10:30:00', '14:30:00'])
      expect(await minutos(T.asigFinal)).toBe(240)
    })
  })

  // -----------------------------------------------------------------------------------------------
  // 5. p_geo_reason (D-14)
  // -----------------------------------------------------------------------------------------------
  describe.skipIf(CERCA_DE_MEDIANOCHE)(
    'motivo técnico de la falta de ubicación: p_geo_reason (D-14)',
    () => {
      const emp = () => clienteDe('empleado')
      const sup = () => clienteDe('supervisor')
      const registro = async (
        asignacion: string,
        kind: 'check_in' | 'check_out',
      ) => {
        const { data } = await db()
          .from('attendance_records')
          .select('geo_status, geo_unvalidated_reason, latitude')
          .eq('assignment_id', asignacion)
          .eq('kind', kind)
          .maybeSingle()
        return data
      }

      it('prepara: turnos de hoy (con y sin coordenadas) con la persona asignada', async () => {
        // Franjas que no se pisan entre sí: la misma persona no puede estar en dos a la vez.
        T.geoUno = await turno(T.sede, hoy, '00:00', '08:00')
        T.geoSin = await turno(T.sedeSin, hoy, '08:30', '16:00')
        T.geoDual = await turno(T.sede, hoy, '00:00', '23:59')
        T.asigGeo = await asignar(T.geoUno, c().ids.empleado1)
        T.asigGeoSin = await asignar(T.geoSin, c().ids.empleado1)
        T.asigGeoDual = await asignar(T.geoDual, c().ids.dual)
        T.geoSup = await turno(T.sede, hoy, '00:00', '23:59')
      })

      it('[empleado] un motivo que no es técnico da INVALID_GEO_REASON en el inicio y no registra nada (D-14)', async () => {
        for (const motivo of [
          'otro',
          'no_location',
          'low_accuracy',
          'PERMISSION_DENIED',
        ]) {
          const res = await llamar(emp(), 'record_check_in', {
            p_assignment_id: T.asigGeo,
            p_geo_reason: motivo,
          })
          expect(codigo(res), `${motivo}: ${describir(res as never)}`).toBe(
            'INVALID_GEO_REASON',
          )
        }
        expect(await registro(T.asigGeo, 'check_in')).toBeNull()
      })

      for (const perfil of [
        'supervisor',
        'adminSin',
        'admin',
        'owner',
        'anon',
      ] as Perfil[]) {
        it(`[${ETIQUETA[perfil]}] record_check_in con p_geo_reason: ${perfil === 'anon' ? '42501' : 'FORBIDDEN'} y no registra nada (RB-X02, D-14)`, async () => {
          const res = await llamar(clienteDe(perfil), 'record_check_in', {
            p_assignment_id: T.asigGeo,
            p_geo_reason: 'timeout',
          })
          expect(codigo(res), describir(res as never)).toBe(
            perfil === 'anon' ? '42501' : 'FORBIDDEN',
          )
          expect(await registro(T.asigGeo, 'check_in')).toBeNull()
        })
      }

      it('[empleado] con un motivo válido y sin coordenadas el inicio queda «sin validar» con ese motivo (D-14)', async () => {
        const res = await llamar(emp(), 'record_check_in', {
          p_assignment_id: T.asigGeo,
          p_geo_reason: 'permission_denied',
        })
        expect(codigo(res), describir(res as never)).toBe('OK')
        expect(json(res).geo_status).toBe('unvalidated')
        expect(json(res).geo_unvalidated_reason).toBe('permission_denied')
        const r = await registro(T.asigGeo, 'check_in')
        expect(r?.geo_unvalidated_reason).toBe('permission_denied')
        expect(r?.latitude).toBeNull()
      })

      it('[empleado] la salida también valida el motivo y lo guarda (D-14)', async () => {
        const invalido = await llamar(emp(), 'record_check_out', {
          p_assignment_id: T.asigGeo,
          p_geo_reason: 'inventado',
        })
        expect(codigo(invalido), describir(invalido as never)).toBe(
          'INVALID_GEO_REASON',
        )
        expect(await registro(T.asigGeo, 'check_out')).toBeNull()
        const valido = await llamar(emp(), 'record_check_out', {
          p_assignment_id: T.asigGeo,
          p_geo_reason: 'position_unavailable',
        })
        expect(codigo(valido), describir(valido as never)).toBe('OK')
        expect(
          (await registro(T.asigGeo, 'check_out'))?.geo_unvalidated_reason,
        ).toBe('position_unavailable')
      })

      it('[doble rol] con coordenadas el motivo se ignora: no queda como motivo técnico (D-14)', async () => {
        const res = await llamar(clienteDe('dual'), 'record_check_in', {
          p_assignment_id: T.asigGeoDual,
          p_lat: SEDE.lat,
          p_lng: SEDE.lng,
          p_accuracy: 10,
          p_geo_reason: 'timeout',
        })
        expect(codigo(res), describir(res as never)).toBe('OK')
        expect(json(res).geo_status).toBe('valid')
        expect(json(res).geo_unvalidated_reason).toBeNull()
        const r = await registro(T.asigGeoDual, 'check_in')
        expect(r?.geo_unvalidated_reason).toBeNull()
        expect(r?.latitude).not.toBeNull()
      })

      it('[empleado] una cadena vacía o con espacios equivale a no mandar motivo: queda no_location (D-14)', async () => {
        const res = await llamar(emp(), 'record_check_in', {
          p_assignment_id: T.asigGeoSin,
          p_geo_reason: '   ',
        })
        expect(codigo(res), describir(res as never)).toBe('OK')
        // La sede no tiene coordenadas: el motivo es el de la sede, no el del celular.
        expect(json(res).geo_status).toBe('unvalidated')
        expect(['site_without_coords', 'no_location']).toContain(
          json(res).geo_unvalidated_reason,
        )
      })

      it('[coordinador] take_supervision y complete_supervision validan el motivo y lo guardan (D-14)', async () => {
        const iniciada = await llamar(sup(), 'start_workday', {
          p_lat: SEDE.lat,
          p_lng: SEDE.lng,
          p_accuracy: 10,
        })
        expect(codigo(iniciada), describir(iniciada as never)).toBe('OK')

        // Otros roles: FORBIDDEN (o 42501) sin crear nada.
        for (const perfil of [
          'empleado',
          'adminSin',
          'admin',
          'owner',
          'anon',
        ] as Perfil[]) {
          const res = await llamar(clienteDe(perfil), 'take_supervision', {
            p_shift_id: T.geoSup,
            p_geo_reason: 'timeout',
          })
          expect(codigo(res), `${perfil}: ${describir(res as never)}`).toBe(
            perfil === 'anon' ? '42501' : 'FORBIDDEN',
          )
        }

        const invalida = await llamar(sup(), 'take_supervision', {
          p_shift_id: T.geoSup,
          p_geo_reason: 'inventado',
        })
        expect(codigo(invalida), describir(invalida as never)).toBe(
          'INVALID_GEO_REASON',
        )
        const { data: ninguna } = await db()
          .from('supervisions')
          .select('id')
          .eq('shift_id', T.geoSup)
        expect(ninguna, 'el error deshace la supervisión').toEqual([])

        const toma = await llamar(sup(), 'take_supervision', {
          p_shift_id: T.geoSup,
          p_geo_reason: 'timeout',
        })
        expect(codigo(toma), describir(toma as never)).toBe('OK')
        const supervision = (json(toma).supervision as { id: string }).id
        const entrada = await db()
          .from('supervision_attendance')
          .select('geo_status, geo_unvalidated_reason')
          .eq('supervision_id', supervision)
          .eq('kind', 'check_in')
          .single()
        expect(entrada.data?.geo_unvalidated_reason).toBe('timeout')

        const cierreInvalido = await llamar(sup(), 'complete_supervision', {
          p_supervision_id: supervision,
          p_geo_reason: 'inventado',
        })
        expect(codigo(cierreInvalido), describir(cierreInvalido as never)).toBe(
          'INVALID_GEO_REASON',
        )
        const { data: abierta } = await db()
          .from('supervisions')
          .select('status')
          .eq('id', supervision)
          .single()
        expect(abierta?.status).toBe('in_progress')

        const cierre = await llamar(sup(), 'complete_supervision', {
          p_supervision_id: supervision,
          p_geo_reason: 'permission_denied',
        })
        expect(codigo(cierre), describir(cierre as never)).toBe('OK')
        const salida = await db()
          .from('supervision_attendance')
          .select('geo_unvalidated_reason')
          .eq('supervision_id', supervision)
          .eq('kind', 'check_out')
          .single()
        expect(salida.data?.geo_unvalidated_reason).toBe('permission_denied')
      })
    },
  )
})

/** Rechazado (error de permisos, vista sin escritura) o sin ninguna fila afectada. */
function denegadoOSinFilas(res: {
  error: { code?: string; message: string } | null
  data: unknown
}): boolean {
  if (res.error) return true
  return !Array.isArray(res.data) || res.data.length === 0
}
