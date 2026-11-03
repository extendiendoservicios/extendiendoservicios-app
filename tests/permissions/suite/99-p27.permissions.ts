// tests/permissions/suite/99-p27.permissions.ts — P27.8 (observaciones de los dueños, 2 nov 2026)
//
// Las reglas nuevas del lote P27 (migraciones 0078 a 0081 y `delete_user` de `admin-users`) por API
// directa con `supabase-js`, contra App_dev y con DATOS REALES (la matriz genérica de `rpc.ts`
// solo prueba la puerta con ids inexistentes). Rol por rol:
//   1. Borrado físico del dueño (OD-22, OD-23): `owner_delete_*` y sus vistas previas, SOLO el
//      dueño; el administrador (incluido el que tiene todas las capacidades), el coordinador, el
//      doble rol y el empleado reciben FORBIDDEN y el registro sigue en pie. El dueño: bloqueos por
//      historia con su código, nombre mal escrito, borrado de abajo hacia arriba y el evento
//      `record_deleted` con la copia JSON. `delete_service` (0044) quedó solo para el dueño (OD-22b).
//   2. Categorías de clientes (OD-20): dueño y administrador sí (con y sin capacidades); el
//      coordinador, el doble rol y el empleado ni leen ni escriben `client_categories`.
//   3. `apply_service_fixed_employees` (OD-11): dueño y administrador; el resto FORBIDDEN.
//   4. Jornada desde la administración (OD-06, OD-07): `admin_end_workday`, `admin_close_workday_pause`
//      y `admin_correct_supervision_time` exigen `manage_attendance` (la capacidad una por una está
//      en `40-capacidades`; acá, con jornadas reales).
//   5. Contacto de la sede (OD-24, 0081): empleado, coordinador y doble rol no lo obtienen por
//      `sites` (ni directo ni con `select('*')` ni embebido), ni por `v_site_contacts`, ni por las
//      vistas `v_my_day`, `v_my_history`, `v_my_supervisions` y `v_supervisor_today`.
//   6. `generate_shifts` con `p_service_id` (OD-27) exige `generate_shifts`.
// Todo con el prefijo `e2e-perm-p27-` y fechas relativas a hoy en hora de Argentina; lo que se crea
// se borra en el `afterAll`.

import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { anioLejano } from '../../fixtures/accounts.ts'
import { addDays, daysFromToday } from '../../fixtures/dates.ts'
import { borrarJornadasDe, deleteClientDeep } from '../../fixtures/scenario.ts'
import { describir, filas, tabla } from './ayudas.ts'
import { clienteDe, contexto, servicio, type Db } from './contexto.ts'
import { cuitUnico, PREFIJO } from './escenario.ts'
import { ETIQUETA, type Perfil } from './perfiles.ts'

const P = `${PREFIJO}p27-`
const sfx = () => randomBytes(3).toString('hex')

/** Perfiles que NO son el dueño, con sesión. */
const NO_DUENO: Perfil[] = [
  'empleado',
  'supervisor',
  'dual',
  'adminSin',
  'admin',
]
/** Perfiles sin rol de administración. */
const SIN_ADMIN: Perfil[] = ['empleado', 'supervisor', 'dual']

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

