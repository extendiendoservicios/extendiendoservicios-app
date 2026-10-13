// tests/permissions/suite/91-modulos-p19.permissions.ts — P21.6c (RB-X02, AJ2-02/03/04/15/17)
//
// Tablas y vistas que llegaron con las migraciones 0040 a 0043 y que las matrices genéricas no
// tenían: avisos y anuncios (`announcements`, `announcement_recipients`, `announcement_reads`,
// `v_my_announcements`, `v_announcements_admin`, `v_announcement_recipients`), datos bancarios
// (`client_bank_details`, `employee_bank_details`), observación del turno (`shift_observations`)
// y empleados fijos de un servicio (`service_fixed_employees`). Por API directa y por los siete
// perfiles: qué ve cada uno y que ninguno escriba directo (solo por RPC), salvo
// `service_fixed_employees`, cuya política de escritura es de administradores y dueño.
//
// El esperado sale del diseño de cada migración (los comentarios de 0040, 0041 y 0042): el Plan
// 04 §7.2 todavía no documenta estas tablas. Escenario propio `e2e-perm-p19-…`, que se borra al
// final. También prueba, con reposición, `set_my_high_contrast` (0043).

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { daysFromToday } from '../../fixtures/dates.ts'
import { deleteClientDeep } from '../../fixtures/scenario.ts'
import { claves, denegado, describir, filas, tabla } from './ayudas.ts'
import { clienteDe, contexto, servicio } from './contexto.ts'
import { cuitUnico, PREFIJO } from './escenario.ts'
import { ES_ADMIN, ETIQUETA, PERFILES, type Perfil } from './perfiles.ts'
import { idPerfil, type Ve } from './tablas.ts'

const P = `${PREFIJO}p19-`

type Plantadas = Record<string, string>

interface Lectura {
  objeto: string
  clave: string
  filas: () => Plantadas
  ve: Record<Perfil, Ve>
}

const sinNada = (base: Partial<Record<Perfil, Ve>>): Record<Perfil, Ve> => ({
  anon: 'denegado',
  empleado: 'nada',
  supervisor: 'nada',
  dual: 'nada',
  adminSin: 'nada',
  admin: 'nada',
  owner: 'nada',
  ...base,
})

const ADMINS: Partial<Record<Perfil, Ve>> = {
  adminSin: 'todo',
  admin: 'todo',
  owner: 'todo',
}

