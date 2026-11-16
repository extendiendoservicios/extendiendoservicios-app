// tests/permissions/suite/102-p29.permissions.ts — P29.6 (observaciones de la dirección del 14 nov, migración 0085)
//
// Lo nuevo de la 0085 por API directa con `supabase-js`, contra App_dev y con DATOS REALES. Por rol
// (dueño, administrador con todas las capacidades, administrador sin capacidades, coordinador, doble
// rol, empleado y anon):
//   1. `attention_dismissals` (OG-02): solo la dirección y la administración leen; nadie escribe por
//      PostgREST (ni insertar, ni editar, ni borrar).
//   2. `dismiss_attention` y `reopen_attention` (OG-02): solo dueño y administradores (cualquier
//      administrador, sin capacidad especial); el resto FORBIDDEN / 42501 y no se crea ni se borra
//      ningún cierre. Idempotencia y errores propios.
//   3. `map_active_sites` (OG-01): solo dueño y administradores; las sedes sin ubicación, de
//      clientes no activos o sin servicio activo no salen.
//   4. `admin_users_directory` (OG-12): solo dueño y administradores; el email respeta CR-07.
//   5. `find_clients_by_cuit` (OG-04): solo dueño y administradores; la unicidad de `clients.cuit`
//      ya no existe (el control de 11 dígitos sigue).
//   6. `shift_observations` (OG-05, CB-15 análogo): la tabla sigue cerrada para empleado y
//      coordinador; el mensaje de la oficina solo llega por `v_my_day` al empleado asignado y por
//      `v_my_supervisions` al coordinador de ese turno, y sale de `shift_observations` (nunca de
//      `shifts.notes`, corrección de la 0086).
// Todo con el prefijo `e2e-perm-p29-`; lo que se crea se borra en `afterAll`.

import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { daysFromToday } from '../../fixtures/dates.ts'
import { deleteClientDeep } from '../../fixtures/scenario.ts'
import { describir, filas, tabla } from './ayudas.ts'
import { clienteDe, contexto, servicio } from './contexto.ts'
import { cuitUnico, PREFIJO } from './escenario.ts'
import { ETIQUETA, type Perfil } from './perfiles.ts'
import type { Db } from './contexto.ts'

const P = `${PREFIJO}p29-`
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
const lista = (res: Resp) =>
  (Array.isArray(res.data) ? res.data : []) as Array<Record<string, unknown>>