describe('lote P27: permisos de lo nuevo con datos reales', () => {
  const db = () => servicio()
  const c = () => contexto()
  const hoy = daysFromToday(0)
  const clientesCreados: string[] = []
  const categoriasCreadas: string[] = []
  const supervisorJornada = () => c().ids.supervisor2
  let desde = ''

  // Cadena completa A (con un turno con historia: bloquea hacia arriba) y B (limpia).
  const A: Record<
    | 'cliente'
    | 'sede'
    | 'servicio'
    | 'turnoLimpio'
    | 'turnoConHistoria'
    | 'supervision',
    string
  > & {
    nombreCliente: string
    nombreSede: string
    nombreServicio: string
  } = {} as never
  const B: Record<'cliente' | 'sede' | 'servicio' | 'turno', string> & {
    nombreCliente: string
    nombreSede: string
    nombreServicio: string
  } = {} as never
  const CONTACTO = `${P}contacto-${sfx()}`

  async function crearCadena(
    etiqueta: string,
    conContacto: boolean,
  ): Promise<{
    cliente: string
    nombreCliente: string
    sede: string
    nombreSede: string
    servicio: string
    nombreServicio: string
  }> {
    const nombreCliente = `${P}${etiqueta}-cli-${sfx()}`
    const cliente = await db()
      .from('clients')
      .insert({
        legal_name: nombreCliente,
        trade_name: nombreCliente,
        cuit: cuitUnico(),
      })
      .select('id')
      .single()
    if (cliente.error) throw new Error(`cliente: ${cliente.error.message}`)
    clientesCreados.push(cliente.data.id)
    const nombreSede = `${P}${etiqueta}-sede-${sfx()}`
    const sede = await db()
      .from('sites')
      .insert({
        client_id: cliente.data.id,
        name: nombreSede,
        address: 'Calle de prueba 1',
        ...(conContacto
          ? { contact_name: CONTACTO, contact_phone: '1150000000' }
          : {}),
      })
      .select('id')
      .single()
    if (sede.error) throw new Error(`sede: ${sede.error.message}`)
    const nombreServicio = `${P}${etiqueta}-srv-${sfx()}`
    const srv = await db()
      .from('services')
      .insert({
        client_id: cliente.data.id,
        site_id: sede.data.id,
        name: nombreServicio,
        weekdays: [1, 2, 3, 4, 5],
        start_time: '08:00',
        end_time: '12:00',
        valid_from: hoy,
        status: 'paused',
      })
      .select('id')
      .single()
    if (srv.error) throw new Error(`servicio: ${srv.error.message}`)
    return {
      cliente: cliente.data.id,
      nombreCliente,
      sede: sede.data.id,
      nombreSede,
      servicio: srv.data.id,
      nombreServicio,
    }
  }

  async function crearTurno(
    cadena: { cliente: string; sede: string; servicio: string },
    dias: number,
  ): Promise<string> {
    const r = await db()
      .from('shifts')
      .insert({
        client_id: cadena.cliente,
        site_id: cadena.sede,
        service_id: cadena.servicio,
        shift_date: daysFromToday(dias),
        start_time: '08:00',
        end_time: '12:00',
        required_staff: 1,
        notes: `${P}turno`,
      })
      .select('id')
      .single()
    if (r.error) throw new Error(`turno: ${r.error.message}`)
    return r.data.id
  }

  beforeAll(async () => {
    desde = new Date().toISOString()
    const a = await crearCadena('a', true)
    Object.assign(A, a)
    A.turnoLimpio = await crearTurno(a, 40)
    A.turnoConHistoria = await crearTurno(a, 41)
    // Historia del turno: una supervisión (la app nunca la borra, P-014).
    const sup = await db()
      .from('supervisions')
      .insert({
        shift_id: A.turnoConHistoria,
        supervisor_id: c().ids.supervisor2,
        status: 'completed',
      })
      .select('id')
      .single()
    if (sup.error) throw new Error(`supervisión: ${sup.error.message}`)
    A.supervision = sup.data.id
    const b = await crearCadena('b', false)
    Object.assign(B, b)
    B.turno = await crearTurno(b, 42)
  })

  afterAll(async () => {
    const notas: string[] = []
    notas.push(
      ...(await borrarJornadasDe(
        db(),
        [supervisorJornada()],
        addDays(hoy, -10),
      )),
    )
    for (const id of categoriasCreadas) {
      await db()
        .from('clients')
        .update({ category_id: null })
        .eq('category_id', id)
      await db().from('client_categories').delete().eq('id', id)
    }
    await db().from('client_categories').delete().like('name', `${P}%`)
    for (const id of clientesCreados)
      notas.push(...(await deleteClientDeep(db(), id)))
    await db()
      .from('security_events')
      .delete()
      .eq('event_type', 'record_deleted')
      .gte('created_at', desde)
      .like('details->>name', `${P}%`)
    if (notas.length)
      console.warn(`[99-p27] limpieza con notas: ${notas.join('; ')}`)
  })

  // -----------------------------------------------------------------------------------------------
  // 1. Borrado físico: solo el dueño (OD-22, OD-23, OD-22b)
  // -----------------------------------------------------------------------------------------------
  describe('borrado físico del dueño (OD-22, OD-23)', () => {
    const intentos = (): Array<[string, Record<string, unknown>]> => [
      ['owner_delete_preview_shift', { p_shift_id: A.turnoLimpio }],
      ['owner_delete_shift', { p_shift_id: A.turnoLimpio }],
      ['owner_delete_preview_service', { p_service_id: B.servicio }],
      [
        'owner_delete_service',
        { p_service_id: B.servicio, p_confirm_name: B.nombreServicio },
      ],
      [
        'owner_delete_preview_service_shifts',
        { p_service_id: A.servicio, p_from_date: hoy },
      ],
      [
        'owner_delete_service_shifts',
        {
          p_service_id: A.servicio,
          p_from_date: hoy,
          p_confirm_name: A.nombreServicio,
        },
      ],
      ['owner_delete_preview_site', { p_site_id: B.sede }],
      [
        'owner_delete_site',
        { p_site_id: B.sede, p_confirm_name: B.nombreSede },
      ],
      ['owner_delete_preview_client', { p_client_id: B.cliente }],
      [
        'owner_delete_client',
        { p_client_id: B.cliente, p_confirm_name: B.nombreCliente },
      ],
      ['owner_delete_preview_employee', { p_employee_id: c().ids.empleado2 }],
      [
        'owner_delete_employee',
        {
          p_employee_id: c().ids.empleado2,
          p_confirm_name: 'E2E-Fijo-EM Empleado2',
        },
      ],
    ]

    for (const perfil of NO_DUENO) {
      it(`[${ETIQUETA[perfil]}] las 12 RPC owner_delete_* y sus vistas previas dan FORBIDDEN y no se borra nada (OD-22, RB-X02, CB-17)`, async () => {
        for (const [rpc, args] of intentos()) {
          const r = await llamar(clienteDe(perfil), rpc, args)
          expect(codigo(r), `${rpc}: ${describir(r as never)}`).toBe(
            'FORBIDDEN',
          )
        }
        // Todo sigue en pie: turno, servicio B, sede B, cliente B y la ficha del empleado.
        const sigue = async (t: string, id: string, col = 'id') =>
          filas(await tabla(db(), t).select(col).eq(col, id))
        expect(await sigue('shifts', A.turnoLimpio)).toHaveLength(1)
        expect(await sigue('services', B.servicio)).toHaveLength(1)
        expect(await sigue('sites', B.sede)).toHaveLength(1)
        expect(await sigue('clients', B.cliente)).toHaveLength(1)
        expect(
          await sigue('employees', c().ids.empleado2, 'profile_id'),
        ).toHaveLength(1)
      })
    }

    it('[anon] las RPC owner_delete_* dan 42501 (OD-22, RB-X02)', async () => {
      for (const [rpc, args] of intentos()) {
        const r = await llamar(clienteDe('anon'), rpc, args)
        expect(codigo(r), rpc).toBe('42501')
      }
    })

    it('[admin con todas] delete_service (0044) quedó solo para el dueño: FORBIDDEN y el servicio sigue (OD-22b)', async () => {
      for (const perfil of NO_DUENO) {
        const r = await llamar(clienteDe(perfil), 'delete_service', {
          p_service_id: B.servicio,
        })
        expect(codigo(r), `${perfil}: ${describir(r as never)}`).toBe(
          'FORBIDDEN',
        )
      }
      const sigue = await db()
        .from('services')
        .select('id')
        .eq('id', B.servicio)
      expect(sigue.data).toHaveLength(1)
    })

    it('[dueño] bloqueos por historia con su código y mensaje en español; nada se borra (OD-22, OD-23)', async () => {
      const dueno = clienteDe('owner')
      // Turno con una supervisión: HAS_SUPERVISIONS.
      const prev = await llamar(dueno, 'owner_delete_preview_shift', {
        p_shift_id: A.turnoConHistoria,
      })
      expect(prev.error, describir(prev as never)).toBeNull()
      expect(json(prev).can_delete).toBe(false)
      const bloqueos = (json(prev).blockers as Array<{ code: string }>).map(
        (b) => b.code,
      )
      expect(bloqueos).toContain('HAS_SUPERVISIONS')
      const borrar = await llamar(dueno, 'owner_delete_shift', {
        p_shift_id: A.turnoConHistoria,
      })
      expect(codigo(borrar)).toBe('DELETE_BLOCKED')
      expect(borrar.error?.message ?? '').toMatch(/[a-záéíóú]/i)
      // Servicio con turnos: HAS_SHIFTS. Sede con servicios: HAS_SERVICES. Cliente con sedes.
      const previoServicio = await llamar(
        dueno,
        'owner_delete_preview_service',
        {
          p_service_id: A.servicio,
        },
      )
      expect(
        (json(previoServicio).blockers as Array<{ code: string }>).map(
          (b) => b.code,
        ),
      ).toContain('HAS_SHIFTS')
      expect(
        codigo(
          await llamar(dueno, 'owner_delete_service', {
            p_service_id: A.servicio,
            p_confirm_name: A.nombreServicio,
          }),
        ),
      ).toBe('DELETE_BLOCKED')
      expect(
        codigo(
          await llamar(dueno, 'owner_delete_site', {
            p_site_id: A.sede,
            p_confirm_name: A.nombreSede,
          }),
        ),
      ).toBe('DELETE_BLOCKED')
      const previoCliente = await llamar(dueno, 'owner_delete_preview_client', {
        p_client_id: A.cliente,
      })
      expect(
        (
          json(previoCliente).blockers as Array<{
            code: string
            message?: string
          }>
        ).map((b) => b.code),
      ).toEqual(expect.arrayContaining(['HAS_SITES', 'HAS_SERVICES']))
      expect(
        codigo(
          await llamar(dueno, 'owner_delete_client', {
            p_client_id: A.cliente,
            p_confirm_name: A.nombreCliente,
          }),
        ),
      ).toBe('DELETE_BLOCKED')
      // Nada se borró.
      expect(
        (await db().from('shifts').select('id').eq('id', A.turnoConHistoria))
          .data,
      ).toHaveLength(1)
      expect(
        (await db().from('clients').select('id').eq('id', A.cliente)).data,
      ).toHaveLength(1)
    })

    it('[dueño] el nombre mal escrito da CONFIRM_NAME_MISMATCH y no borra (OD-23)', async () => {
      const dueno = clienteDe('owner')
      for (const [rpc, args] of [
        [
          'owner_delete_service',
          { p_service_id: B.servicio, p_confirm_name: 'otro nombre' },
        ],
        [
          'owner_delete_site',
          { p_site_id: B.sede, p_confirm_name: 'otro nombre' },
        ],
        [
          'owner_delete_client',
          { p_client_id: B.cliente, p_confirm_name: 'otro nombre' },
        ],
      ] as Array<[string, Record<string, unknown>]>) {
        const r = await llamar(dueno, rpc, args)
        // Con un bloqueo previo (el servicio B tiene un turno) puede ganar DELETE_BLOCKED; lo que
        // no puede pasar es que se borre.
        expect(
          ['CONFIRM_NAME_MISMATCH', 'DELETE_BLOCKED'],
          `${rpc}: ${describir(r as never)}`,
        ).toContain(codigo(r))
      }
      // El servicio B no tiene bloqueo salvo el turno: se lo borra primero y se prueba el nombre.
      const deTurnos = await llamar(dueno, 'owner_delete_service_shifts', {
        p_service_id: B.servicio,
        p_from_date: hoy,
        p_confirm_name: 'otro nombre',
      })
      expect(codigo(deTurnos)).toBe('CONFIRM_NAME_MISMATCH')
      expect(
        (await db().from('shifts').select('id').eq('id', B.turno)).data,
      ).toHaveLength(1)
    })

    it('[dueño] borra de abajo hacia arriba lo que no tiene historia y deja el evento record_deleted con la copia (OD-22, OD-23)', async () => {
      const dueno = clienteDe('owner')
      // 1. El turno limpio de A.
      const t = await llamar(dueno, 'owner_delete_shift', {
        p_shift_id: A.turnoLimpio,
      })
      expect(t.error, describir(t as never)).toBeNull()
      expect(
        (await db().from('shifts').select('id').eq('id', A.turnoLimpio)).data,
      ).toHaveLength(0)
      // 2. Los turnos del servicio B desde hoy.
      const prev = await llamar(dueno, 'owner_delete_preview_service_shifts', {
        p_service_id: B.servicio,
        p_from_date: hoy,
      })
      expect(json(prev).deletable_count).toBe(1)
      const lote = await llamar(dueno, 'owner_delete_service_shifts', {
        p_service_id: B.servicio,
        p_from_date: hoy,
        p_confirm_name: B.nombreServicio,
      })
      expect(lote.error, describir(lote as never)).toBeNull()
      expect(
        (await db().from('shifts').select('id').eq('id', B.turno)).data,
      ).toHaveLength(0)
      // 3. Servicio, sede y cliente B, en ese orden.
      for (const [rpc, args, tabla_, id] of [
        [
          'owner_delete_service',
          { p_service_id: B.servicio, p_confirm_name: B.nombreServicio },
          'services',
          B.servicio,
        ],
        [
          'owner_delete_site',
          { p_site_id: B.sede, p_confirm_name: B.nombreSede },
          'sites',
          B.sede,
        ],
        [
          'owner_delete_client',
          { p_client_id: B.cliente, p_confirm_name: B.nombreCliente },
          'clients',
          B.cliente,
        ],
      ] as Array<[string, Record<string, unknown>, string, string]>) {
        const r = await llamar(dueno, rpc, args)
        expect(r.error, `${rpc}: ${describir(r as never)}`).toBeNull()
        expect(
          (
            await db()
              .from(tabla_ as 'clients')
              .select('id')
              .eq('id', id)
          ).data,
        ).toHaveLength(0)
      }
      // 4. El evento: quién, qué y cuándo, con la copia JSON.
      const eventos = await db()
        .from('security_events')
        .select('actor_id, details, created_at')
        .eq('event_type', 'record_deleted')
        .gte('created_at', desde)
        .like('details->>name', `${P}%`)
      expect(eventos.error).toBeNull()
      expect((eventos.data ?? []).length).toBeGreaterThanOrEqual(4)
      for (const e of eventos.data ?? []) {
        expect(e.actor_id).toBe(c().ids.owner)
        const d = e.details as Record<string, unknown>
        expect(d.entity).toBeTruthy()
        expect(JSON.stringify(d)).toMatch(/copy|record|snapshot|data/i)
      }
    })

    it('[dueño] borra a un empleado sin historia (ficha y perfil), pide el nombre y deja el evento; Auth se borra aparte (OD-22, OD-23)', async () => {
      const email = `e2e-perm-p27-${sfx()}@example.com`
      const alta = await db().auth.admin.createUser({
        email,
        password: `P27-${sfx()}-${sfx()}-Aa1`,
        email_confirm: true,
        user_metadata: { first_name: 'Borrable', last_name: 'P27' },
      })
      if (alta.error || !alta.data.user)
        throw new Error(`auth: ${alta.error?.message}`)
      const id = alta.data.user.id
      try {
        await db()
          .from('profiles')
          .update({ first_name: 'Borrable', last_name: 'P27' })
          .eq('id', id)
        const ficha = await db()
          .from('employees')
          .insert({
            profile_id: id,
            dni: `97${Date.now().toString().slice(-6)}`,
            hire_date: '2026-01-05',
            status: 'active',
          })
        expect(ficha.error, ficha.error?.message).toBeNull()
        const dueno = clienteDe('owner')
        const prev = await llamar(dueno, 'owner_delete_preview_employee', {
          p_employee_id: id,
        })
        expect(prev.error, describir(prev as never)).toBeNull()
        expect(json(prev).can_delete).toBe(true)
        const mal = await llamar(dueno, 'owner_delete_employee', {
          p_employee_id: id,
          p_confirm_name: 'Otra Persona',
        })
        expect(codigo(mal)).toBe('CONFIRM_NAME_MISMATCH')
        expect(
          (
            await db()
              .from('employees')
              .select('profile_id')
              .eq('profile_id', id)
          ).data,
        ).toHaveLength(1)
        for (const perfil of ['admin', 'adminSin'] as Perfil[]) {
          const r = await llamar(clienteDe(perfil), 'owner_delete_employee', {
            p_employee_id: id,
            p_confirm_name: 'Borrable P27',
          })
          expect(codigo(r)).toBe('FORBIDDEN')
        }
        const ok = await llamar(dueno, 'owner_delete_employee', {
          p_employee_id: id,
          p_confirm_name: 'Borrable P27',
        })
        expect(ok.error, describir(ok as never)).toBeNull()
        expect(
          (
            await db()
              .from('employees')
              .select('profile_id')
              .eq('profile_id', id)
          ).data,
        ).toHaveLength(0)
        expect(
          (await db().from('profiles').select('id').eq('id', id)).data,
        ).toHaveLength(0)
        const evento = await db()
          .from('security_events')
          .select('actor_id')
          .eq('event_type', 'record_deleted')
          .gte('created_at', desde)
          .eq('details->>entity', 'employee')
        expect((evento.data ?? []).length).toBeGreaterThanOrEqual(1)
      } finally {
        // La base no toca Auth (lo hace `delete_user` de la Edge Function): se limpia el usuario propio.
        await db().from('employees').delete().eq('profile_id', id)
        await db().auth.admin.deleteUser(id)
      }
    })

    it('[admin con todas] no lee los eventos record_deleted (solo el dueño ve Eventos de seguridad) (OD-23, RB-X02)', async () => {
      const r = await tabla(clienteDe('admin'), 'security_events')
        .select('id')
        .eq('event_type', 'record_deleted')
      expect(filas(r as never)).toEqual([])
    })
  })

  // -----------------------------------------------------------------------------------------------
  // 2. Categorías de clientes (OD-20)
  // -----------------------------------------------------------------------------------------------
  describe('categorías de clientes (OD-20)', () => {
    for (const perfil of SIN_ADMIN) {
      it(`[${ETIQUETA[perfil]}] no lee client_categories y sus RPC dan FORBIDDEN sin crear nada (OD-20, RB-X02)`, async () => {
        const nombre = `${P}cat-${sfx()}`
        const lectura = await tabla(
          clienteDe(perfil),
          'client_categories',
        ).select('id,name')
        expect(filas(lectura as never)).toEqual([])
        const alta = await llamar(clienteDe(perfil), 'upsert_client_category', {
          p_name: nombre,
        })
        expect(codigo(alta)).toBe('FORBIDDEN')
        const escritura = await tabla(
          clienteDe(perfil),
          'client_categories',
        ).insert({ name: nombre })
        expect(escritura.error?.code).toBe('42501')
        const cat = await db()
          .from('client_categories')
          .select('id')
          .eq('name', nombre)
        expect(cat.data).toHaveLength(0)
        // Una existente (la plantada): ni reordenar ni dar de baja.
        const baja = await llamar(clienteDe(perfil), 'remove_client_category', {
          p_id: c().e.categoriaA,
        })
        expect(codigo(baja)).toBe('FORBIDDEN')
        const orden = await llamar(
          clienteDe(perfil),
          'reorder_client_categories',
          { p_ids: [c().e.categoriaA] },
        )
        expect(codigo(orden)).toBe('FORBIDDEN')
        const sigue = await db()
          .from('client_categories')
          .select('deleted_at')
          .eq('id', c().e.categoriaA)
        expect(sigue.data?.[0]?.deleted_at).toBeNull()
      })
    }

    for (const perfil of ['adminSin', 'admin', 'owner'] as Perfil[]) {
      it(`[${ETIQUETA[perfil]}] da de alta, renombra, ordena y da de baja una categoría; sin repetir nombre (OD-20)`, async () => {
        const nombre = `${P}cat-${sfx()}`
        const dbp = clienteDe(perfil)
        const alta = await llamar(dbp, 'upsert_client_category', {
          p_name: nombre,
        })
        expect(alta.error, describir(alta as never)).toBeNull()
        const id = String(json(alta).id)
        categoriasCreadas.push(id)
        // Aparece en la lectura de su rol.
        const lectura = await tabla(dbp, 'client_categories')
          .select('id,name')
          .eq('id', id)
        expect(filas(lectura as never)).toHaveLength(1)
        // Nombre repetido (sin distinguir mayúsculas).
        const repetida = await llamar(dbp, 'upsert_client_category', {
          p_name: nombre.toUpperCase(),
        })
        expect(codigo(repetida)).toBe('CATEGORY_NAME_TAKEN')
        // Cambio de nombre.
        const nuevo = `${nombre}-b`
        const cambio = await llamar(dbp, 'upsert_client_category', {
          p_id: id,
          p_name: nuevo,
        })
        expect(cambio.error, describir(cambio as never)).toBeNull()
        expect(json(cambio).name).toBe(nuevo)
        // Orden.
        const orden = await llamar(dbp, 'reorder_client_categories', {
          p_ids: [id],
        })
        expect(orden.error, describir(orden as never)).toBeNull()
        // Asignarla a un cliente (alta/edición directa de clientes: dueño y administrador) y darla de baja.
        const asigna = await tabla(dbp, 'clients')
          .update({ category_id: id })
          .eq('id', A.cliente)
          .select('id')
        expect(asigna.error, describir(asigna as never)).toBeNull()
        const baja = await llamar(dbp, 'remove_client_category', { p_id: id })
        expect(baja.error, describir(baja as never)).toBeNull()
        expect(json(baja).clients_cleared).toBe(1)
        const cliente = await db()
          .from('clients')
          .select('category_id')
          .eq('id', A.cliente)
          .single()
        expect(cliente.data?.category_id).toBeNull()
        // Una categoría dada de baja no se puede asignar.
        const trasBaja = await tabla(dbp, 'clients')
          .update({ category_id: id })
          .eq('id', A.cliente)
          .select('id')
        expect(trasBaja.error?.hint).toBe('CATEGORY_NOT_FOUND')
      })
    }

    it('[anon] las RPC de categorías dan 42501 (OD-20, RB-X02)', async () => {
      const anon = clienteDe('anon')
      expect(
        codigo(await llamar(anon, 'upsert_client_category', { p_name: 'x' })),
      ).toBe('42501')
      expect(
        codigo(
          await llamar(anon, 'remove_client_category', {
            p_id: c().e.categoriaA,
          }),
        ),
      ).toBe('42501')
    })
  })

  // -----------------------------------------------------------------------------------------------
  // 3. Fijos en lote (OD-11) y generate_shifts por servicio (OD-27)
  // -----------------------------------------------------------------------------------------------
  describe('fijos en lote y generación por servicio (OD-11, OD-27)', () => {
    for (const perfil of SIN_ADMIN) {
      it(`[${ETIQUETA[perfil]}] apply_service_fixed_employees da FORBIDDEN con un servicio real (OD-11, RB-X02)`, async () => {
        const r = await llamar(
          clienteDe(perfil),
          'apply_service_fixed_employees',
          {
            p_service_id: A.servicio,
            p_from_date: hoy,
          },
        )
        expect(codigo(r), describir(r as never)).toBe('FORBIDDEN')
      })
    }

    for (const perfil of ['adminSin', 'admin', 'owner'] as Perfil[]) {
      it(`[${ETIQUETA[perfil]}] apply_service_fixed_employees pasa y no toca turnos sin fijos (OD-11)`, async () => {
        const r = await llamar(
          clienteDe(perfil),
          'apply_service_fixed_employees',
          {
            p_service_id: A.servicio,
            p_from_date: daysFromToday(60),
          },
        )
        expect(r.error, describir(r as never)).toBeNull()
        expect(json(r).updated_count).toBe(0)
      })
    }

    it('apply_service_fixed_employees pide la fecha: FROM_DATE_REQUIRED (OD-11)', async () => {
      const r = await llamar(
        clienteDe('owner'),
        'apply_service_fixed_employees',
        {
          p_service_id: A.servicio,
          p_from_date: null,
        },
      )
      expect(codigo(r)).toBe('FROM_DATE_REQUIRED')
    })

    it('generate_shifts con p_service_id: sin la capacidad FORBIDDEN y no genera; con ella genera solo ese servicio (OD-27, RB-A04)', async () => {
      const anio = anioLejano() + 6
      const mes = 3
      const base = await crearCadena('gen', false)
      const otro = await crearCadena('gen2', false)
      // Los dos servicios vigentes desde el mes lejano y activos.
      for (const s of [base.servicio, otro.servicio]) {
        const up = await db()
          .from('services')
          .update({
            valid_from: `${anio}-${String(mes).padStart(2, '0')}-01`,
            status: 'active',
          })
          .eq('id', s)
        expect(up.error).toBeNull()
      }
      const cuenta = async (servicioId: string) =>
        (
          await db()
            .from('shifts')
            .select('id', { count: 'exact', head: true })
            .eq('service_id', servicioId)
        ).count ?? 0
      for (const perfil of [...SIN_ADMIN, 'adminSin'] as Perfil[]) {
        const r = await llamar(clienteDe(perfil), 'generate_shifts', {
          p_year: anio,
          p_month: mes,
          p_service_id: base.servicio,
        })
        expect(codigo(r), `${perfil}: ${describir(r as never)}`).toBe(
          'FORBIDDEN',
        )
      }
      expect(await cuenta(base.servicio)).toBe(0)
      const r = await llamar(clienteDe('admin'), 'generate_shifts', {
        p_year: anio,
        p_month: mes,
        p_service_id: base.servicio,
      })
      expect(r.error, describir(r as never)).toBeNull()
      expect(Number(json(r).created)).toBeGreaterThan(0)
      expect(await cuenta(base.servicio)).toBe(Number(json(r).created))
      expect(await cuenta(otro.servicio), 'no toca los demás servicios').toBe(0)
      // Servicio inexistente: SERVICE_NOT_FOUND (el mensaje es del plan: 06 / 0081).
      const nada = await llamar(clienteDe('owner'), 'generate_shifts', {
        p_year: anio,
        p_month: mes,
        p_service_id: '00000000-0000-4000-8000-000000000001',
      })
      expect(codigo(nada)).toBe('SERVICE_NOT_FOUND')
    })
  })

  // -----------------------------------------------------------------------------------------------
  // 4. Jornada desde la administración (OD-06, OD-07): manage_attendance
  // -----------------------------------------------------------------------------------------------
  describe('jornada desde la administración (OD-06, OD-07)', () => {
    async function jornadaAbierta(dias: number, conPausa: boolean) {
      const fecha = daysFromToday(dias)
      const hora = (hhmm: string) => `${fecha}T${hhmm}:00-03:00`
      await borrarJornadasDe(db(), [supervisorJornada()], fecha)
      const j = await db()
        .from('supervisor_workdays')
        .insert({
          supervisor_id: supervisorJornada(),
          work_date: fecha,
          started_at: hora('08:00'),
        })
        .select('id')
        .single()
      if (j.error) throw new Error(`jornada: ${j.error.message}`)
      const eventos = await db()
        .from('supervisor_workday_events')
        .insert([
          {
            workday_id: j.data.id,
            kind: 'start' as const,
            recorded_at: hora('08:00'),
          },
          ...(conPausa
            ? [
                {
                  workday_id: j.data.id,
                  kind: 'pause' as const,
                  recorded_at: hora('10:00'),
                  reason: `${P}pausa`,
                },
              ]
            : []),
        ])
        .select('id, kind')
      if (eventos.error) throw new Error(`eventos: ${eventos.error.message}`)
      const pausa =
        (eventos.data ?? []).find((e) => e.kind === 'pause')?.id ?? ''
      return { fecha, hora, workday: j.data.id, pausa }
    }

    it('sin manage_attendance (adminSin, coordinador, doble rol, empleado): FORBIDDEN y la jornada no cambia (OD-06, OD-07, CB-17)', async () => {
      const j = await jornadaAbierta(-8, true)
      for (const perfil of [...SIN_ADMIN, 'adminSin'] as Perfil[]) {
        const dbp = clienteDe(perfil)
        for (const [rpc, args] of [
          [
            'admin_end_workday',
            {
              p_workday_id: j.workday,
              p_reason: `${P}x`,
              p_at: j.hora('12:00'),
            },
          ],
          [
            'admin_close_workday_pause',
            { p_event_id: j.pausa, p_reason: `${P}x`, p_at: j.hora('10:30') },
          ],
          [
            'admin_correct_supervision_time',
            {
              p_supervision_id: A.supervision,
              p_reason: `${P}x`,
              p_start_at: j.hora('09:00'),
            },
          ],
        ] as Array<[string, Record<string, unknown>]>) {
          const r = await llamar(dbp, rpc, args)
          expect(codigo(r), `${perfil} ${rpc}: ${describir(r as never)}`).toBe(
            'FORBIDDEN',
          )
        }
      }
      const estado = await db()
        .from('supervisor_workdays')
        .select('ended_at, corrected')
        .eq('id', j.workday)
        .single()
      expect(estado.data?.ended_at).toBeNull()
      expect(estado.data?.corrected).toBe(false)
      const eventos = await db()
        .from('supervisor_workday_events')
        .select('id')
        .eq('workday_id', j.workday)
      expect(eventos.data).toHaveLength(2)
    })

    it('[admin con todas] cierra la pausa abierta y finaliza la jornada con motivo: queda corregida (OD-06, OD-07, CJ-32)', async () => {
      const j = await jornadaAbierta(-9, true)
      const dbp = clienteDe('admin')
      const sinMotivo = await llamar(dbp, 'admin_end_workday', {
        p_workday_id: j.workday,
        p_reason: '  ',
      })
      expect(codigo(sinMotivo)).toBe('REASON_REQUIRED')
      const cierraPausa = await llamar(dbp, 'admin_close_workday_pause', {
        p_event_id: j.pausa,
        p_reason: `${P}se trabó la app`,
        p_at: j.hora('10:30'),
      })
      expect(cierraPausa.error, describir(cierraPausa as never)).toBeNull()
      const otraVez = await llamar(dbp, 'admin_close_workday_pause', {
        p_event_id: j.pausa,
        p_reason: `${P}x`,
        p_at: j.hora('10:45'),
      })
      expect(codigo(otraVez)).toBe('PAUSE_NOT_OPEN')
      const fin = await llamar(dbp, 'admin_end_workday', {
        p_workday_id: j.workday,
        p_reason: `${P}cierre`,
        p_at: j.hora('12:00'),
      })
      expect(fin.error, describir(fin as never)).toBeNull()
      const estado = await db()
        .from('supervisor_workdays')
        .select('ended_at, corrected')
        .eq('id', j.workday)
        .single()
      expect(estado.data?.ended_at).not.toBeNull()
      expect(estado.data?.corrected).toBe(true)
      const repetida = await llamar(dbp, 'admin_end_workday', {
        p_workday_id: j.workday,
        p_reason: `${P}x`,
        p_at: j.hora('12:30'),
      })
      expect(codigo(repetida)).toBe('WORKDAY_ENDED')
    })
  })

  // -----------------------------------------------------------------------------------------------
  // 5. Contacto de la sede (OD-24, 0081)
  // -----------------------------------------------------------------------------------------------
  describe('contacto de la sede solo para dueños y administradores (OD-24)', () => {
    for (const perfil of SIN_ADMIN) {
      it(`[${ETIQUETA[perfil]}] no obtiene el contacto por sites, v_site_contacts ni embebido (OD-24, RB-X02)`, async () => {
        const dbp = clienteDe(perfil)
        for (const columna of ['contact_name', 'contact_phone', '*']) {
          const r = await tabla(dbp, 'sites').select(columna).eq('id', A.sede)
          expect(r.error?.code, `sites.select(${columna})`).toBe('42501')
          expect(filas(r as never)).toEqual([])
        }
        const embebido = await dbp
          .from('shifts')
          .select('id, sites(name, contact_name)')
          .limit(1)
        expect(embebido.error?.code).toBe('42501')
        const vista = await tabla(dbp, 'v_site_contacts').select('*')
        expect(vista.error).toBeNull()
        expect(filas(vista as never)).toEqual([])
        // Y la fila con nombre SÍ existe para quien corresponde (la contraprueba está abajo).
      })
    }

    for (const perfil of [
      'empleado',
      'supervisor',
      'dual',
      'adminSin',
      'admin',
      'owner',
    ] as Perfil[]) {
      for (const vista of [
        'v_my_day',
        'v_my_history',
        'v_my_supervisions',
        'v_supervisor_today',
      ]) {
        it(`[${ETIQUETA[perfil]}] ${vista} ya no tiene las columnas site_contact_* (OD-24, P27.1b)`, async () => {
          const dbp = clienteDe(perfil)
          for (const columna of ['site_contact_name', 'site_contact_phone']) {
            const r = await tabla(dbp, vista).select(columna).limit(1)
            expect(
              r.error,
              `${vista}.${columna} no debería existir`,
            ).not.toBeNull()
            expect(r.error?.code).toBe('42703')
          }
          const todo = await tabla(dbp, vista).select('*').limit(5)
          expect(todo.error, describir(todo as never)).toBeNull()
          for (const fila of filas(todo)) {
            expect(Object.keys(fila).filter((k) => /contact/i.test(k))).toEqual(
              [],
            )
          }
        })
      }
    }

    for (const perfil of ['adminSin', 'admin', 'owner'] as Perfil[]) {
      it(`[${ETIQUETA[perfil]}] sí lee el contacto por v_site_contacts (contraprueba, OD-24)`, async () => {
        const r = await tabla(clienteDe(perfil), 'v_site_contacts')
          .select('site_id, contact_name, contact_phone')
          .eq('site_id', A.sede)
        expect(r.error, describir(r as never)).toBeNull()
        expect(filas(r as never)).toEqual([
          {
            site_id: A.sede,
            contact_name: CONTACTO,
            contact_phone: '1150000000',
          },
        ])
      })
    }

    it('[anon] v_site_contacts y sites dan permiso denegado (OD-24)', async () => {
      const anon = clienteDe('anon')
      expect(
        (await tabla(anon, 'v_site_contacts').select('*')).error?.code,
      ).toBe('42501')
      expect((await tabla(anon, 'sites').select('id')).error?.code).toBe(
        '42501',
      )
    })
  })
})