describe('módulos de P19 (0040 a 0043): permisos por rol', () => {
  const ids: Record<string, string> = {}
  let clienteId = ''
  let servicioId = ''
  let turnoConObs = ''
  let turnoSinObs = ''
  /** Filas de datos bancarios que ya existían antes de la corrida (no se tocan al limpiar). */
  const bancoPrevio = new Set<string>()
  const anuncios: string[] = []

  async function borrarAnuncio(id: string) {
    const db = servicio()
    await db.from('announcement_reads').delete().eq('announcement_id', id)
    await db.from('announcement_recipients').delete().eq('announcement_id', id)
    await db.from('announcements').delete().eq('id', id)
  }

  const personasConBanco = () => {
    const c = contexto()
    return [c.ids.empleado1, c.ids.empleado2, c.ids.supervisor1, c.ids.dual]
  }

  beforeAll(async () => {
    const c = contexto()
    const db = servicio()

    // Restos de una corrida anterior que murió a medias.
    const viejos = await db
      .from('announcements')
      .select('id')
      .like('title', `${P}%`)
    for (const a of viejos.data ?? []) await borrarAnuncio(a.id)

    const cliente = await db
      .from('clients')
      .insert({
        legal_name: `${P}${Date.now().toString(36)}`,
        cuit: cuitUnico(),
      })
      .select('id')
      .single()
    if (cliente.error) throw new Error(`cliente: ${cliente.error.message}`)
    clienteId = cliente.data.id
    const sede = await db
      .from('sites')
      .insert({ client_id: clienteId, name: `${P}sede`, address: 'Calle 1' })
      .select('id')
      .single()
    if (sede.error) throw new Error(`sede: ${sede.error.message}`)
    const srv = await db
      .from('services')
      .insert({
        client_id: clienteId,
        site_id: sede.data.id,
        name: `${P}servicio`,
        weekdays: [2],
        start_time: '08:00',
        end_time: '12:00',
        valid_from: c.fechaTurno,
        required_staff: 3,
        status: 'paused',
      })
      .select('id')
      .single()
    if (srv.error) throw new Error(`servicio: ${srv.error.message}`)
    servicioId = srv.data.id

    const turno = async (hora: string) => {
      const r = await db
        .from('shifts')
        .insert({
          client_id: clienteId,
          site_id: sede.data.id,
          shift_date: daysFromToday(3),
          start_time: hora,
          end_time: '23:00',
          required_staff: 1,
        })
        .select('id')
        .single()
      if (r.error) throw new Error(`turno: ${r.error.message}`)
      return r.data.id
    }
    turnoConObs = await turno('20:00')
    turnoSinObs = await turno('21:00')
    const obs = await db
      .from('shift_observations')
      .insert({ shift_id: turnoConObs, observation: `${P}observacion` })
    if (obs.error) throw new Error(`observación: ${obs.error.message}`)

    const fijo = await db
      .from('service_fixed_employees')
      .insert({ service_id: servicioId, employee_id: c.ids.empleado2 })
    if (fijo.error) throw new Error(`fijo: ${fijo.error.message}`)

    // Datos bancarios: del cliente propio y de cuatro personas (si alguna ya tenía, no se pisa).
    const bc = await db
      .from('client_bank_details')
      .insert({ client_id: clienteId, bank_name: `${P}banco` })
    if (bc.error) throw new Error(`banco de cliente: ${bc.error.message}`)
    const previas = await db
      .from('employee_bank_details')
      .select('profile_id')
      .in('profile_id', personasConBanco())
    for (const f of previas.data ?? []) bancoPrevio.add(f.profile_id)
    for (const pid of personasConBanco()) {
      if (bancoPrevio.has(pid)) continue
      const r = await db
        .from('employee_bank_details')
        .insert({ profile_id: pid, bank_name: `${P}banco` })
      if (r.error) throw new Error(`banco de persona: ${r.error.message}`)
    }

    // Anuncios: uno por audiencia, uno de selección (solo el supervisor1) y uno archivado.
    const anuncio = async (
      slug: string,
      audience: 'employees' | 'supervisors' | 'all' | 'custom',
      archivado = false,
    ) => {
      const r = await db
        .from('announcements')
        .insert({
          title: `${P}${slug}`,
          body: `${P}texto`,
          audience,
          created_by: c.ids.owner,
          ...(archivado
            ? {
                archived_at: new Date().toISOString(),
                archived_by: c.ids.owner,
              }
            : {}),
        })
        .select('id')
        .single()
      if (r.error) throw new Error(`anuncio ${slug}: ${r.error.message}`)
      anuncios.push(r.data.id)
      return r.data.id
    }
    ids.todos = await anuncio('todos', 'all')
    ids.empleados = await anuncio('empleados', 'employees')
    ids.supervisores = await anuncio('supervisores', 'supervisors')
    ids.seleccion = await anuncio('seleccion', 'custom')
    ids.archivado = await anuncio('archivado', 'all', true)
    const dest = await db
      .from('announcement_recipients')
      .insert({ announcement_id: ids.seleccion, profile_id: c.ids.supervisor1 })
    if (dest.error) throw new Error(`destinatario: ${dest.error.message}`)
    const lecturas = await db.from('announcement_reads').insert([
      { announcement_id: ids.todos, profile_id: c.ids.empleado1 },
      { announcement_id: ids.supervisores, profile_id: c.ids.supervisor1 },
    ])
    if (lecturas.error) throw new Error(`lecturas: ${lecturas.error.message}`)
  }, 120_000)

  afterAll(async () => {
    const db = servicio()
    for (const id of anuncios) await borrarAnuncio(id)
    const propias = personasConBanco().filter((p) => !bancoPrevio.has(p))
    if (propias.length > 0)
      await db.from('employee_bank_details').delete().in('profile_id', propias)
    if (clienteId) {
      await db.from('client_bank_details').delete().eq('client_id', clienteId)
      if (servicioId)
        await db
          .from('service_fixed_employees')
          .delete()
          .eq('service_id', servicioId)
      const notas = await deleteClientDeep(db, clienteId)
      if (notas.length > 0)
        console.warn(`[permisos] p19, limpieza con notas: ${notas.join(' | ')}`)
    }
  }, 120_000)

  // ---------------------------------------------------------------------------------------------
  // Lectura
  // ---------------------------------------------------------------------------------------------

  const todosLosAnuncios = () => ({
    todos: ids.todos,
    empleados: ids.empleados,
    supervisores: ids.supervisores,
    seleccion: ids.seleccion,
    archivado: ids.archivado,
  })

  const LECTURAS: Lectura[] = [
    {
      objeto: 'announcements',
      clave: 'id',
      filas: todosLosAnuncios,
      // Cada persona lee los vigentes que le tocan por rol o por selección; administración, todos.
      ve: sinNada({
        empleado: ['todos', 'empleados'],
        supervisor: ['todos', 'supervisores', 'seleccion'],
        dual: ['todos', 'empleados', 'supervisores'],
        ...ADMINS,
      }),
    },
    {
      objeto: 'announcement_recipients',
      clave: 'announcement_id',
      filas: () => ({ seleccion: ids.seleccion }),
      ve: sinNada({ supervisor: ['seleccion'], ...ADMINS }),
    },
    {
      objeto: 'announcement_reads',
      clave: 'announcement_id',
      filas: () => ({
        lecturaEmpleado: ids.todos,
        lecturaSupervisor: ids.supervisores,
      }),
      ve: sinNada({
        empleado: ['lecturaEmpleado'],
        supervisor: ['lecturaSupervisor'],
        ...ADMINS,
      }),
    },
    {
      objeto: 'v_my_announcements',
      clave: 'id',
      filas: todosLosAnuncios,
      // Los administradores no reciben anuncios en su portada: solo los de su rol de campo.
      ve: sinNada({
        empleado: ['todos', 'empleados'],
        supervisor: ['todos', 'supervisores', 'seleccion'],
        dual: ['todos', 'empleados', 'supervisores'],
      }),
    },
    {
      objeto: 'v_announcements_admin',
      clave: 'id',
      filas: todosLosAnuncios,
      ve: sinNada({ ...ADMINS }),
    },
    {
      objeto: 'v_announcement_recipients',
      clave: 'announcement_id',
      filas: todosLosAnuncios,
      ve: sinNada({ ...ADMINS }),
    },
    {
      objeto: 'client_bank_details',
      clave: 'client_id',
      filas: () => ({ cliente: clienteId }),
      ve: sinNada({ ...ADMINS }),
    },
    {
      objeto: 'employee_bank_details',
      clave: 'profile_id',
      filas: () => {
        const c = contexto()
        return {
          empleado1: c.ids.empleado1,
          empleado2: c.ids.empleado2,
          supervisor1: c.ids.supervisor1,
          dual: c.ids.dual,
        }
      },
      // Leen administración y la propia persona (solo lectura).
      ve: sinNada({
        empleado: ['empleado1'],
        supervisor: ['supervisor1'],
        dual: ['dual'],
        ...ADMINS,
      }),
    },
    {
      objeto: 'shift_observations',
      clave: 'shift_id',
      filas: () => ({ observacion: turnoConObs }),
      ve: sinNada({ ...ADMINS }),
    },
    {
      objeto: 'service_fixed_employees',
      clave: 'service_id',
      filas: () => ({ fijo: servicioId }),
      ve: sinNada({ ...ADMINS }),
    },
  ]

  describe('lectura por perfil (RB-X02)', () => {
    for (const spec of LECTURAS) {
      describe(spec.objeto, () => {
        for (const perfil of PERFILES) {
          const ve = spec.ve[perfil]
          it(`[${ETIQUETA[perfil]}] ${spec.objeto}.select -> ${
            typeof ve === 'string' ? ve : `ve ${ve.join(', ')}`
          } (RB-X02)`, async () => {
            const plantadas = spec.filas()
            const valores = [...new Set(Object.values(plantadas))]
            const res = await tabla(clienteDe(perfil), spec.objeto)
              .select('*')
              .in(spec.clave, valores)
            if (ve === 'denegado') {
              expect(denegado(res), describir(res)).toBe(true)
              expect(filas(res)).toEqual([])
              return
            }
            expect(res.error, describir(res)).toBeNull()
            const esperadas = new Set(
              ve === 'todo'
                ? valores
                : Array.isArray(ve)
                  ? ve.map((k) => plantadas[k])
                  : [],
            )
            expect(claves(res, spec.clave)).toEqual(esperadas)
          })
        }
      })
    }

    it('contraprueba: las filas plantadas están (clave de servicio, o el dueño en las vistas) (un "cero filas" no es una tabla vacía)', async () => {
      for (const spec of LECTURAS) {
        // Vista de «lo mío»: filtra por auth.uid() y con la clave de servicio no hay.
        if (spec.objeto === 'v_my_announcements') continue
        const valores = [...new Set(Object.values(spec.filas()))]
        // Las vistas de administración llaman a `app.is_admin()`, que `service_role` no ejecuta:
        // se comprueban con el dueño.
        const res = await tabla(
          spec.objeto.startsWith('v_') ? clienteDe('owner') : servicio(),
          spec.objeto,
        )
          .select('*')
          .in(spec.clave, valores)
        expect(res.error, `${spec.objeto}: ${describir(res)}`).toBeNull()
        expect(claves(res, spec.clave), spec.objeto).toEqual(new Set(valores))
      }
    })
  })

  // ---------------------------------------------------------------------------------------------
  // Escritura directa: estas tablas solo se escriben por RPC
  // ---------------------------------------------------------------------------------------------

  interface Escritura {
    tabla: string
    pk: string[]
    insert: (quien: Perfil) => Record<string, unknown>
    objetivo: () => Record<string, string>
    parche: Record<string, unknown>
  }

  const SOLO_RPC: Escritura[] = [
    {
      tabla: 'announcements',
      pk: ['id'],
      insert: () => ({ title: `${P}directo`, body: 'x', audience: 'all' }),
      objetivo: () => ({ id: ids.todos }),
      parche: { title: `${P}editado-directo` },
    },
    {
      tabla: 'announcement_recipients',
      pk: ['announcement_id', 'profile_id'],
      insert: () => ({
        announcement_id: ids.seleccion,
        profile_id: contexto().ids.empleado1,
      }),
      objetivo: () => ({ announcement_id: ids.seleccion }),
      parche: { created_at: '2000-01-01T00:00:00Z' },
    },
    {
      tabla: 'announcement_reads',
      pk: ['announcement_id', 'profile_id'],
      // Fingir una lectura sin pasar por «Entendido».
      insert: (quien) => ({
        announcement_id: ids.empleados,
        profile_id: idPerfil(contexto(), quien),
      }),
      objetivo: () => ({ announcement_id: ids.todos }),
      parche: { read_at: '2000-01-01T00:00:00Z' },
    },
    {
      tabla: 'client_bank_details',
      pk: ['client_id'],
      insert: () => ({ client_id: contexto().e.clienteA, cbu: '0'.repeat(22) }),
      objetivo: () => ({ client_id: clienteId }),
      parche: { bank_name: `${P}editado-directo` },
    },
    {
      tabla: 'employee_bank_details',
      pk: ['profile_id'],
      insert: () => ({ profile_id: contexto().ids.empleado3 }),
      objetivo: () => ({ profile_id: contexto().ids.empleado1 }),
      parche: { bank_name: `${P}editado-directo` },
    },
    {
      tabla: 'shift_observations',
      pk: ['shift_id'],
      insert: () => ({ shift_id: turnoSinObs, observation: `${P}directo` }),
      objetivo: () => ({ shift_id: turnoConObs }),
      parche: { observation: `${P}editado-directo` },
    },
  ]

  describe('escritura directa: toda denegada (RB-X02)', () => {
    for (const spec of SOLO_RPC) {
      describe(spec.tabla, () => {
        for (const perfil of PERFILES) {
          it(`[${ETIQUETA[perfil]}] ${spec.tabla}: insert, update y delete directos -> denegados (RB-X02)`, async () => {
            const db = clienteDe(perfil)
            const [col, val] = Object.entries(spec.objetivo())[0]
            const antes = await servicio()
              .from(spec.tabla as 'announcements')
              .select('*')
              .eq(col, val)
            expect(
              antes.data?.length,
              'falta la fila objetivo',
            ).toBeGreaterThan(0)

            const ins = await tabla(db, spec.tabla)
              .insert(spec.insert(perfil))
              .select()
            if (!denegado(ins)) {
              // Quedó la fila indebida: se borra antes de fallar.
              const creada = filas(ins)[0] ?? {}
              let borrado = servicio()
                .from(spec.tabla as 'announcements')
                .delete()
              for (const k of spec.pk)
                borrado = borrado.eq(k, creada[k] as string)
              await borrado
            }
            expect(denegado(ins), `insert: ${describir(ins)}`).toBe(true)

            const upd = await tabla(db, spec.tabla)
              .update(spec.parche)
              .eq(col, val)
              .select()
            expect(denegado(upd), `update: ${describir(upd)}`).toBe(true)

            const del = await tabla(db, spec.tabla)
              .delete()
              .eq(col, val)
              .select()
            expect(denegado(del), `delete: ${describir(del)}`).toBe(true)

            // Nada cambió: la fila objetivo sigue igual.
            const despues = await servicio()
              .from(spec.tabla as 'announcements')
              .select('*')
              .eq(col, val)
            expect(despues.data).toEqual(antes.data)
          })
        }
      })
    }
  })

  describe('service_fixed_employees: escritura directa solo de administración (política de 0041)', () => {
    const victima = () => contexto().ids.empleado3

    const limpiarVictima = () =>
      servicio()
        .from('service_fixed_employees')
        .delete()
        .eq('service_id', servicioId)
        .eq('employee_id', victima())

    for (const perfil of PERFILES) {
      const puede = ES_ADMIN.includes(perfil)
      it(`[${ETIQUETA[perfil]}] service_fixed_employees: insert, update y delete directos -> ${
        puede ? 'permitidos' : 'denegados'
      } (RB-X02, AJ2-17)`, async () => {
        const db = clienteDe(perfil)
        await limpiarVictima()
        try {
          const ins = await tabla(db, 'service_fixed_employees')
            .insert({ service_id: servicioId, employee_id: victima() })
            .select()
          if (puede) {
            expect(ins.error, describir(ins)).toBeNull()
            expect(filas(ins)).toHaveLength(1)
          } else {
            expect(denegado(ins), describir(ins)).toBe(true)
            const sembrada = await servicio()
              .from('service_fixed_employees')
              .insert({ service_id: servicioId, employee_id: victima() })
            expect(sembrada.error?.message).toBeUndefined()
          }

          const upd = await tabla(db, 'service_fixed_employees')
            .update({ created_by: null })
            .eq('service_id', servicioId)
            .eq('employee_id', contexto().ids.empleado2)
            .select()
          if (puede) {
            expect(upd.error, describir(upd)).toBeNull()
            expect(filas(upd)).toHaveLength(1)
          } else {
            expect(denegado(upd), describir(upd)).toBe(true)
          }

          const del = await tabla(db, 'service_fixed_employees')
            .delete()
            .eq('service_id', servicioId)
            .eq('employee_id', victima())
            .select()
          if (puede) {
            expect(del.error, describir(del)).toBeNull()
            expect(filas(del)).toHaveLength(1)
          } else {
            expect(denegado(del), describir(del)).toBe(true)
            const sigue = await servicio()
              .from('service_fixed_employees')
              .select('employee_id')
              .eq('service_id', servicioId)
              .eq('employee_id', victima())
            expect(sigue.data).toHaveLength(1)
          }
        } finally {
          await limpiarVictima()
        }
      })
    }
  })

  describe('las vistas de anuncios no se escriben (RB-X02)', () => {
    for (const vista of [
      'v_my_announcements',
      'v_announcements_admin',
      'v_announcement_recipients',
    ]) {
      for (const perfil of PERFILES) {
        it(`[${ETIQUETA[perfil]}] ${vista}.insert -> denegado`, async () => {
          const res = await tabla(clienteDe(perfil), vista)
            .insert({ title: `${P}vista`, body: 'x', audience: 'all' })
            .select()
          expect(res.error, 'una vista no acepta inserts').not.toBeNull()
          expect(filas(res)).toEqual([])
        })
      }
    }
  })

  // ---------------------------------------------------------------------------------------------
  // Alto contraste (0043, AJ2-02): preferencia propia
  // ---------------------------------------------------------------------------------------------

  describe('set_my_high_contrast cambia solo la preferencia propia (AJ2-02)', () => {
    for (const perfil of PERFILES.filter((p) => p !== 'anon')) {
      it(`[${ETIQUETA[perfil]}] activa su alto contraste y no toca el de nadie más`, async () => {
        const c = contexto()
        const yo = idPerfil(c, perfil)
        const db = servicio()
        const antes = await db
          .from('profiles')
          .select('id, high_contrast')
          .in('id', Object.values(c.ids))
        const mio = antes.data?.find((f) => f.id === yo)?.high_contrast
        try {
          const res = await clienteDe(perfil).rpc('set_my_high_contrast', {
            p_enabled: !mio,
          })
          expect(res.error?.message).toBeUndefined()
          const despues = await db
            .from('profiles')
            .select('id, high_contrast')
            .in('id', Object.values(c.ids))
          for (const f of despues.data ?? []) {
            const previo = antes.data?.find((x) => x.id === f.id)?.high_contrast
            expect(f.high_contrast, f.id === yo ? 'el propio' : 'ajeno').toBe(
              f.id === yo ? !mio : previo,
            )
          }
        } finally {
          await db
            .from('profiles')
            .update({ high_contrast: !!mio })
            .eq('id', yo)
        }
      })
    }

    it('[anon] set_my_high_contrast -> 42501 (execute revocado)', async () => {
      const res = await clienteDe('anon').rpc('set_my_high_contrast', {
        p_enabled: true,
      })
      expect(res.error?.code).toBe('42501')
    })
  })
})