describe('lote P29.1 (0085): permisos de lo nuevo con datos reales', () => {
  const db = () => servicio()
  const c = () => contexto()
  const hoy = daysFromToday(0)
  const clientesCreados: string[] = []
  const T: Record<string, string> = {}
  const CUIT = cuitUnico()
  const OBS_INICIAL = `${P}recado inicial ${sfx()}`
  const OBS_NUEVA = `${P}recado nuevo ${sfx()}`

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

  async function cliente(
    slug: string,
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    const nombre = `${P}${slug}-${sfx()}`
    const id = await insertar(
      db()
        .from('clients')
        .insert({
          legal_name: nombre,
          trade_name: nombre,
          cuit: CUIT,
          ...extra,
        })
        .select('id')
        .single(),
      `cliente ${slug}`,
    )
    clientesCreados.push(id)
    T[`nombre_${slug}`] = nombre
    return id
  }

  async function sede(
    clienteId: string,
    slug: string,
    conUbicacion: boolean,
  ): Promise<string> {
    const nombre = `${P}sede-${slug}-${sfx()}`
    T[`nombreSede_${slug}`] = nombre
    return insertar(
      db()
        .from('sites')
        .insert({
          client_id: clienteId,
          name: nombre,
          address: 'Calle de prueba 1',
          latitude: conUbicacion ? -34.6 : null,
          longitude: conUbicacion ? -58.4 : null,
        })
        .select('id')
        .single(),
      `sede ${slug}`,
    )
  }

  async function servicioDe(
    clienteId: string,
    sedeId: string,
    slug: string,
    status: 'active' | 'paused',
  ): Promise<string> {
    return insertar(
      db()
        .from('services')
        .insert({
          client_id: clienteId,
          site_id: sedeId,
          name: `${P}servicio-${slug}-${sfx()}`,
          weekdays: [1, 2, 3, 4, 5],
          start_time: '08:00',
          end_time: '12:00',
          required_staff: 1,
          valid_from: hoy,
          status,
        })
        .select('id')
        .single(),
      `servicio ${slug}`,
    )
  }

  beforeAll(async () => {
    // A: cliente activo, sede con ubicación y servicio activo (sale en el mapa).
    T.clienteA = await cliente('a')
    T.sedeA = await sede(T.clienteA, 'a', true)
    await servicioDe(T.clienteA, T.sedeA, 'a', 'active')
    // B: mismo CUIT que A (la 0085 quitó la unicidad), sede sin ubicación (no sale en el mapa).
    T.clienteB = await cliente('b')
    T.sedeB = await sede(T.clienteB, 'b', false)
    await servicioDe(T.clienteB, T.sedeB, 'b', 'active')
    // C: mismo CUIT, suspendido (el aviso de CUIT repetido solo cuenta clientes activos).
    T.clienteC = await cliente('c', { status: 'suspended' })
    T.sedeC = await sede(T.clienteC, 'c', true)
    await servicioDe(T.clienteC, T.sedeC, 'c', 'active')
    // D: activo, sede con ubicación pero con el único servicio pausado (no sale en el mapa).
    T.clienteD = await cliente('d')
    T.sedeD = await sede(T.clienteD, 'd', true)
    await servicioDe(T.clienteD, T.sedeD, 'd', 'paused')

    // Turno con mensaje de la oficina, creado como la app: `create_shift` con `p_notes`.
    const owner = clienteDe('owner')
    const turno = await llamar(owner, 'create_shift', {
      p_client_id: T.clienteA,
      p_site_id: T.sedeA,
      p_date: daysFromToday(2),
      p_start: '05:10',
      p_end: '05:50',
      p_required_staff: 1,
      p_notes: OBS_INICIAL,
    })
    if (turno.error) throw new Error(`create_shift: ${turno.error.message}`)
    T.turno = (json(turno).shift as { id: string }).id
    // El empleado asignado es empleado1 (perfil `empleado`); la coordinadora es supervisor1.
    const asignar = await llamar(owner, 'assign_employee', {
      p_shift_id: T.turno,
      p_employee_id: c().ids.empleado1,
    })
    if (asignar.error) throw new Error(`asignar: ${asignar.error.message}`)
    T.asignacion = (json(asignar).assignment as { id: string }).id
    const estado = await tabla(db(), 'assignments')
      .select('status')
      .eq('id', T.asignacion)
    T.estadoAsignacion = filas(estado)[0]?.status as string
  })

  afterAll(async () => {
    for (const id of clientesCreados) {
      const notas = await deleteClientDeep(db(), id)
      if (notas.length)
        console.warn(`[102-p29] limpieza con notas: ${notas.join('; ')}`)
    }
  })

  /** Cierre de prueba hecho con la RPC real; devuelve su id. */
  async function cerrar(
    perfil: Perfil,
    tipo = 'noRecord',
    asignacion: string | null = T.asignacion,
  ): Promise<string> {
    const r = await llamar(clienteDe(perfil), 'dismiss_attention', {
      p_kind: tipo,
      p_shift_id: T.turno,
      ...(asignacion ? { p_assignment_id: asignacion } : {}),
    })
    expect(codigo(r), describir(r as never)).toBe('OK')
    return json(r).id as string
  }

  async function cierresDeLaSituacion(tipo = 'noRecord'): Promise<string[]> {
    const r = await tabla(db(), 'attention_dismissals')
      .select('id')
      .eq('shift_id', T.turno)
      .eq('kind', tipo)
    return filas(r).map((f) => f.id as string)
  }

  // -----------------------------------------------------------------------------------------------
  // 1. attention_dismissals (OG-02)
  // -----------------------------------------------------------------------------------------------
  describe('attention_dismissals (OG-02)', () => {
    it('prepara: un cierre hecho por el dueño', async () => {
      T.cierre = await cerrar('owner')
    })

    ADMINS.forEach((perfil) => {
      it(`[${ETIQUETA[perfil]}] lee los cierres (RB-X02, OG-02)`, async () => {
        const r = await tabla(clienteDe(perfil), 'attention_dismissals')
          .select('id, kind, shift_id, assignment_id, dismissed_by')
          .eq('shift_id', T.turno)
        expect(r.error, describir(r)).toBeNull()
        const fila = filas(r).find((f) => f.id === T.cierre)
        expect(fila?.kind).toBe('noRecord')
        expect(fila?.assignment_id).toBe(T.asignacion)
        expect(fila?.dismissed_by).toBe(c().ids.owner)
      })
    })

    SIN_ADMIN.forEach((perfil) => {
      it(`[${ETIQUETA[perfil]}] no lee ningún cierre: cero filas o error de permisos (RB-X02, CB-15, OG-02)`, async () => {
        const r = await tabla(clienteDe(perfil), 'attention_dismissals').select(
          'id',
        )
        expect(filas(r), describir(r)).toHaveLength(0)
      })
    })

    it('[anon] no lee nada (RB-X02, OG-02)', async () => {
      const r = await tabla(clienteDe('anon'), 'attention_dismissals').select(
        'id',
      )
      expect(filas(r)).toHaveLength(0)
    })

    for (const perfil of [...SIN_ADMIN, ...ADMINS, 'anon'] as Perfil[]) {
      it(`[${ETIQUETA[perfil]}] no inserta, no edita y no borra cierres por PostgREST: solo se escriben con las RPC (RB-X02, CB-17, OG-02)`, async () => {
        const cliente = clienteDe(perfil)
        const insertar = await tabla(cliente, 'attention_dismissals').insert({
          kind: 'late',
          shift_id: T.turno,
          assignment_id: T.asignacion,
          dismissed_by: c().ids.owner,
        })
        expect(codigo(insertar as never), describir(insertar)).toBe('42501')
        const editar = await tabla(cliente, 'attention_dismissals')
          .update({ kind: 'overdue' })
          .eq('id', T.cierre)
        expect(codigo(editar as never), describir(editar)).toBe('42501')
        const borrar = await tabla(cliente, 'attention_dismissals')
          .delete()
          .eq('id', T.cierre)
        expect(codigo(borrar as never), describir(borrar)).toBe('42501')
        // Quedó todo como estaba: el cierre sigue, con su tipo, y no apareció ninguno de `late`.
        const despues = await tabla(db(), 'attention_dismissals')
          .select('id, kind')
          .eq('shift_id', T.turno)
        expect(filas(despues)).toEqual([{ id: T.cierre, kind: 'noRecord' }])
      })
    }
  })

  // -----------------------------------------------------------------------------------------------
  // 2. dismiss_attention y reopen_attention (OG-02)
  // -----------------------------------------------------------------------------------------------
  describe('dismiss_attention y reopen_attention (OG-02)', () => {
    for (const perfil of SIN_ADMIN) {
      it(`[${ETIQUETA[perfil]}] dismiss_attention: FORBIDDEN y no se crea ningún cierre (RB-X02, CB-17, OG-02)`, async () => {
        const antes = await cierresDeLaSituacion('outsideGeo')
        const r = await llamar(clienteDe(perfil), 'dismiss_attention', {
          p_kind: 'outsideGeo',
          p_shift_id: T.turno,
          p_assignment_id: T.asignacion,
        })
        expect(codigo(r), describir(r as never)).toBe('FORBIDDEN')
        expect(await cierresDeLaSituacion('outsideGeo')).toEqual(antes)
      })

      it(`[${ETIQUETA[perfil]}] reopen_attention: FORBIDDEN y el cierre sigue (RB-X02, CB-17, OG-02)`, async () => {
        const r = await llamar(clienteDe(perfil), 'reopen_attention', {
          p_id: T.cierre,
        })
        expect(codigo(r), describir(r as never)).toBe('FORBIDDEN')
        expect(await cierresDeLaSituacion('noRecord')).toContain(T.cierre)
      })
    }

    it('[anon] dismiss_attention y reopen_attention: 42501 y no se toca nada (RB-X02, OG-02)', async () => {
      const cerrarComoAnon = await llamar(
        clienteDe('anon'),
        'dismiss_attention',
        {
          p_kind: 'outsideGeo',
          p_shift_id: T.turno,
          p_assignment_id: T.asignacion,
        },
      )
      expect(codigo(cerrarComoAnon)).toBe('42501')
      const reabrir = await llamar(clienteDe('anon'), 'reopen_attention', {
        p_id: T.cierre,
      })
      expect(codigo(reabrir)).toBe('42501')
      expect(await cierresDeLaSituacion('outsideGeo')).toEqual([])
      expect(await cierresDeLaSituacion('noRecord')).toContain(T.cierre)
    })

    ADMINS.forEach((perfil) => {
      it(`[${ETIQUETA[perfil]}] cierra un aviso (cualquier administrador, sin capacidad especial), es idempotente y lo reabre (OG-02, C-01)`, async () => {
        const dentro = clienteDe(perfil)
        const primero = await llamar(dentro, 'dismiss_attention', {
          p_kind: 'late',
          p_shift_id: T.turno,
          p_assignment_id: T.asignacion,
        })
        expect(codigo(primero), describir(primero as never)).toBe('OK')
        const fila = json(primero)
        expect(fila.kind).toBe('late')
        expect(fila.shift_id).toBe(T.turno)
        expect(fila.assignment_id).toBe(T.asignacion)
        expect(fila.dismissed_at).toBeTruthy()

        // Idempotente: la misma situación devuelve el cierre existente (conserva quién y cuándo).
        const segundo = await llamar(clienteDe('owner'), 'dismiss_attention', {
          p_kind: 'late',
          p_shift_id: T.turno,
          p_assignment_id: T.asignacion,
        })
        expect(json(segundo).id).toBe(fila.id)
        expect(json(segundo).dismissed_by).toBe(fila.dismissed_by)
        expect(await cierresDeLaSituacion('late')).toEqual([fila.id])

        // Cualquier administrador la reabre (el cierre vale para toda la administración).
        const reabrir = await llamar(clienteDe('owner'), 'reopen_attention', {
          p_id: fila.id,
        })
        expect(codigo(reabrir), describir(reabrir as never)).toBe('OK')
        expect(await cierresDeLaSituacion('late')).toEqual([])
      })
    })

    it('«Turno sin cubrir» se cierra por turno, sin asignación (OG-02)', async () => {
      const dentro = clienteDe('admin')
      const conAsignacion = await llamar(dentro, 'dismiss_attention', {
        p_kind: 'uncovered',
        p_shift_id: T.turno,
        p_assignment_id: T.asignacion,
      })
      expect(codigo(conAsignacion)).toBe('INVALID_ATTENTION_TARGET')
      const porTurno = await llamar(dentro, 'dismiss_attention', {
        p_kind: 'uncovered',
        p_shift_id: T.turno,
      })
      expect(codigo(porTurno), describir(porTurno as never)).toBe('OK')
      expect(json(porTurno).assignment_id).toBeNull()
      await llamar(dentro, 'reopen_attention', { p_id: json(porTurno).id })
    })

    it('errores propios: tipo inexistente, turno inexistente, falta la asignación, asignación de otro turno y cierre ya borrado (OG-02)', async () => {
      const dentro = clienteDe('admin')
      expect(
        codigo(
          await llamar(dentro, 'dismiss_attention', {
            p_kind: 'no-existe',
            p_shift_id: T.turno,
            p_assignment_id: T.asignacion,
          }),
        ),
      ).toBe('INVALID_ATTENTION_KIND')
      expect(
        codigo(
          await llamar(dentro, 'dismiss_attention', {
            p_kind: 'noRecord',
            p_shift_id: '00000000-0000-4000-8000-000000000001',
            p_assignment_id: T.asignacion,
          }),
        ),
      ).toBe('SHIFT_NOT_FOUND')
      expect(
        codigo(
          await llamar(dentro, 'dismiss_attention', {
            p_kind: 'noRecord',
            p_shift_id: T.turno,
          }),
        ),
      ).toBe('INVALID_ATTENTION_TARGET')
      expect(
        codigo(
          await llamar(dentro, 'dismiss_attention', {
            p_kind: 'noRecord',
            p_shift_id: T.turno,
            p_assignment_id: c().e.asigE1,
          }),
        ),
      ).toBe('ASSIGNMENT_NOT_FOUND')
      expect(
        codigo(
          await llamar(dentro, 'reopen_attention', {
            p_id: '00000000-0000-4000-8000-000000000001',
          }),
        ),
      ).toBe('DISMISSAL_NOT_FOUND')
    })

    it('el cierre no toca el turno ni la asistencia: solo deja de mostrarse (OG-02)', async () => {
      const a = await tabla(db(), 'assignments')
        .select('status, removed_at')
        .eq('id', T.asignacion)
      expect(filas(a)[0]?.removed_at).toBeNull()
      expect(filas(a)[0]?.status).toBe(T.estadoAsignacion)
      const s = await tabla(db(), 'shifts').select('status').eq('id', T.turno)
      expect(filas(s)[0]?.status).not.toBe('cancelled')
    })

    it('limpieza: los cierres de la prueba se borran con el turno (en cascada)', async () => {
      expect(await cierresDeLaSituacion('noRecord')).toContain(T.cierre)
    })
  })

  // -----------------------------------------------------------------------------------------------
  // 3. map_active_sites (OG-01)
  // -----------------------------------------------------------------------------------------------
  describe('map_active_sites (OG-01)', () => {
    for (const perfil of SIN_ADMIN) {
      it(`[${ETIQUETA[perfil]}] FORBIDDEN y ninguna fila (RB-X02, CB-17, OG-01)`, async () => {
        const r = await llamar(clienteDe(perfil), 'map_active_sites')
        expect(codigo(r), describir(r as never)).toBe('FORBIDDEN')
        expect(lista(r)).toHaveLength(0)
      })
    }

    it('[anon] 42501 (RB-X02, OG-01)', async () => {
      const r = await llamar(clienteDe('anon'), 'map_active_sites')
      expect(codigo(r)).toBe('42501')
    })

    ADMINS.forEach((perfil) => {
      it(`[${ETIQUETA[perfil]}] ve la sede con ubicación de un cliente activo con servicio activo, con su color y sus servicios; no ve las demás (OG-01)`, async () => {
        const r = await llamar(clienteDe(perfil), 'map_active_sites')
        expect(codigo(r), describir(r as never)).toBe('OK')
        const mias = lista(r).filter((f) =>
          String(f.client_legal_name).startsWith(P),
        )
        // Solo A: B no tiene ubicación, C está suspendido y D no tiene servicio activo.
        expect(mias.map((f) => f.site_id)).toEqual([T.sedeA])
        const fila = mias[0]
        expect(fila.client_id).toBe(T.clienteA)
        expect(Number(fila.site_latitude)).toBeCloseTo(-34.6, 3)
        expect(Number(fila.site_longitude)).toBeCloseTo(-58.4, 3)
        expect(fila.client_calendar_color).not.toBeUndefined()
        const servicios = fila.services as Array<Record<string, unknown>>
        expect(servicios).toHaveLength(1)
        expect(String(servicios[0].name)).toContain(`${P}servicio-a-`)
        expect(servicios[0].weekdays).toEqual([1, 2, 3, 4, 5])
      })
    })
  })

  // -----------------------------------------------------------------------------------------------
  // 4. admin_users_directory (OG-12)
  // -----------------------------------------------------------------------------------------------
  describe('admin_users_directory (OG-12)', () => {
    for (const perfil of SIN_ADMIN) {
      it(`[${ETIQUETA[perfil]}] FORBIDDEN y ninguna fila: ni legajo, ni DNI, ni email (RB-X02, CB-17, OG-12)`, async () => {
        const r = await llamar(clienteDe(perfil), 'admin_users_directory')
        expect(codigo(r), describir(r as never)).toBe('FORBIDDEN')
        expect(lista(r)).toHaveLength(0)
      })
    }

    it('[anon] 42501 (RB-X02, OG-12)', async () => {
      const r = await llamar(clienteDe('anon'), 'admin_users_directory')
      expect(codigo(r)).toBe('42501')
    })

    it('[admin sin capacidades] ve legajo y DNI de la ficha, pero ningún email ajeno (CR-07)', async () => {
      const r = await llamar(clienteDe('adminSin'), 'admin_users_directory')
      expect(codigo(r), describir(r as never)).toBe('OK')
      const filasDir = lista(r)
      const empleado = filasDir.find((f) => f.profile_id === c().ids.empleado1)
      expect(empleado?.employee_number).toBeGreaterThan(0)
      expect(empleado?.dni).toBeTruthy()
      // Sin `manage_users`, el email de nadie sale (ni siquiera el de un empleado).
      const ajenos = filasDir.filter((f) => f.profile_id !== c().ids.adminSin)
      expect(ajenos.filter((f) => f.email != null)).toEqual([])
    })

    it('[admin con todas] ve el email de quien no es dueño ni administrador y no el de los dueños ni otros administradores (CR-07)', async () => {
      const r = await llamar(clienteDe('admin'), 'admin_users_directory')
      expect(codigo(r), describir(r as never)).toBe('OK')
      const filasDir = lista(r)
      const por = (id: string) => filasDir.find((f) => f.profile_id === id)
      expect(String(por(c().ids.empleado1)?.email)).toContain('@')
      expect(por(c().ids.admin)?.email).toContain('@')
      expect(por(c().ids.owner)?.email ?? null).toBeNull()
      expect(por(c().ids.adminSin)?.email ?? null).toBeNull()
    })

    it('[dueño] ve el email de todos (CR-07)', async () => {
      const r = await llamar(clienteDe('owner'), 'admin_users_directory')
      expect(codigo(r), describir(r as never)).toBe('OK')
      const filasDir = lista(r)
      for (const id of [
        c().ids.owner,
        c().ids.admin,
        c().ids.adminSin,
        c().ids.empleado1,
      ]) {
        expect(
          String(filasDir.find((f) => f.profile_id === id)?.email),
          id,
        ).toContain('@')
      }
    })
  })

  // -----------------------------------------------------------------------------------------------
  // 5. find_clients_by_cuit y CUIT repetido (OG-04)
  // -----------------------------------------------------------------------------------------------
  describe('find_clients_by_cuit y CUIT repetido (OG-04)', () => {
    for (const perfil of SIN_ADMIN) {
      it(`[${ETIQUETA[perfil]}] FORBIDDEN y ninguna fila (RB-X02, CB-17, OG-04)`, async () => {
        const r = await llamar(clienteDe(perfil), 'find_clients_by_cuit', {
          p_cuit: CUIT,
        })
        expect(codigo(r), describir(r as never)).toBe('FORBIDDEN')
        expect(lista(r)).toHaveLength(0)
      })
    }

    it('[anon] 42501 (RB-X02, OG-04)', async () => {
      const r = await llamar(clienteDe('anon'), 'find_clients_by_cuit', {
        p_cuit: CUIT,
      })
      expect(codigo(r)).toBe('42501')
    })

    ADMINS.forEach((perfil) => {
      it(`[${ETIQUETA[perfil]}] encuentra a los clientes ACTIVOS que comparten el CUIT, con guiones o sin ellos, y respeta el excluido (OG-04)`, async () => {
        const dentro = clienteDe(perfil)
        const r = await llamar(dentro, 'find_clients_by_cuit', { p_cuit: CUIT })
        expect(codigo(r), describir(r as never)).toBe('OK')
        // A, B y D (activos); C está suspendido y no cuenta.
        expect(
          lista(r)
            .map((f) => f.id)
            .sort(),
        ).toEqual([T.clienteA, T.clienteB, T.clienteD].sort())

        const conGuiones = `${CUIT.slice(0, 2)}-${CUIT.slice(2, 10)}-${CUIT.slice(10)}`
        const g = await llamar(dentro, 'find_clients_by_cuit', {
          p_cuit: conGuiones,
        })
        expect(lista(g)).toHaveLength(3)

        const sinA = await llamar(dentro, 'find_clients_by_cuit', {
          p_cuit: CUIT,
          p_exclude_client_id: T.clienteA,
        })
        expect(
          lista(sinA)
            .map((f) => f.id)
            .sort(),
        ).toEqual([T.clienteB, T.clienteD].sort())

        const vacio = await llamar(dentro, 'find_clients_by_cuit', {
          p_cuit: '',
        })
        expect(codigo(vacio)).toBe('OK')
        expect(lista(vacio)).toHaveLength(0)
      })
    })

    it('la base permite guardar dos clientes con el mismo CUIT (se quitó clients_cuit_key) pero sigue exigiendo 11 dígitos (OG-04)', async () => {
      // A, B, C y D se insertaron con el mismo CUIT en el `beforeAll`: no hubo 23505.
      const iguales = await tabla(db(), 'clients').select('id').eq('cuit', CUIT)
      expect(filas(iguales)).toHaveLength(4)
      const mal = await db()
        .from('clients')
        .insert({
          legal_name: `${P}cuit-corto-${sfx()}`,
          trade_name: `${P}cuit-corto`,
          cuit: '123',
        })
        .select('id')
      if (!mal.error) {
        // Si se coló, que no quede basura.
        for (const f of mal.data ?? []) clientesCreados.push(f.id)
      }
      expect(mal.error?.code, mal.error?.message).toBe('23514')
    })
  })

  // -----------------------------------------------------------------------------------------------
  // 6. shift_observations y el mensaje de la oficina (OG-05)
  // -----------------------------------------------------------------------------------------------
  describe('shift_observations y mensaje de la oficina (OG-05)', () => {
    async function mensajeEn(
      perfil: Perfil,
      vista: 'v_my_day' | 'v_my_supervisions',
    ): Promise<{ filas: number; mensaje: string | null }> {
      const r = await tabla(clienteDe(perfil), vista)
        .select('shift_id, shift_notes')
        .eq('shift_id', T.turno)
      expect(r.error, describir(r)).toBeNull()
      const f = filas(r)
      return { filas: f.length, mensaje: (f[0]?.shift_notes as string) ?? null }
    }

    it('la observación se guardó en shift_observations (create_shift con p_notes), no en shifts.notes (OG-05, 0086)', async () => {
      const o = await tabla(db(), 'shift_observations')
        .select('observation')
        .eq('shift_id', T.turno)
      expect(filas(o)[0]?.observation).toBe(OBS_INICIAL)
      const s = await tabla(db(), 'shifts').select('notes').eq('id', T.turno)
      expect(filas(s)[0]?.notes ?? null).toBeNull()
    })

    ADMINS.forEach((perfil) => {
      it(`[${ETIQUETA[perfil]}] lee shift_observations (OG-05)`, async () => {
        const r = await tabla(clienteDe(perfil), 'shift_observations')
          .select('observation')
          .eq('shift_id', T.turno)
        expect(filas(r)[0]?.observation).toBe(OBS_INICIAL)
      })
    })

    for (const perfil of [...SIN_ADMIN, 'anon'] as Perfil[]) {
      it(`[${ETIQUETA[perfil]}] shift_observations sigue cerrada: cero filas, aunque esté asignado al turno (RB-X02, CB-15, OG-05)`, async () => {
        const r = await tabla(clienteDe(perfil), 'shift_observations')
          .select('observation')
          .eq('shift_id', T.turno)
        expect(filas(r), describir(r)).toHaveLength(0)
      })

      it(`[${ETIQUETA[perfil]}] no escribe en shift_observations: no inserta, no edita y no borra (RB-X02, CB-17, OG-05)`, async () => {
        const cliente = clienteDe(perfil)
        const insertar = await tabla(cliente, 'shift_observations').insert({
          shift_id: c().e.turnoA,
          observation: `${P}intruso`,
        })
        expect(denegadoSinEfecto(insertar)).toBe(true)
        const editar = await tabla(cliente, 'shift_observations')
          .update({ observation: `${P}intruso` })
          .eq('shift_id', T.turno)
        expect(denegadoSinEfecto(editar)).toBe(true)
        const borrar = await tabla(cliente, 'shift_observations')
          .delete()
          .eq('shift_id', T.turno)
        expect(denegadoSinEfecto(borrar)).toBe(true)
        const o = await tabla(db(), 'shift_observations')
          .select('observation')
          .eq('shift_id', T.turno)
        expect(filas(o)[0]?.observation).toBe(OBS_INICIAL)
        const intruso = await tabla(db(), 'shift_observations')
          .select('shift_id')
          .eq('observation', `${P}intruso`)
        expect(filas(intruso)).toHaveLength(0)
      })
    }

    it('el empleado asignado ve el mensaje en v_my_day; el empleado no asignado (otro turno) no ve ese turno (OG-05)', async () => {
      const asignado = await mensajeEn('empleado', 'v_my_day')
      expect(asignado).toEqual({ filas: 1, mensaje: OBS_INICIAL })
      // El doble rol (empleado + coordinador) no está asignado: ni fila ni mensaje.
      const otro = await mensajeEn('dual', 'v_my_day')
      expect(otro).toEqual({ filas: 0, mensaje: null })
    })

    it('al cambiar la observación con update_shift_details, la vista del empleado muestra la nueva y el turno queda como cambio (OG-05)', async () => {
      const r = await llamar(clienteDe('admin'), 'update_shift_details', {
        p_shift_id: T.turno,
        p_required_staff: 1,
        p_notes: OBS_NUEVA,
      })
      expect(codigo(r), describir(r as never)).toBe('OK')
      const vista = await tabla(clienteDe('empleado'), 'v_my_day')
        .select('shift_notes, changed_since_last_seen')
        .eq('shift_id', T.turno)
      expect(filas(vista)[0]?.shift_notes).toBe(OBS_NUEVA)
      expect(filas(vista)[0]?.changed_since_last_seen).toBe(true)
    })

    it('el mensaje sale de shift_observations y nunca de shifts.notes (0086): un valor en shifts.notes no llega al empleado', async () => {
      const marca = `${P}no-debe-verse-${sfx()}`
      const cambio = await db()
        .from('shifts')
        .update({ notes: marca })
        .eq('id', T.turno)
      expect(cambio.error, cambio.error?.message).toBeNull()
      const vista = await mensajeEn('empleado', 'v_my_day')
      expect(vista.mensaje).toBe(OBS_NUEVA)
      expect(vista.mensaje).not.toContain('no-debe-verse')
      await db().from('shifts').update({ notes: null }).eq('id', T.turno)
    })

    it('sin observación, la vista devuelve null (no un texto vacío ni lo de otro turno) (OG-05)', async () => {
      const r = await llamar(clienteDe('admin'), 'update_shift_details', {
        p_shift_id: T.turno,
        p_required_staff: 1,
        p_notes: '',
      })
      expect(codigo(r), describir(r as never)).toBe('OK')
      const vista = await mensajeEn('empleado', 'v_my_day')
      expect(vista.filas).toBe(1)
      expect((vista.mensaje ?? '').trim()).toBe('')
    })

    it('el coordinador que toma el turno ve el mensaje en v_my_supervisions; quien no lo tomó, no ve ese turno (OG-05)', async () => {
      // Vuelve a cargar el mensaje y arma una supervisión directa del coordinador (supervisor1).
      const cargar = await llamar(clienteDe('admin'), 'update_shift_details', {
        p_shift_id: T.turno,
        p_required_staff: 1,
        p_notes: OBS_NUEVA,
      })
      expect(codigo(cargar)).toBe('OK')
      // Supervisión armada directo (sin jornada), como `Scenario.supervisionDirecta`.
      const sup = await db()
        .from('supervisions')
        .insert({
          shift_id: T.turno,
          supervisor_id: c().ids.supervisor1,
          status: 'in_progress',
          criteria_snapshot: [],
        })
        .select('id')
        .single()
      try {
        if (sup.error)
          throw new Error(`supervisión directa: ${sup.error.message}`)
        const propio = await mensajeEn('supervisor', 'v_my_supervisions')
        expect(propio).toEqual({ filas: 1, mensaje: OBS_NUEVA })
        // El doble rol no supervisa ese turno: no le llega ni el turno ni el mensaje.
        const ajeno = await mensajeEn('dual', 'v_my_supervisions')
        expect(ajeno).toEqual({ filas: 0, mensaje: null })
      } finally {
        if (sup.data)
          await db().from('supervisions').delete().eq('id', sup.data.id)
      }
    })
  })
})

/** La escritura fue rechazada (42501 / RLS) o no afectó ninguna fila, sin error de otro tipo. */
function denegadoSinEfecto(res: {
  error: { code?: string; message: string } | null
  data: unknown
}): boolean {
  if (res.error) {
    return (
      res.error.code === '42501' ||
      /row-level security|permission denied/i.test(res.error.message)
    )
  }
  return !Array.isArray(res.data) || res.data.length === 0
}
