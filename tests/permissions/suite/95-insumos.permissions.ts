// tests/permissions/suite/95-insumos.permissions.ts — P25.5c (módulo E, Insumos y control de stock)
//
// Matriz de permisos de Insumos (migraciones 0069 a 0072) por API directa (`supabase-js`) y por
// los siete perfiles de la matriz (anon, empleado, coordinador, doble rol, administrador sin
// capacidades, administrador con todas -incluida `manage_stock`- y dueño), más el administrador
// que además trabaja turnos como empleado (IS-35, `adminOperativo`). El esperado sale de
// `modulos/E_insumos_y_stock.md` (IS-19 a IS-21, IS-27, IS-28, IS-35) y de `docs/database.md`, no
// de lo que el código hace hoy.
//
// Qué cubre:
//   - las 8 tablas nuevas: lectura (solo administración) y escritura directa (ninguna, todo va por
//     RPC) para los siete perfiles;
//   - las 11 vistas: qué filas ve cada perfil y que ninguna se escribe; que las del celular no
//     exponen precios ni cantidades (IS-20);
//   - las 12 RPC: la puerta de cada una por perfil (FORBIDDEN, 42501 o pasa la puerta), la
//     contraprueba positiva de los que sí pueden y sus errores de negocio;
//   - el stock nunca negativo (incluso con retiros simultáneos) y los movimientos inmutables;
//   - el retiro en nombre de otra persona de quien también trabaja turnos (IS-35);
//   - el bucket `supply-images`;
//   - cuentas desactivadas con el token todavía vigente (CB-18) y el escalamiento de la capacidad
//     nueva (CB-17).
//
// Datos propios con el prefijo `e2e-permstock-` (artículos, categoría, observaciones) y clientes
// `e2e-perm-p25-`. Se borran al final: primero lo de Insumos (los movimientos son inmutables y el
// borrado pasa por `purgarInsumosE2e`) y después los clientes. El stock de los artículos del seed
// no se toca: la suite compara una instantánea antes y después.

import type { PostgrestError } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { daysFromToday } from '../../fixtures/dates.ts'
import { requireE2eEnv } from '../../fixtures/env.ts'
import { deleteClientDeep } from '../../fixtures/scenario.ts'
import { signedClient } from '../../fixtures/sessions.ts'
import { InsumosE2e } from '../../fixtures/stock.ts'
import { claves, denegado, describir, filas, tabla } from './ayudas.ts'
import {
  clienteConToken,
  clienteDe,
  contexto,
  servicio,
  tokenVigente,
  type Db,
} from './contexto.ts'
import { caso, claveCaso } from './defectos.ts'
import { cuitUnico, PREFIJO } from './escenario.ts'
import { ETIQUETA, PERFILES, type Perfil } from './perfiles.ts'
import { idPerfil, type Ve } from './tablas.ts'

const MARCA = 'permstock'
const ins = new InsumosE2e(MARCA)
const P = `${PREFIJO}p25-`
const INEXISTENTE = '00000000-0000-4000-8000-000000000000'

// ---------------------------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------------------------

interface Res {
  data: unknown
  error: PostgrestError | null
}

/** Llama una RPC por nombre (sin tipos: la matriz arma los argumentos). */
async function rpc(db: Db, nombre: string, args: object = {}): Promise<Res> {
  return await db.rpc(nombre as never, args as never)
}

/** `ok`, el `hint` del error de negocio, o el código SQL (por ejemplo `42501`). */
function codigo(res: Res): string {
  if (!res.error) return 'ok'
  return res.error.hint ?? res.error.code
}

const ADMIN_STOCK: readonly Perfil[] = ['admin', 'owner']
const CAMPO: readonly Perfil[] = ['empleado', 'supervisor', 'dual']

/** Esperado por perfil: `anon` siempre 42501 en las RPC (execute revocado). */
function porPerfil(
  valores: Partial<Record<Perfil, string>> & { resto?: string },
): Record<Perfil, string> {
  const salida = {} as Record<Perfil, string>
  for (const p of PERFILES) {
    salida[p] = valores[p] ?? valores.resto ?? 'FORBIDDEN'
  }
  return salida
}

type Json = Record<string, unknown>

function aJson(valor: unknown): Json {
  return (valor ?? {}) as Json
}

/** Claves de todos los objetos de un árbol JSON (para afirmar que no hay precios ni stock). */
function clavesDelArbol(valor: unknown, acumulado = new Set<string>()) {
  if (Array.isArray(valor)) {
    for (const x of valor) clavesDelArbol(x, acumulado)
  } else if (valor && typeof valor === 'object') {
    for (const [k, v] of Object.entries(valor)) {
      acumulado.add(k)
      clavesDelArbol(v, acumulado)
    }
  }
  return acumulado
}

/** Claves que un empleado o un coordinador nunca pueden ver (IS-20). */
const PROHIBIDAS_EN_CELULAR =
  /(^|_)(cost|sale|price|stock|min|value|unit|total_cost|total_sale)(_|$)/i

describe('Insumos (0069 a 0072): permisos por rol', () => {
  const c = () => contexto()
  const id: Record<string, string> = {}
  const clientes: string[] = []
  const subidos: string[] = []
  let snapshotSeed: Array<{ code: string; stock_qty: number }> = []
  let adminOperativo: Db

  const tomar = <T>(
    que: string,
    res: { data: T; error: unknown },
  ): NonNullable<T> => {
    const e = res.error as { message?: string } | null
    if (e || res.data === null || res.data === undefined) {
      throw new Error(`${que}: ${e?.message ?? 'sin datos'}`)
    }
    return res.data
  }

  async function stockDe(supplyId: string): Promise<number> {
    const r = await servicio()
      .from('supplies')
      .select('stock_qty')
      .eq('id', supplyId)
      .single()
    return tomar('stock', r).stock_qty
  }

  async function snapshot() {
    const r = await servicio()
      .from('supplies')
      .select('code, stock_qty')
      .not('code', 'ilike', 'e2e-%')
      .order('code')
    return tomar('snapshot', r)
  }

  beforeAll(async () => {
    const ctx = c()
    const db = servicio()
    const dueno = clienteDe('owner')
    await ins.purgar()
    snapshotSeed = await snapshot()

    // Clientes, sedes y turnos propios. P: sedes P1 y P2; Q: sede Q1.
    const cliente = async (slug: string) => {
      const r = await db
        .from('clients')
        .insert({
          legal_name: `${P}${slug}-${Date.now().toString(36)}`,
          cuit: cuitUnico(),
        })
        .select('id')
        .single()
      const fila = tomar(`cliente ${slug}`, r)
      clientes.push(fila.id)
      return fila.id
    }
    const sede = async (clienteId: string, slug: string) =>
      tomar(
        `sede ${slug}`,
        await db
          .from('sites')
          .insert({
            client_id: clienteId,
            name: `${P}${slug}`,
            address: 'Calle 1',
          })
          .select('id')
          .single(),
      ).id
    const turno = async (
      clienteId: string,
      sedeId: string,
      fecha: string,
      hora: string,
    ) =>
      tomar(
        `turno ${fecha}`,
        await db
          .from('shifts')
          .insert({
            client_id: clienteId,
            site_id: sedeId,
            shift_date: fecha,
            start_time: hora,
            end_time: '23:00',
            required_staff: 1,
          })
          .select('id')
          .single(),
      ).id

    const clienteP = await cliente('cliente-p')
    const clienteQ = await cliente('cliente-q')
    id.sedeP1 = await sede(clienteP, 'sede-p1')
    id.sedeP2 = await sede(clienteP, 'sede-p2')
    id.sedeQ1 = await sede(clienteQ, 'sede-q1')
    id.turnoE1 = await turno(clienteP, id.sedeP1, daysFromToday(1), '20:00')
    id.turnoE2 = await turno(clienteP, id.sedeP2, daysFromToday(2), '20:00')
    id.turnoPasado = await turno(
      clienteQ,
      id.sedeQ1,
      daysFromToday(-1),
      '20:00',
    )
    id.turnoLejano = await turno(
      clienteQ,
      id.sedeQ1,
      daysFromToday(20),
      '20:00',
    )
    id.turnoCancelado = await turno(
      clienteP,
      id.sedeP1,
      daysFromToday(3),
      '20:00',
    )
    for (const [turnoId, quien] of [
      [id.turnoE1, ctx.ids.empleado1],
      [id.turnoE2, ctx.ids.empleado2],
    ] as const) {
      const r = await rpc(dueno, 'assign_employee', {
        p_shift_id: turnoId,
        p_employee_id: quien,
      })
      expect(r.error?.message, 'asignación de preparación').toBeUndefined()
    }
    const cancelado = await rpc(dueno, 'cancel_shift', {
      p_shift_id: id.turnoCancelado,
      p_reason: `${P}cancelado`,
    })
    expect(cancelado.error?.message, 'turno cancelado').toBeUndefined()

    // Artículos: A con stock y mínimo, B en cero, C desactivado, D y E para las simultáneas.
    const categoria = await ins.categoria('cat')
    id.categoria = categoria.id
    const a = await ins.insumo({
      slug: 'a',
      stock: 10,
      minQty: 3,
      categoryId: categoria.id,
      presentation: '1 L',
    })
    const b = await ins.insumo({ slug: 'b', categoryId: categoria.id })
    const cc = await ins.insumo({ slug: 'c', categoryId: categoria.id })
    const d = await ins.insumo({
      slug: 'd',
      stock: 3,
      categoryId: categoria.id,
    })
    const e = await ins.insumo({
      slug: 'e',
      stock: 3,
      categoryId: categoria.id,
    })
    Object.assign(id, {
      sA: a.id,
      sB: b.id,
      sC: cc.id,
      sD: d.id,
      sE: e.id,
      codeA: a.code,
      nameA: a.name,
      nameD: d.name,
    })
    const desactivado = await rpc(dueno, 'set_supply_active', {
      p_supply_id: id.sC,
      p_active: false,
    })
    expect(desactivado.error?.message, 'desactivar C').toBeUndefined()
    const precios = await rpc(dueno, 'set_supply_prices', {
      p_supply_id: id.sA,
      p_cost_price: 20,
      p_sale_price: 30,
    })
    expect(precios.error?.message, 'precios de A').toBeUndefined()

    // Movimientos: ingreso (el de preparación de A), retiros de empleado, en nombre de y de
    // coordinador, ajuste y control.
    const ingreso = tomar(
      'ingreso de A',
      await db
        .from('stock_movement_lines')
        .select('movement_id')
        .eq('supply_id', id.sA)
        .limit(1)
        .single(),
    )
    id.mIngreso = ingreso.movement_id
    const retiro = async (
      db2: Db,
      args: object,
      que: string,
    ): Promise<string> => {
      const r = await rpc(db2, 'register_withdrawal', args)
      expect(r.error?.message, que).toBeUndefined()
      return aJson(aJson(r.data).movement).id as string
    }
    id.mR1 = await retiro(
      clienteDe('empleado'),
      {
        p_lines: [{ supply_id: id.sA, qty: 1 }],
        p_shift_id: id.turnoE1,
        p_note: ins.texto('retiro-1'),
      },
      'retiro del empleado',
    )
    id.mR2 = await retiro(
      dueno,
      {
        p_lines: [{ supply_id: id.sA, qty: 1 }],
        p_shift_id: id.turnoE2,
        p_person_id: ctx.ids.empleado2,
        p_note: ins.texto('retiro-2'),
      },
      'retiro en nombre de',
    )
    id.mR3 = await retiro(
      clienteDe('supervisor'),
      {
        p_lines: [{ supply_id: id.sA, qty: 1 }],
        p_site_id: id.sedeQ1,
        p_note: ins.texto('retiro-3'),
      },
      'retiro del coordinador',
    )
    const ajuste = await rpc(dueno, 'adjust_stock', {
      p_supply_id: id.sA,
      p_delta: -1,
      p_reason: 'breakage',
      p_note: ins.texto('ajuste'),
    })
    expect(ajuste.error?.message, 'ajuste').toBeUndefined()
    id.mAjuste = aJson(aJson(ajuste.data).movement).id as string
    id.mAjusteAt = aJson(aJson(ajuste.data).movement).recorded_at as string

    const actual = await stockDe(id.sA)
    const control = await rpc(dueno, 'register_stock_count', {
      p_counted_at: id.mAjusteAt,
      p_lines: [{ supply_id: id.sA, counted_qty: actual - 2 }],
      p_reviewer_name: ins.texto('revisor'),
      p_notes: ins.texto('control'),
    })
    expect(control.error?.message, 'control').toBeUndefined()
    id.countId = aJson(aJson(control.data).count).id as string
    id.mControl = aJson(aJson(control.data).movement).id as string

    // Avisos de faltante: del empleado1 (texto libre) y del coordinador (artículo y sede).
    const aviso = async (db2: Db, args: object, que: string) => {
      const r = await rpc(db2, 'report_supply_shortage', args)
      expect(r.error?.message, que).toBeUndefined()
      return aJson(r.data).id as string
    }
    id.avisoE1 = await aviso(
      clienteDe('empleado'),
      { p_description: ins.texto('falta-libre'), p_shift_id: id.turnoE1 },
      'aviso del empleado',
    )
    id.avisoS1 = await aviso(
      clienteDe('supervisor'),
      {
        p_supply_id: id.sA,
        p_site_id: id.sedeQ1,
        p_comment: ins.texto('aviso-sup'),
      },
      'aviso del coordinador',
    )

    // Ids de líneas y de historial de precios (para la lectura de las tablas hijas).
    const lineas = tomar(
      'líneas',
      await db
        .from('stock_movement_lines')
        .select('id, movement_id')
        .in('movement_id', [
          id.mIngreso,
          id.mR1,
          id.mR2,
          id.mR3,
          id.mAjuste,
          id.mControl,
        ]),
    )
    id.linea1 = lineas.find((l) => l.movement_id === id.mR1)!.id
    id.linea2 = lineas.find((l) => l.movement_id === id.mR2)!.id
    id.lineaIngreso = lineas.find((l) => l.movement_id === id.mIngreso)!.id
    const cambio = tomar(
      'historial de precios',
      await db
        .from('supply_price_changes')
        .select('id')
        .eq('supply_id', id.sA)
        .limit(1)
        .single(),
    )
    id.cambioPrecio = cambio.id

    // Objetos del bucket para leer, reemplazar y borrar.
    for (const nombre of ['lectura', 'reemplazo', 'borrado']) {
      subidos.push(`${id.sA}/${P}${nombre}.jpg`)
    }
    for (const ruta of subidos) {
      const { error } = await db.storage
        .from('supply-images')
        .upload(ruta, JPEG, { contentType: 'image/jpeg', upsert: true })
      if (error) throw new Error(`plantar ${ruta}: ${error.message}`)
    }

    adminOperativo = await signedClient('adminOperativo')
  }, 240_000)

  afterAll(async () => {
    const db = servicio()
    if (subidos.length > 0)
      await db.storage.from('supply-images').remove(subidos)
    const notas = await ins.purgar()
    for (const clienteId of clientes) {
      notas.push(...(await deleteClientDeep(db, clienteId)))
    }
    if (notas.length > 0) {
      console.warn(
        `[permisos] insumos, limpieza con notas: ${notas.join(' | ')}`,
      )
    }
  }, 240_000)

  // -------------------------------------------------------------------------------------------
  // 1. Tablas: lectura solo de administración y ninguna escritura directa
  // -------------------------------------------------------------------------------------------

  interface TablaStock {
    tabla: string
    clave: string
    filas: () => Record<string, string>
    objetivo: () => [string, string]
    insert: (quien: Perfil) => Json
    parche: Json
  }

  const uid = (quien: Perfil) =>
    quien === 'anon' ? INEXISTENTE : idPerfil(c(), quien)

  const TABLAS_STOCK: TablaStock[] = [
    {
      tabla: 'supply_categories',
      clave: 'id',
      filas: () => ({ categoria: id.categoria }),
      objetivo: () => ['id', id.categoria],
      insert: () => ({ name: `${ins.prefijo}directa` }),
      parche: { name: `${ins.prefijo}editada-directo` },
    },
    {
      tabla: 'supplies',
      clave: 'id',
      filas: () => ({ a: id.sA, b: id.sB, c: id.sC }),
      objetivo: () => ['id', id.sA],
      insert: () => ({
        code: `${ins.prefijo}directo`,
        name: `${ins.prefijo}directo`,
        category_id: id.categoria,
      }),
      // El que más importa: el stock solo lo escriben las RPC (IS-13, IS-27).
      parche: { stock_qty: 999 },
    },
    {
      tabla: 'supply_price_changes',
      clave: 'id',
      filas: () => ({ cambio: id.cambioPrecio }),
      objetivo: () => ['id', id.cambioPrecio],
      insert: () => ({
        supply_id: id.sA,
        new_cost_price: 1,
        new_sale_price: 1,
      }),
      parche: { new_cost_price: 0 },
    },
    {
      tabla: 'stock_movements',
      clave: 'id',
      filas: () => ({
        ingreso: id.mIngreso,
        r1: id.mR1,
        r2: id.mR2,
        r3: id.mR3,
        ajuste: id.mAjuste,
        control: id.mControl,
      }),
      objetivo: () => ['id', id.mR1],
      insert: (quien) => ({
        kind: 'adjustment',
        reason: 'other',
        note: `${ins.prefijo}directo`,
        recorded_by: uid(quien),
      }),
      parche: { note: `${ins.prefijo}editado-directo` },
    },
    {
      tabla: 'stock_movement_lines',
      clave: 'id',
      filas: () => ({ l1: id.linea1, l2: id.linea2, li: id.lineaIngreso }),
      objetivo: () => ['id', id.linea1],
      insert: () => ({
        movement_id: id.mR1,
        supply_id: id.sB,
        qty_delta: 1,
        unit_cost: 0,
        unit_sale: 0,
        stock_after: 1,
      }),
      parche: { qty_delta: 99 },
    },
    {
      tabla: 'stock_counts',
      clave: 'id',
      filas: () => ({ control: id.countId }),
      objetivo: () => ['id', id.countId],
      insert: (quien) => ({
        counted_at: new Date().toISOString(),
        reviewer_name: `${ins.prefijo}directo`,
        created_by: uid(quien),
      }),
      parche: { notes: `${ins.prefijo}editado-directo` },
    },
    {
      tabla: 'stock_count_lines',
      clave: 'count_id',
      filas: () => ({ control: id.countId }),
      objetivo: () => ['count_id', id.countId],
      insert: () => ({
        count_id: id.countId,
        supply_id: id.sB,
        system_qty: 0,
        counted_qty: 0,
        difference: 0,
      }),
      parche: { counted_qty: 5 },
    },
    {
      tabla: 'supply_shortage_reports',
      clave: 'id',
      filas: () => ({ e1: id.avisoE1, s1: id.avisoS1 }),
      objetivo: () => ['id', id.avisoE1],
      insert: (quien) => ({
        reported_by: uid(quien),
        description: `${ins.prefijo}directo`,
      }),
      parche: { status: 'resolved' },
    },
  ]

  /** Administración lee todo; empleado, coordinador y doble rol, nada; `anon`, error. */
  const VE_SOLO_ADMIN: Record<Perfil, Ve> = {
    anon: 'denegado',
    empleado: 'nada',
    supervisor: 'nada',
    dual: 'nada',
    adminSin: 'todo',
    admin: 'todo',
    owner: 'todo',
  }

  describe('tablas: lectura (IS-20, IS-21, 04 §7.2)', () => {
    for (const spec of TABLAS_STOCK) {
      describe(spec.tabla, () => {
        for (const perfil of PERFILES) {
          const ve = VE_SOLO_ADMIN[perfil]
          it(`[${ETIQUETA[perfil]}] ${spec.tabla}.select -> ${String(ve)} (RB-X02, IS-20, IS-21)`, async () => {
            const plantadas = spec.filas()
            const valores = [...new Set(Object.values(plantadas))]
            const res = await tabla(clienteDe(perfil), spec.tabla)
              .select('*')
              .in(spec.clave, valores)
            if (ve === 'denegado') {
              expect(denegado(res), describir(res)).toBe(true)
              expect(filas(res)).toEqual([])
              return
            }
            expect(res.error, describir(res)).toBeNull()
            expect(claves(res, spec.clave)).toEqual(
              new Set(ve === 'todo' ? valores : []),
            )
          })
        }
      })
    }

    it('contraprueba: las filas plantadas existen (un "cero filas" no es una tabla vacía)', async () => {
      for (const spec of TABLAS_STOCK) {
        const valores = [...new Set(Object.values(spec.filas()))]
        const res = await tabla(servicio(), spec.tabla)
          .select('*')
          .in(spec.clave, valores)
        expect(res.error, `${spec.tabla}: ${describir(res)}`).toBeNull()
        expect(claves(res, spec.clave), spec.tabla).toEqual(new Set(valores))
      }
    })
  })

  describe('tablas: sin escritura directa, ni siquiera la administración (IS-13, IS-27, RB-X02)', () => {
    for (const spec of TABLAS_STOCK) {
      describe(spec.tabla, () => {
        for (const perfil of PERFILES) {
          it(`[${ETIQUETA[perfil]}] ${spec.tabla}: insert, update y delete directos -> denegados (RB-X02, IS-27)`, async () => {
            const bd = clienteDe(perfil)
            const [col, val] = spec.objetivo()
            const antes = await tabla(servicio(), spec.tabla)
              .select('*')
              .eq(col, val)
            expect(
              filas(antes).length,
              'falta la fila objetivo',
            ).toBeGreaterThan(0)

            const ins1 = await tabla(bd, spec.tabla)
              .insert(spec.insert(perfil))
              .select()
            expect(denegado(ins1), `insert: ${describir(ins1)}`).toBe(true)
            // Si por un defecto entró, se registra para la limpieza antes de fallar: la purga
            // borra por prefijo y por artículo, así que alcanza con que lleve el prefijo.
            expect(filas(ins1), 'el insert directo creó filas').toEqual([])

            const upd = await tabla(bd, spec.tabla)
              .update(spec.parche)
              .eq(col, val)
              .select()
            expect(denegado(upd), `update: ${describir(upd)}`).toBe(true)

            const del = await tabla(bd, spec.tabla)
              .delete()
              .eq(col, val)
              .select()
            expect(denegado(del), `delete: ${describir(del)}`).toBe(true)

            const despues = await tabla(servicio(), spec.tabla)
              .select('*')
              .eq(col, val)
            expect(filas(despues), 'la fila objetivo cambió').toEqual(
              filas(antes),
            )
          })
        }
      })
    }
  })

  // -------------------------------------------------------------------------------------------
  // 2. Inmutabilidad (IS-27): ni siquiera la clave de servicio edita ni borra un movimiento
  // -------------------------------------------------------------------------------------------

  describe('movimientos, controles e historial de precios inmutables (IS-27, 04)', () => {
    const CASOS: Array<{
      tabla: string
      col: string
      valor: () => string
      parche: Json
    }> = [
      {
        tabla: 'stock_movements',
        col: 'id',
        valor: () => id.mR1,
        parche: { note: 'editado' },
      },
      {
        tabla: 'stock_movement_lines',
        col: 'id',
        valor: () => id.linea1,
        parche: { qty_delta: -50 },
      },
      {
        tabla: 'stock_counts',
        col: 'id',
        valor: () => id.countId,
        parche: { notes: 'editado' },
      },
      {
        tabla: 'stock_count_lines',
        col: 'count_id',
        valor: () => id.countId,
        parche: { counted_qty: 77 },
      },
      {
        tabla: 'supply_price_changes',
        col: 'id',
        valor: () => id.cambioPrecio,
        parche: { new_cost_price: 0 },
      },
    ]

    for (const caso of CASOS) {
      it(`${caso.tabla}: update y delete con la clave de servicio -> rechazados (MOVEMENT_IMMUTABLE) y la fila no cambia`, async () => {
        const bd = servicio()
        const antes = await tabla(bd, caso.tabla)
          .select('*')
          .eq(caso.col, caso.valor())
        const upd = await tabla(bd, caso.tabla)
          .update(caso.parche)
          .eq(caso.col, caso.valor())
          .select()
        expect(upd.error, `update: ${describir(upd)}`).not.toBeNull()
        expect(
          upd.error?.hint === 'MOVEMENT_IMMUTABLE' ||
            upd.error?.code === '42501',
          describir(upd),
        ).toBe(true)
        const del = await tabla(bd, caso.tabla)
          .delete()
          .eq(caso.col, caso.valor())
          .select()
        expect(del.error, `delete: ${describir(del)}`).not.toBeNull()
        expect(
          del.error?.hint === 'MOVEMENT_IMMUTABLE' ||
            del.error?.code === '42501',
          describir(del),
        ).toBe(true)
        const despues = await tabla(bd, caso.tabla)
          .select('*')
          .eq(caso.col, caso.valor())
        expect(filas(despues)).toEqual(filas(antes))
      })
    }

    it('el stock no admite un valor negativo ni siquiera con la clave de servicio (check stock_qty >= 0)', async () => {
      const antes = await stockDe(id.sB)
      const res = await servicio()
        .from('supplies')
        .update({ stock_qty: -1 })
        .eq('id', id.sB)
      expect(res.error, 'aceptó un stock negativo').not.toBeNull()
      expect(await stockDe(id.sB)).toBe(antes)
    })

    it('el código es único sin distinguir mayúsculas ni espacios (IS-26)', async () => {
      const dueno = clienteDe('owner')
      const res = await rpc(dueno, 'upsert_supply', {
        p_code: `  ${id.codeA.toUpperCase()} `,
        p_name: `${ins.prefijo}duplicado`,
        p_category_id: id.categoria,
      })
      expect(codigo(res), describir(res)).toBe('CODE_ALREADY_EXISTS')
    })

    it('anular dos veces un retiro, o anular un ajuste, un control o una anulación, se rechaza (IS-27)', async () => {
      const dueno = clienteDe('owner')
      const r = await rpc(dueno, 'register_withdrawal', {
        p_lines: [{ supply_id: id.sA, qty: 1 }],
        p_site_id: id.sedeQ1,
        p_person_id: c().ids.empleado1,
        p_note: ins.texto('para-anular'),
      })
      expect(r.error?.message).toBeUndefined()
      const movimiento = aJson(aJson(r.data).movement).id as string
      const stockAntes = await stockDe(id.sA)
      const primera = await rpc(dueno, 'void_stock_movement', {
        p_movement_id: movimiento,
        p_reason: ins.texto('error de carga'),
      })
      expect(primera.error?.message).toBeUndefined()
      expect(await stockDe(id.sA)).toBe(stockAntes + 1)
      const reversal = aJson(aJson(aJson(primera.data).reversal).movement)
      const segunda = await rpc(dueno, 'void_stock_movement', {
        p_movement_id: movimiento,
        p_reason: 'otra vez',
      })
      expect(codigo(segunda)).toBe('MOVEMENT_ALREADY_VOIDED')
      for (const [que, movimientoId] of [
        ['un ajuste', id.mAjuste],
        ['un control', id.mControl],
        ['una anulación', reversal.id as string],
      ] as const) {
        const res = await rpc(dueno, 'void_stock_movement', {
          p_movement_id: movimientoId,
          p_reason: 'no se puede',
        })
        expect(codigo(res), `anular ${que}`).toBe('MOVEMENT_NOT_VOIDABLE')
      }
      expect(await stockDe(id.sA)).toBe(stockAntes + 1)
    })
  })

  // -------------------------------------------------------------------------------------------
  // 3. Vistas
  // -------------------------------------------------------------------------------------------

  interface VistaStock {
    vista: string
    clave: string
    filas: () => Record<string, string>
    ve: Record<Perfil, Ve>
    /** Se lee con la sesión del dueño en la contraprueba (la lectura de «lo mío» filtra por uid). */
    contraprueba?: 'dueno' | 'omitir'
  }

  const TODOS_LOS_AUTENTICADOS: Record<Perfil, Ve> = {
    anon: 'denegado',
    empleado: 'todo',
    supervisor: 'todo',
    dual: 'todo',
    adminSin: 'todo',
    admin: 'todo',
    owner: 'todo',
  }

  const VISTAS_STOCK: VistaStock[] = [
    {
      vista: 'v_supply_catalog',
      clave: 'id',
      // Solo los activos: C (desactivado) no está en el catálogo de nadie.
      filas: () => ({ a: id.sA, b: id.sB }),
      ve: TODOS_LOS_AUTENTICADOS,
      contraprueba: 'dueno',
    },
    {
      vista: 'v_stock_admin',
      clave: 'id',
      filas: () => ({ a: id.sA, b: id.sB, c: id.sC }),
      ve: VE_SOLO_ADMIN,
      contraprueba: 'dueno',
    },
    {
      vista: 'v_stock_movements_admin',
      clave: 'movement_id',
      filas: () => ({
        ingreso: id.mIngreso,
        r1: id.mR1,
        r2: id.mR2,
        r3: id.mR3,
        ajuste: id.mAjuste,
        control: id.mControl,
      }),
      ve: VE_SOLO_ADMIN,
      contraprueba: 'dueno',
    },
    {
      vista: 'v_stock_counts_admin',
      clave: 'count_id',
      filas: () => ({ control: id.countId }),
      ve: VE_SOLO_ADMIN,
      contraprueba: 'dueno',
    },
    {
      vista: 'v_supply_consumption_by_client',
      clave: 'site_id',
      // Los tres retiros caen en sedes distintas: P1 (empleado1), P2 (en nombre de) y Q1.
      filas: () => ({ p1: id.sedeP1, p2: id.sedeP2, q1: id.sedeQ1 }),
      ve: VE_SOLO_ADMIN,
      contraprueba: 'dueno',
    },
    {
      vista: 'v_my_withdrawals',
      clave: 'movement_id',
      filas: () => ({ r1: id.mR1, r2: id.mR2, r3: id.mR3 }),
      // Cada persona ve solo lo suyo: empleado1 el suyo, empleado2 (que no es un perfil de la
      // matriz) el cargado a su nombre, y el coordinador el suyo.
      ve: {
        anon: 'denegado',
        empleado: ['r1'],
        supervisor: ['r3'],
        dual: 'nada',
        adminSin: 'nada',
        admin: 'nada',
        owner: 'nada',
      },
      contraprueba: 'omitir',
    },
    {
      vista: 'v_my_shortage_reports',
      clave: 'id',
      filas: () => ({ e1: id.avisoE1, s1: id.avisoS1 }),
      ve: {
        anon: 'denegado',
        empleado: ['e1'],
        supervisor: ['s1'],
        dual: 'nada',
        adminSin: 'nada',
        admin: 'nada',
        owner: 'nada',
      },
      contraprueba: 'omitir',
    },
    {
      vista: 'v_withdrawal_shift_options',
      clave: 'shift_id',
      filas: () => ({
        e1: id.turnoE1,
        e2: id.turnoE2,
        pasado: id.turnoPasado,
        lejano: id.turnoLejano,
        cancelado: id.turnoCancelado,
      }),
      // Empleado: solo los suyos (hoy a +7). Coordinador y doble rol (que es coordinador): todos
      // de hoy a +7. Administración sin rol operativo: de -30 a +7. Nunca el cancelado ni el de +20.
      ve: {
        anon: 'denegado',
        empleado: ['e1'],
        supervisor: ['e1', 'e2'],
        dual: ['e1', 'e2'],
        adminSin: ['e1', 'e2', 'pasado'],
        admin: ['e1', 'e2', 'pasado'],
        owner: ['e1', 'e2', 'pasado'],
      },
      contraprueba: 'omitir',
    },
    {
      vista: 'v_withdrawal_site_options',
      clave: 'site_id',
      filas: () => ({ p1: id.sedeP1, p2: id.sedeP2, q1: id.sedeQ1 }),
      // Empleado: las sedes de sus asignaciones. Coordinador y administración: todas las activas.
      ve: {
        anon: 'denegado',
        empleado: ['p1'],
        supervisor: ['p1', 'p2', 'q1'],
        dual: ['p1', 'p2', 'q1'],
        adminSin: ['p1', 'p2', 'q1'],
        admin: ['p1', 'p2', 'q1'],
        owner: ['p1', 'p2', 'q1'],
      },
      contraprueba: 'omitir',
    },
    {
      vista: 'v_withdrawal_shift_options_admin',
      clave: 'shift_id',
      filas: () => ({
        e1: id.turnoE1,
        e2: id.turnoE2,
        pasado: id.turnoPasado,
        lejano: id.turnoLejano,
        cancelado: id.turnoCancelado,
      }),
      // IS-35: solo con `manage_stock`; de -30 a +7, sin cancelados; sin mirar el rol operativo.
      ve: {
        anon: 'denegado',
        empleado: 'nada',
        supervisor: 'nada',
        dual: 'nada',
        adminSin: 'nada',
        admin: ['e1', 'e2', 'pasado'],
        owner: ['e1', 'e2', 'pasado'],
      },
      contraprueba: 'omitir',
    },
    {
      vista: 'v_withdrawal_site_options_admin',
      clave: 'site_id',
      filas: () => ({ p1: id.sedeP1, p2: id.sedeP2, q1: id.sedeQ1 }),
      ve: {
        anon: 'denegado',
        empleado: 'nada',
        supervisor: 'nada',
        dual: 'nada',
        adminSin: 'nada',
        admin: ['p1', 'p2', 'q1'],
        owner: ['p1', 'p2', 'q1'],
      },
      contraprueba: 'omitir',
    },
  ]

  describe('vistas: qué ve cada perfil (IS-20, IS-21, IS-28, IS-35)', () => {
    for (const spec of VISTAS_STOCK) {
      describe(spec.vista, () => {
        for (const perfil of PERFILES) {
          const ve = spec.ve[perfil]
          it(`[${ETIQUETA[perfil]}] ${spec.vista}.select -> ${
            typeof ve === 'string' ? ve : `ve ${ve.join(', ')}`
          } (RB-X02, IS-20)`, async () => {
            const plantadas = spec.filas()
            const valores = [...new Set(Object.values(plantadas))]
            const res = await tabla(clienteDe(perfil), spec.vista)
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

    it('contraprueba: las vistas de administración tienen las filas plantadas (leídas con el dueño)', async () => {
      for (const spec of VISTAS_STOCK) {
        if (spec.contraprueba !== 'dueno') continue
        const valores = [...new Set(Object.values(spec.filas()))]
        const res = await tabla(clienteDe('owner'), spec.vista)
          .select('*')
          .in(spec.clave, valores)
        expect(res.error, `${spec.vista}: ${describir(res)}`).toBeNull()
        expect(claves(res, spec.clave), spec.vista).toEqual(new Set(valores))
      }
    })

    it('el retiro de empleado2 (cargado a su nombre) no lo ve el empleado1 ni nadie más de la matriz (IS-20)', async () => {
      for (const perfil of PERFILES.filter((p) => p !== 'anon')) {
        const res = await tabla(clienteDe(perfil), 'v_my_withdrawals')
          .select('movement_id')
          .eq('movement_id', id.mR2)
        expect(filas(res), ETIQUETA[perfil]).toEqual([])
      }
    })
  })

  describe('vistas: ninguna se escribe (RB-X02)', () => {
    for (const spec of VISTAS_STOCK) {
      for (const perfil of PERFILES) {
        it(`[${ETIQUETA[perfil]}] ${spec.vista}: insert, update y delete -> rechazados`, async () => {
          const bd = clienteDe(perfil)
          const ins1 = await tabla(bd, spec.vista).insert({}).select()
          expect(ins1.error, 'una vista no acepta inserts').not.toBeNull()
          const upd = await tabla(bd, spec.vista)
            .update({ code: 'x' })
            .eq(spec.clave, INEXISTENTE)
            .select()
          expect(filas(upd)).toEqual([])
          const del = await tabla(bd, spec.vista)
            .delete()
            .eq(spec.clave, INEXISTENTE)
            .select()
          expect(filas(del)).toEqual([])
        })
      }
    }
  })

  describe('el celular no ve precios, cantidades ni mínimos (IS-20)', () => {
    const COLUMNAS_CATALOGO = [
      'category_id',
      'category_name',
      'category_sort_order',
      'code',
      'id',
      'image_path',
      'name',
      'out_of_stock',
      'presentation',
    ]

    for (const perfil of [...CAMPO, 'adminSin'] as const) {
      it(`[${ETIQUETA[perfil]}] v_supply_catalog devuelve solo las columnas permitidas y la marca out_of_stock`, async () => {
        const res = await tabla(clienteDe(perfil), 'v_supply_catalog')
          .select('*')
          .in('id', [id.sA, id.sB])
        expect(res.error, describir(res)).toBeNull()
        const lista = filas(res)
        expect(lista).toHaveLength(2)
        for (const fila of lista) {
          expect(Object.keys(fila).sort()).toEqual(COLUMNAS_CATALOGO)
        }
        expect(lista.find((f) => f.id === id.sA)?.out_of_stock).toBe(false)
        expect(lista.find((f) => f.id === id.sB)?.out_of_stock).toBe(true)
      })
    }

    for (const perfil of CAMPO) {
      it(`[${ETIQUETA[perfil]}] no puede pedir por la API las columnas de precios ni de stock del catálogo`, async () => {
        for (const columna of [
          'stock_qty',
          'cost_price',
          'sale_price',
          'min_qty',
        ]) {
          const res = await tabla(clienteDe(perfil), 'v_supply_catalog').select(
            columna,
          )
          expect(res.error, `${columna} se pudo pedir`).not.toBeNull()
        }
        const directa = await tabla(clienteDe(perfil), 'supplies').select(
          'stock_qty, cost_price, sale_price, min_qty',
        )
        expect(filas(directa), 'supplies.stock_qty legible').toEqual([])
      })
    }

    it('v_my_withdrawals y v_my_shortage_reports del empleado no traen precios ni stock', async () => {
      const retiros = await tabla(clienteDe('empleado'), 'v_my_withdrawals')
        .select('*')
        .eq('movement_id', id.mR1)
      expect(retiros.error, describir(retiros)).toBeNull()
      expect(filas(retiros)).toHaveLength(1)
      const prohibidasRetiros = [...clavesDelArbol(filas(retiros))].filter(
        (k) => PROHIBIDAS_EN_CELULAR.test(k) && k !== 'total_qty',
      )
      expect(
        prohibidasRetiros,
        'claves de precio o stock en mis retiros',
      ).toEqual([])
      const avisos = await tabla(clienteDe('empleado'), 'v_my_shortage_reports')
        .select('*')
        .eq('id', id.avisoE1)
      expect(avisos.error, describir(avisos)).toBeNull()
      expect(filas(avisos)).toHaveLength(1)
      expect(
        [...clavesDelArbol(filas(avisos))].filter((k) =>
          PROHIBIDAS_EN_CELULAR.test(k),
        ),
      ).toEqual([])
    })

    it('register_withdrawal de un empleado devuelve las líneas sin precios ni stock resultante', async () => {
      const antes = await stockDe(id.sD)
      const res = await rpc(clienteDe('empleado'), 'register_withdrawal', {
        p_lines: [{ supply_id: id.sD, qty: 1 }],
        p_shift_id: id.turnoE1,
      })
      expect(res.error?.message).toBeUndefined()
      const prohibidas = [...clavesDelArbol(res.data)].filter(
        (k) =>
          PROHIBIDAS_EN_CELULAR.test(k) && k !== 'qty' && k !== 'qty_delta',
      )
      expect(prohibidas, 'claves de precio o stock en el retiro').toEqual([])
      expect(await stockDe(id.sD)).toBe(antes - 1)
      // Se devuelve para no alterar el escenario de las simultáneas.
      await ins.ingresar(id.sD, 1)
    })

    it('el mensaje por stock insuficiente de un empleado no dice cuánto hay; el de la administración sí (IS-20, IS-28)', async () => {
      const empleado = await rpc(clienteDe('empleado'), 'register_withdrawal', {
        p_lines: [{ supply_id: id.sB, qty: 5 }],
        p_shift_id: id.turnoE1,
      })
      expect(codigo(empleado)).toBe('INSUFFICIENT_STOCK')
      expect(empleado.error?.message).toMatch(
        /^No alcanza el stock de .+\. Consultá en la oficina\.$/,
      )
      expect(empleado.error?.message).not.toMatch(/hay|quedan|disponible/i)
      const admin = await rpc(clienteDe('admin'), 'register_withdrawal', {
        p_lines: [{ supply_id: id.sB, qty: 5 }],
        p_person_id: c().ids.empleado1,
        p_site_id: id.sedeP1,
        p_note: ins.texto('sin-stock'),
      })
      expect(codigo(admin)).toBe('INSUFFICIENT_STOCK')
      expect(admin.error?.message).toMatch(/\b0\b/)
    })
  })

  // -------------------------------------------------------------------------------------------
  // 4. RPC: la puerta de cada una por perfil
  // -------------------------------------------------------------------------------------------

  interface CasoRpc {
    rpc: string
    /** Argumentos que pasan la puerta y fallan después por una regla de negocio (sin tocar nada). */
    args: () => object
    esperado: Record<Perfil, string>
    rb: string
  }

  const CATALOGO: Partial<Record<Perfil, string>> = { anon: '42501' }
  const puerta = (despues: string): Record<Perfil, string> =>
    porPerfil({ ...CATALOGO, admin: despues, owner: despues })

  const CASOS_RPC: CasoRpc[] = [
    {
      rpc: 'upsert_supply',
      args: () => ({ p_code: '   ', p_name: 'x', p_category_id: id.categoria }),
      esperado: puerta('CODE_REQUIRED'),
      rb: 'IS-01, IS-21',
    },
    {
      rpc: 'set_supply_active',
      args: () => ({ p_supply_id: INEXISTENTE, p_active: true }),
      esperado: puerta('SUPPLY_NOT_FOUND'),
      rb: 'IS-26, IS-21',
    },
    {
      rpc: 'set_supply_prices',
      args: () => ({
        p_supply_id: INEXISTENTE,
        p_cost_price: 1,
        p_sale_price: 1,
      }),
      esperado: puerta('SUPPLY_NOT_FOUND'),
      rb: 'IS-06, IS-21',
    },
    {
      rpc: 'upsert_supply_category',
      args: () => ({ p_name: '   ' }),
      esperado: puerta('NAME_REQUIRED'),
      rb: 'IS-03, IS-21',
    },
    {
      rpc: 'register_stock_entry',
      args: () => ({ p_lines: [] }),
      esperado: puerta('INVALID_LINES'),
      rb: 'IS-09, IS-21',
    },
    {
      rpc: 'adjust_stock',
      args: () => ({ p_supply_id: INEXISTENTE, p_delta: 1, p_reason: 'count' }),
      esperado: puerta('SUPPLY_NOT_FOUND'),
      rb: 'IS-10, IS-21',
    },
    {
      rpc: 'void_stock_movement',
      args: () => ({ p_movement_id: INEXISTENTE, p_reason: 'e2e' }),
      esperado: puerta('MOVEMENT_NOT_FOUND'),
      rb: 'IS-13, IS-27',
    },
    {
      rpc: 'register_stock_count',
      args: () => ({
        p_counted_at: new Date(Date.now() - 60_000).toISOString(),
        p_lines: [],
        p_reviewer_name: ins.texto('revisor'),
      }),
      esperado: puerta('INVALID_LINES'),
      rb: 'IS-16, IS-17, IS-21',
    },
    {
      // Para sí mismo, sin turno ni sede: el empleado, el coordinador y el doble rol pasan la
      // puerta; la administración sin rol operativo debe indicar quién retira.
      rpc: 'register_withdrawal (para sí)',
      args: () => ({ p_lines: [] }),
      esperado: porPerfil({
        ...CATALOGO,
        empleado: 'SHIFT_OR_SITE_REQUIRED',
        supervisor: 'SHIFT_OR_SITE_REQUIRED',
        dual: 'SHIFT_OR_SITE_REQUIRED',
        adminSin: 'PERSON_REQUIRED',
        admin: 'PERSON_REQUIRED',
        owner: 'PERSON_REQUIRED',
      }),
      rb: 'IS-11, IS-35',
    },
    {
      // En nombre de otra persona: solo con `manage_stock`.
      rpc: 'register_withdrawal (en nombre de otro)',
      args: () => ({ p_lines: [], p_person_id: c().ids.empleado2 }),
      esperado: puerta('SHIFT_OR_SITE_REQUIRED'),
      rb: 'IS-11, IS-21, IS-35',
    },
    {
      rpc: 'report_supply_shortage',
      args: () => ({}),
      esperado: porPerfil({
        ...CATALOGO,
        empleado: 'SHORTAGE_TARGET_REQUIRED',
        supervisor: 'SHORTAGE_TARGET_REQUIRED',
        dual: 'SHORTAGE_TARGET_REQUIRED',
      }),
      rb: 'IS-14, IS-29',
    },
    {
      // Resolver no exige `manage_stock`: lo hace cualquier administrador (IS-21).
      rpc: 'resolve_supply_shortage',
      args: () => ({ p_report_id: INEXISTENTE, p_note: 'e2e' }),
      esperado: porPerfil({
        ...CATALOGO,
        adminSin: 'SHORTAGE_NOT_FOUND',
        admin: 'SHORTAGE_NOT_FOUND',
        owner: 'SHORTAGE_NOT_FOUND',
      }),
      rb: 'IS-14, IS-21, IS-29',
    },
    {
      rpc: 'get_stock_summary',
      args: () => ({}),
      esperado: porPerfil({
        ...CATALOGO,
        adminSin: 'ok',
        admin: 'ok',
        owner: 'ok',
      }),
      rb: 'IS-21, IS-30',
    },
  ]

  describe('RPC: la puerta de cada una por perfil (06 §15, IS-19, IS-21)', () => {
    for (const caso of CASOS_RPC) {
      describe(caso.rpc, () => {
        for (const perfil of PERFILES) {
          const esperado = caso.esperado[perfil]
          it(`[${ETIQUETA[perfil]}] ${caso.rpc} -> ${esperado} (RB-X02, ${caso.rb})`, async () => {
            const nombre = caso.rpc.split(' ')[0]
            const res = await rpc(clienteDe(perfil), nombre, caso.args())
            expect(codigo(res), describir(res)).toBe(esperado)
            if (esperado === '42501' || esperado === 'FORBIDDEN') {
              expect(res.data ?? null).toBeNull()
            }
          })
        }
      })
    }
  })

  describe('RPC: contraprueba positiva, quien puede lo hace de verdad (IS-01, IS-03, IS-09, IS-10)', () => {
    for (const perfil of ADMIN_STOCK) {
      it(`[${ETIQUETA[perfil]}] crea categoría y artículo, ingresa, ajusta, cambia precios y desactiva`, async () => {
        const bd = clienteDe(perfil)
        const nombre = `${ins.prefijo}pos-${perfil}-${Date.now().toString(36)}`
        const cat = await rpc(bd, 'upsert_supply_category', { p_name: nombre })
        expect(cat.error?.message).toBeUndefined()
        const categoriaId = aJson(cat.data).id as string
        const art = await rpc(bd, 'upsert_supply', {
          p_code: nombre,
          p_name: nombre,
          p_category_id: categoriaId,
          p_cost_price: 10,
          p_sale_price: 15,
          p_min_qty: 2,
        })
        expect(art.error?.message).toBeUndefined()
        const articuloId = aJson(art.data).id as string
        const entrada = await rpc(bd, 'register_stock_entry', {
          p_lines: [{ supply_id: articuloId, qty: 4 }],
          p_supplier: ins.texto('proveedor'),
          p_document_number: 'R-0001',
          p_note: ins.texto('ingreso'),
        })
        expect(entrada.error?.message).toBeUndefined()
        const ajuste = await rpc(bd, 'adjust_stock', {
          p_supply_id: articuloId,
          p_delta: -4,
          p_reason: 'breakage',
        })
        expect(ajuste.error?.message).toBeUndefined()
        const precios = await rpc(bd, 'set_supply_prices', {
          p_supply_id: articuloId,
          p_cost_price: 11,
          p_sale_price: 16,
        })
        expect(precios.error?.message).toBeUndefined()
        const baja = await rpc(bd, 'set_supply_active', {
          p_supply_id: articuloId,
          p_active: false,
        })
        expect(baja.error?.message).toBeUndefined()
        expect(await stockDe(articuloId)).toBe(0)
      })
    }

    it('[admin sin capacidades] no puede crear nada: ni categoría ni artículo ni movimiento', async () => {
      const bd = clienteDe('adminSin')
      const nombre = `${ins.prefijo}neg-${Date.now().toString(36)}`
      const cat = await rpc(bd, 'upsert_supply_category', { p_name: nombre })
      expect(codigo(cat)).toBe('FORBIDDEN')
      const art = await rpc(bd, 'upsert_supply', {
        p_code: nombre,
        p_name: nombre,
        p_category_id: id.categoria,
      })
      expect(codigo(art)).toBe('FORBIDDEN')
      const antes = await stockDe(id.sA)
      const ajuste = await rpc(bd, 'adjust_stock', {
        p_supply_id: id.sA,
        p_delta: 5,
        p_reason: 'count',
      })
      expect(codigo(ajuste)).toBe('FORBIDDEN')
      expect(await stockDe(id.sA)).toBe(antes)
      const creados = await servicio()
        .from('supplies')
        .select('id')
        .eq('code', nombre)
      expect(creados.data).toEqual([])
    })

    it('[admin sin capacidades] sí resuelve un aviso de faltante (IS-21)', async () => {
      const aviso = await rpc(clienteDe('empleado'), 'report_supply_shortage', {
        p_description: ins.texto('para-resolver-adminsin'),
      })
      expect(aviso.error?.message).toBeUndefined()
      const res = await rpc(clienteDe('adminSin'), 'resolve_supply_shortage', {
        p_report_id: aJson(aviso.data).id as string,
        p_note: 'Se compró',
      })
      expect(res.error?.message).toBeUndefined()
      expect(aJson(res.data).status).toBe('resolved')
      const otra = await rpc(clienteDe('admin'), 'resolve_supply_shortage', {
        p_report_id: aJson(aviso.data).id as string,
        p_note: 'otra vez',
      })
      expect(codigo(otra)).toBe('SHORTAGE_ALREADY_RESOLVED')
    })

    it('el empleado, el coordinador y el doble rol no resuelven avisos ni ven el resumen (IS-21)', async () => {
      for (const perfil of CAMPO) {
        const res = await rpc(clienteDe(perfil), 'resolve_supply_shortage', {
          p_report_id: id.avisoE1,
          p_note: 'x',
        })
        expect(codigo(res), ETIQUETA[perfil]).toBe('FORBIDDEN')
      }
      const abierto = await servicio()
        .from('supply_shortage_reports')
        .select('status')
        .eq('id', id.avisoE1)
        .single()
      expect(abierto.data?.status).toBe('open')
    })

    it('el resumen devuelve los cuatro contadores a la administración', async () => {
      const res = await rpc(clienteDe('adminSin'), 'get_stock_summary')
      expect(res.error?.message).toBeUndefined()
      expect(Object.keys(aJson(res.data)).sort()).toEqual([
        'below_min',
        'open_reports',
        'open_shortages',
        'out_of_stock',
      ])
    })
  })

  // -------------------------------------------------------------------------------------------
  // 4b. Contrato de errores (database.md: «errores P0001 con hint = código y mensaje en español»)
  // -------------------------------------------------------------------------------------------

  describe('contrato de errores: un valor fuera de rango da un error de negocio, no el del motor (06 §15)', () => {
    const casosContrato: Array<[string, string, () => object]> = [
      [
        'register_stock_entry · costo unitario fuera de rango',
        'register_stock_entry',
        () => ({
          p_lines: [{ supply_id: id.sA, qty: 1, unit_cost: 1e15 }],
        }),
      ],
      [
        'upsert_supply · precio fuera de rango',
        'upsert_supply',
        () => ({
          p_code: `${ins.prefijo}rango-1`,
          p_name: `${ins.prefijo}rango-1`,
          p_category_id: id.categoria,
          p_cost_price: 1e12,
        }),
      ],
      [
        'upsert_supply · mínimo fuera de rango',
        'upsert_supply',
        () => ({
          p_code: `${ins.prefijo}rango-2`,
          p_name: `${ins.prefijo}rango-2`,
          p_category_id: id.categoria,
          p_min_qty: 3_000_000_000,
        }),
      ],
      [
        'adjust_stock · cantidad fuera de rango',
        'adjust_stock',
        () => ({
          p_supply_id: id.sA,
          p_delta: 3_000_000_000,
          p_reason: 'count',
        }),
      ],
      [
        'adjust_stock · motivo inexistente',
        'adjust_stock',
        () => ({
          p_supply_id: id.sA,
          p_delta: 1,
          p_reason: 'motivo-que-no-existe',
        }),
      ],
      [
        'report_supply_shortage · descripción sin tope de largo',
        'report_supply_shortage',
        () => ({ p_description: ins.texto('d'.repeat(100_000)) }),
      ],
      [
        'report_supply_shortage · comentario sin tope de largo',
        'report_supply_shortage',
        () => ({
          p_description: ins.texto('corta'),
          p_comment: ins.texto('c'.repeat(100_000)),
        }),
      ],
      [
        'register_stock_count · fecha inválida',
        'register_stock_count',
        () => ({
          p_counted_at: 'ayer',
          p_lines: [{ supply_id: id.sA, counted_qty: 1 }],
          p_reviewer_name: ins.texto('revisor'),
        }),
      ],
    ]
    for (const [nombre, rpcNombre, args] of casosContrato) {
      caso(
        claveCaso('insumos', 'contrato', nombre),
        `${nombre}: P0001 con hint y mensaje en español, sin tocar el stock (RB-X02, 06 §15)`,
        async () => {
          const antes = await stockDe(id.sA)
          const res = await rpc(
            clienteDe(
              rpcNombre === 'report_supply_shortage' ? 'empleado' : 'owner',
            ),
            rpcNombre,
            args(),
          )
          expect(res.error, 'aceptó el valor').not.toBeNull()
          expect(
            res.error?.code,
            `error crudo del motor: ${describir(res)}`,
          ).toBe('P0001')
          expect(res.error?.hint ?? '', 'sin código de error').not.toBe('')
          expect(await stockDe(id.sA)).toBe(antes)
        },
      )
    }
  })

  describe('RPC: reglas de negocio con errores en español y código (06 §15)', () => {
    const dueno = () => clienteDe('owner')

    it('ingreso: cantidades no enteras o negativas, precios inválidos, duplicados y artículo desactivado', async () => {
      const casos: Array<[string, object, string]> = [
        [
          'cantidad cero',
          { p_lines: [{ supply_id: id.sA, qty: 0 }] },
          'INVALID_QTY',
        ],
        [
          'cantidad negativa',
          { p_lines: [{ supply_id: id.sA, qty: -3 }] },
          'INVALID_QTY',
        ],
        [
          'cantidad con decimales',
          { p_lines: [{ supply_id: id.sA, qty: 1.5 }] },
          'INVALID_QTY',
        ],
        [
          'costo negativo',
          { p_lines: [{ supply_id: id.sA, qty: 1, unit_cost: -1 }] },
          'INVALID_PRICE',
        ],
        [
          'artículo repetido',
          {
            p_lines: [
              { supply_id: id.sA, qty: 1 },
              { supply_id: id.sA, qty: 2 },
            ],
          },
          'DUPLICATE_SUPPLY',
        ],
        [
          'artículo inexistente',
          { p_lines: [{ supply_id: INEXISTENTE, qty: 1 }] },
          'SUPPLY_NOT_FOUND',
        ],
        [
          'artículo desactivado',
          { p_lines: [{ supply_id: id.sC, qty: 1 }] },
          'SUPPLY_INACTIVE',
        ],
        [
          'tipo inválido',
          { p_lines: [{ supply_id: id.sA, qty: 1 }], p_kind: 'withdrawal' },
          'INVALID_KIND',
        ],
      ]
      const antes = await stockDe(id.sA)
      for (const [que, args, esperado] of casos) {
        const res = await rpc(dueno(), 'register_stock_entry', args)
        expect(codigo(res), `${que}: ${describir(res)}`).toBe(esperado)
        expect(res.error?.message ?? '', que).not.toBe('')
      }
      expect(await stockDe(id.sA), 'el stock cambió').toBe(antes)
    })

    it('ajuste: motivo obligatorio, con «otro» la observación es obligatoria y no pasa de cero', async () => {
      const antes = await stockDe(id.sA)
      const sinMotivo = await rpc(dueno(), 'adjust_stock', {
        p_supply_id: id.sA,
        p_delta: 1,
      })
      expect(sinMotivo.error, 'ajuste sin motivo').not.toBeNull()
      const otro = await rpc(dueno(), 'adjust_stock', {
        p_supply_id: id.sA,
        p_delta: 1,
        p_reason: 'other',
      })
      expect(codigo(otro)).toBe('NOTE_REQUIRED')
      const cero = await rpc(dueno(), 'adjust_stock', {
        p_supply_id: id.sA,
        p_delta: 0,
        p_reason: 'count',
      })
      expect(codigo(cero)).toBe('INVALID_QTY')
      const deMas = await rpc(dueno(), 'adjust_stock', {
        p_supply_id: id.sA,
        p_delta: -(antes + 1),
        p_reason: 'count',
      })
      expect(codigo(deMas)).toBe('INSUFFICIENT_STOCK')
      const inactivo = await rpc(dueno(), 'adjust_stock', {
        p_supply_id: id.sC,
        p_delta: 1,
        p_reason: 'count',
      })
      expect(codigo(inactivo)).toBe('SUPPLY_INACTIVE')
      expect(await stockDe(id.sA)).toBe(antes)
    })

    it('desactivar pide stock en cero (IS-26) y los precios no pueden ser negativos (IS-34)', async () => {
      const baja = await rpc(dueno(), 'set_supply_active', {
        p_supply_id: id.sA,
        p_active: false,
      })
      expect(codigo(baja)).toBe('STOCK_NOT_ZERO')
      const negativo = await rpc(dueno(), 'set_supply_prices', {
        p_supply_id: id.sA,
        p_cost_price: -1,
        p_sale_price: 1,
      })
      expect(codigo(negativo)).toBe('INVALID_PRICE')
      const decimales = await rpc(dueno(), 'set_supply_prices', {
        p_supply_id: id.sA,
        p_cost_price: 1.234,
        p_sale_price: 1,
      })
      expect(codigo(decimales)).toBe('INVALID_PRICE')
    })

    it('control: no puede ser del futuro, pide revisor y no admite repetidos', async () => {
      const futuro = await rpc(dueno(), 'register_stock_count', {
        p_counted_at: new Date(Date.now() + 3_600_000).toISOString(),
        p_lines: [{ supply_id: id.sA, counted_qty: 1 }],
        p_reviewer_name: ins.texto('revisor'),
      })
      expect(codigo(futuro)).toBe('COUNT_IN_FUTURE')
      const sinRevisor = await rpc(dueno(), 'register_stock_count', {
        p_counted_at: new Date(Date.now() - 60_000).toISOString(),
        p_lines: [{ supply_id: id.sA, counted_qty: 1 }],
      })
      expect(codigo(sinRevisor)).toBe('REVIEWER_REQUIRED')
      const repetido = await rpc(dueno(), 'register_stock_count', {
        p_counted_at: new Date(Date.now() - 60_000).toISOString(),
        p_lines: [
          { supply_id: id.sA, counted_qty: 1 },
          { supply_id: id.sA, counted_qty: 2 },
        ],
        p_reviewer_name: ins.texto('revisor'),
      })
      expect(codigo(repetido)).toBe('DUPLICATE_SUPPLY')
    })

    it('retiro: turno cancelado, turno lejano, sede inexistente y sede que no es la del turno', async () => {
      const lineas = [{ supply_id: id.sD, qty: 1 }]
      const casos: Array<[string, object, string]> = [
        [
          'turno cancelado',
          { p_lines: lineas, p_shift_id: id.turnoCancelado },
          'SHIFT_NOT_AVAILABLE',
        ],
        [
          'turno inexistente',
          { p_lines: lineas, p_shift_id: INEXISTENTE },
          'SHIFT_NOT_FOUND',
        ],
        [
          'turno de otra sede',
          { p_lines: lineas, p_shift_id: id.turnoE1, p_site_id: id.sedeP2 },
          'SITE_SHIFT_MISMATCH',
        ],
        [
          'sede inexistente',
          { p_lines: lineas, p_site_id: INEXISTENTE, p_note: 'x' },
          'SITE_NOT_FOUND',
        ],
        [
          'sede sin observación',
          { p_lines: lineas, p_site_id: id.sedeQ1 },
          'NOTE_REQUIRED',
        ],
        [
          'persona inexistente',
          {
            p_lines: lineas,
            p_site_id: id.sedeQ1,
            p_note: 'x',
            p_person_id: INEXISTENTE,
          },
          'PERSON_NOT_FOUND',
        ],
        [
          'artículo desactivado',
          {
            p_lines: [{ supply_id: id.sC, qty: 1 }],
            p_site_id: id.sedeQ1,
            p_note: 'x',
            p_person_id: c().ids.empleado1,
          },
          'SUPPLY_INACTIVE',
        ],
      ]
      const antes = await stockDe(id.sD)
      for (const [que, args, esperado] of casos) {
        const res = await rpc(dueno(), 'register_withdrawal', {
          ...args,
          ...('p_person_id' in args ? {} : { p_person_id: c().ids.empleado1 }),
        })
        expect(codigo(res), `${que}: ${describir(res)}`).toBe(esperado)
      }
      expect(await stockDe(id.sD), 'el stock cambió').toBe(antes)
    })

    it('aviso de faltante: o un artículo o un texto, no los dos ni ninguno; artículo desactivado', async () => {
      const bd = clienteDe('empleado')
      const dos = await rpc(bd, 'report_supply_shortage', {
        p_supply_id: id.sA,
        p_description: 'x',
      })
      expect(codigo(dos)).toBe('SHORTAGE_TARGET_REQUIRED')
      const inactivo = await rpc(bd, 'report_supply_shortage', {
        p_supply_id: id.sC,
      })
      expect(codigo(inactivo)).toBe('SUPPLY_NOT_FOUND')
      const ajeno = await rpc(bd, 'report_supply_shortage', {
        p_supply_id: id.sA,
        p_shift_id: id.turnoE2,
      })
      expect(codigo(ajeno), 'turno de otra persona').toBe('SHIFT_NOT_ALLOWED')
    })

    it('resolver pide una nota (IS-29)', async () => {
      const res = await rpc(dueno(), 'resolve_supply_shortage', {
        p_report_id: id.avisoS1,
        p_note: '   ',
      })
      expect(codigo(res)).toBe('NOTE_REQUIRED')
    })
  })

  // -------------------------------------------------------------------------------------------
  // 5. Stock nunca negativo (IS-13), también con retiros simultáneos
  // -------------------------------------------------------------------------------------------

  describe('el stock nunca queda negativo (IS-13)', () => {
    it('retirar más de lo que hay se rechaza y no mueve nada, para el empleado y para la administración', async () => {
      const antes = await stockDe(id.sB)
      expect(antes).toBe(0)
      const empleado = await rpc(clienteDe('empleado'), 'register_withdrawal', {
        p_lines: [{ supply_id: id.sB, qty: 1 }],
        p_shift_id: id.turnoE1,
      })
      expect(codigo(empleado)).toBe('INSUFFICIENT_STOCK')
      const admin = await rpc(clienteDe('admin'), 'register_withdrawal', {
        p_lines: [{ supply_id: id.sB, qty: 1 }],
        p_person_id: c().ids.empleado1,
        p_shift_id: id.turnoE1,
      })
      expect(codigo(admin)).toBe('INSUFFICIENT_STOCK')
      expect(await stockDe(id.sB)).toBe(0)
    })

    it('un retiro con dos artículos donde uno no alcanza no descuenta ninguno (todo o nada)', async () => {
      const antes = await stockDe(id.sD)
      const res = await rpc(clienteDe('empleado'), 'register_withdrawal', {
        p_lines: [
          { supply_id: id.sD, qty: 1 },
          { supply_id: id.sB, qty: 1 },
        ],
        p_shift_id: id.turnoE1,
      })
      expect(codigo(res)).toBe('INSUFFICIENT_STOCK')
      expect(await stockDe(id.sD)).toBe(antes)
    })

    it('anular un ingreso cuyo stock ya se usó se rechaza (VOID_INSUFFICIENT_STOCK) y el stock no baja de cero', async () => {
      const f = await ins.insumo({ slug: 'f', categoryId: id.categoria })
      const dueno = clienteDe('owner')
      const entrada = await rpc(dueno, 'register_stock_entry', {
        p_lines: [{ supply_id: f.id, qty: 5 }],
        p_note: ins.texto('ingreso-f'),
      })
      expect(entrada.error?.message).toBeUndefined()
      const movimiento = aJson(aJson(entrada.data).movement).id as string
      const retiro = await rpc(dueno, 'register_withdrawal', {
        p_lines: [{ supply_id: f.id, qty: 5 }],
        p_person_id: c().ids.empleado1,
        p_site_id: id.sedeQ1,
        p_note: ins.texto('retiro-f'),
      })
      expect(retiro.error?.message).toBeUndefined()
      expect(await stockDe(f.id)).toBe(0)
      const anular = await rpc(dueno, 'void_stock_movement', {
        p_movement_id: movimiento,
        p_reason: 'se cargó mal',
      })
      expect(codigo(anular)).toBe('VOID_INSUFFICIENT_STOCK')
      expect(await stockDe(f.id)).toBe(0)
    })

    it('seis retiros simultáneos de 1 sobre un stock de 3: salen exactamente 3 y el stock queda en 0, nunca negativo', async () => {
      const antes = await stockDe(id.sE)
      expect(antes).toBe(3)
      const empleado = clienteDe('empleado')
      const resultados = await Promise.all(
        Array.from({ length: 6 }, () =>
          rpc(empleado, 'register_withdrawal', {
            p_lines: [{ supply_id: id.sE, qty: 1 }],
            p_shift_id: id.turnoE1,
          }),
        ),
      )
      const codigos = resultados.map(codigo)
      expect(codigos.filter((x) => x === 'ok')).toHaveLength(3)
      expect(codigos.filter((x) => x === 'INSUFFICIENT_STOCK')).toHaveLength(3)
      expect(await stockDe(id.sE)).toBe(0)
    })

    it('cuatro retiros simultáneos que piden los mismos dos artículos en distinto orden no se traban: salen exactamente los que alcanzan', async () => {
      // E queda con 2 (D con 5): como cada retiro lleva 1 de cada uno, solo pueden salir 2.
      await ins.ingresar(id.sD, 2)
      await ins.ingresar(id.sE, 2)
      const antesD = await stockDe(id.sD)
      const antesE = await stockDe(id.sE)
      expect(antesE).toBe(2)
      const uno = [
        { supply_id: id.sD, qty: 1 },
        { supply_id: id.sE, qty: 1 },
      ]
      const otro = [...uno].reverse()
      const dueno = clienteDe('owner')
      const resultados = await Promise.all([
        rpc(clienteDe('empleado'), 'register_withdrawal', {
          p_lines: uno,
          p_shift_id: id.turnoE1,
        }),
        rpc(clienteDe('supervisor'), 'register_withdrawal', {
          p_lines: otro,
          p_shift_id: id.turnoE1,
        }),
        rpc(dueno, 'register_withdrawal', {
          p_lines: uno,
          p_person_id: c().ids.empleado1,
          p_shift_id: id.turnoE1,
        }),
        rpc(dueno, 'register_withdrawal', {
          p_lines: otro,
          p_person_id: c().ids.empleado1,
          p_shift_id: id.turnoE1,
        }),
      ])
      const codigos = resultados.map(codigo)
      expect(
        codigos.filter((x) => x !== 'ok' && x !== 'INSUFFICIENT_STOCK'),
        `sin trabas ni otros errores: ${codigos.join(', ')}`,
      ).toEqual([])
      const salieron = codigos.filter((x) => x === 'ok').length
      expect(salieron).toBe(2)
      expect(await stockDe(id.sE)).toBe(0)
      expect(await stockDe(id.sD)).toBe(antesD - 2)
    })
  })

  // -------------------------------------------------------------------------------------------
  // 6. IS-35: retiro en nombre de otro de quien también trabaja turnos
  // -------------------------------------------------------------------------------------------

  describe('administrador que también es empleado: retiro en nombre de otro con reglas de administración (IS-35)', () => {
    it('es administrador y empleado a la vez, con manage_stock', async () => {
      const roles = await servicio()
        .from('user_roles')
        .select('role')
        .eq('profile_id', (await adminOperativo.auth.getUser()).data.user!.id)
      expect((roles.data ?? []).map((r) => r.role).sort()).toEqual([
        'admin',
        'employee',
      ])
    })

    it('para sí mismo rigen las reglas de su rol: no ve los turnos ajenos ni el de ayer (IS-28)', async () => {
      const res = await tabla(adminOperativo, 'v_withdrawal_shift_options')
        .select('shift_id')
        .in('shift_id', [id.turnoE1, id.turnoE2, id.turnoPasado])
      expect(res.error, describir(res)).toBeNull()
      expect(filas(res)).toEqual([])
      const propio = await rpc(adminOperativo, 'register_withdrawal', {
        p_lines: [{ supply_id: id.sD, qty: 1 }],
        p_shift_id: id.turnoPasado,
      })
      expect(codigo(propio)).toBe('SHIFT_NOT_ALLOWED')
      const sede = await rpc(adminOperativo, 'register_withdrawal', {
        p_lines: [{ supply_id: id.sD, qty: 1 }],
        p_site_id: id.sedeQ1,
        p_note: ins.texto('propio-sede'),
      })
      expect(codigo(sede)).toBe('SITE_NOT_ALLOWED')
    })

    it('las vistas de administración le dan los turnos de -30 a +7 días y todas las sedes, sin el cancelado ni el de +20', async () => {
      const turnos = await tabla(
        adminOperativo,
        'v_withdrawal_shift_options_admin',
      )
        .select('shift_id')
        .in('shift_id', [
          id.turnoE1,
          id.turnoE2,
          id.turnoPasado,
          id.turnoLejano,
          id.turnoCancelado,
        ])
      expect(turnos.error, describir(turnos)).toBeNull()
      expect(claves(turnos, 'shift_id')).toEqual(
        new Set([id.turnoE1, id.turnoE2, id.turnoPasado]),
      )
      const sedes = await tabla(
        adminOperativo,
        'v_withdrawal_site_options_admin',
      )
        .select('site_id')
        .in('site_id', [id.sedeP1, id.sedeP2, id.sedeQ1])
      expect(claves(sedes, 'site_id')).toEqual(
        new Set([id.sedeP1, id.sedeP2, id.sedeQ1]),
      )
    })

    it('en nombre de otra persona acepta el turno de ayer (fuera de su rol), una sede cualquiera y deja a la persona como quien retira', async () => {
      const antes = await stockDe(id.sD)
      const turno = await rpc(adminOperativo, 'register_withdrawal', {
        p_lines: [{ supply_id: id.sD, qty: 1 }],
        p_shift_id: id.turnoPasado,
        p_person_id: c().ids.empleado1,
      })
      expect(turno.error?.message).toBeUndefined()
      const cabecera = aJson(aJson(turno.data).movement)
      expect(cabecera.person_id).toBe(c().ids.empleado1)
      expect(cabecera.shift_id).toBe(id.turnoPasado)
      expect(cabecera.recorded_by).toBe(
        (await adminOperativo.auth.getUser()).data.user!.id,
      )
      const sede = await rpc(adminOperativo, 'register_withdrawal', {
        p_lines: [{ supply_id: id.sD, qty: 1 }],
        p_site_id: id.sedeP2,
        p_person_id: c().ids.empleado1,
        p_note: ins.texto('en-nombre-sede'),
      })
      expect(sede.error?.message).toBeUndefined()
      expect(await stockDe(id.sD)).toBe(antes - 2)
      await ins.ingresar(id.sD, 2)
    })

    for (const perfil of ['dueno', 'admin'] as const) {
      it(`[${perfil === 'dueno' ? 'dueño' : 'admin con todas'}] más allá de la ventana (+20 días) o con un turno cancelado se rechaza aunque sea en nombre de otro`, async () => {
        const bd = clienteDe(perfil === 'dueno' ? 'owner' : 'admin')
        const lejano = await rpc(bd, 'register_withdrawal', {
          p_lines: [{ supply_id: id.sD, qty: 1 }],
          p_shift_id: id.turnoLejano,
          p_person_id: c().ids.empleado1,
        })
        expect(codigo(lejano)).toBe('SHIFT_NOT_ALLOWED')
        const cancelado = await rpc(bd, 'register_withdrawal', {
          p_lines: [{ supply_id: id.sD, qty: 1 }],
          p_shift_id: id.turnoCancelado,
          p_person_id: c().ids.empleado1,
        })
        expect(codigo(cancelado)).toBe('SHIFT_NOT_AVAILABLE')
      })
    }

    it('también se puede cargar para un coordinador, y se rechaza a un administrador como persona que retira', async () => {
      const antes = await stockDe(id.sD)
      const aCoordinador = await rpc(
        clienteDe('admin'),
        'register_withdrawal',
        {
          p_lines: [{ supply_id: id.sD, qty: 1 }],
          p_shift_id: id.turnoE1,
          p_person_id: c().ids.supervisor1,
        },
      )
      expect(aCoordinador.error?.message).toBeUndefined()
      const aAdmin = await rpc(clienteDe('admin'), 'register_withdrawal', {
        p_lines: [{ supply_id: id.sD, qty: 1 }],
        p_shift_id: id.turnoE1,
        p_person_id: c().ids.adminSin,
      })
      expect(codigo(aAdmin)).toBe('PERSON_NOT_FOUND')
      expect(await stockDe(id.sD)).toBe(antes - 1)
      await ins.ingresar(id.sD, 1)
    })

    it('puede avisar un faltante por su rol de empleado (con las reglas de ese rol)', async () => {
      const res = await rpc(adminOperativo, 'report_supply_shortage', {
        p_description: ins.texto('falta-admin-operativo'),
      })
      expect(res.error?.message).toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------------------------
  // 7. Escalamiento (CB-17): la capacidad nueva no se auto-otorga
  // -------------------------------------------------------------------------------------------

  describe('escalamiento de la capacidad manage_stock (CB-17, IS-19)', () => {
    it('un administrador sin capacidades no se da manage_stock a sí mismo y sigue sin poder mover stock', async () => {
      const res = await rpc(clienteDe('adminSin'), 'set_admin_capability', {
        p_profile_id: c().ids.adminSin,
        p_capability: 'manage_stock',
        p_enabled: true,
      })
      expect(res.error, 'se auto-otorgó la capacidad').not.toBeNull()
      const fila = await servicio()
        .from('admin_capabilities')
        .select('enabled')
        .eq('profile_id', c().ids.adminSin)
        .eq('capability', 'manage_stock')
        .maybeSingle()
      expect(fila.data?.enabled ?? false).toBe(false)
    })

    it('el administrador con todas no puede darle manage_stock a un empleado (solo el dueño administra capacidades)', async () => {
      const res = await rpc(clienteDe('admin'), 'set_admin_capability', {
        p_profile_id: c().ids.empleado1,
        p_capability: 'manage_stock',
        p_enabled: true,
      })
      expect(res.error).not.toBeNull()
    })

    it('un empleado y un coordinador no se dan la capacidad', async () => {
      for (const perfil of ['empleado', 'supervisor'] as const) {
        const res = await rpc(clienteDe(perfil), 'set_admin_capability', {
          p_profile_id: idPerfil(c(), perfil),
          p_capability: 'manage_stock',
          p_enabled: true,
        })
        expect(res.error, ETIQUETA[perfil]).not.toBeNull()
      }
    })
  })

  // -------------------------------------------------------------------------------------------
  // 8. Storage: bucket supply-images (0071, IS-32)
  // -------------------------------------------------------------------------------------------

  describe('bucket supply-images (IS-32)', () => {
    const subidasPorLaSuite: string[] = []
    const rutaDe = (perfil: Perfil, sufijo: string) =>
      `${id.sA}/${P}${perfil}-${sufijo}.jpg`

    afterAll(async () => {
      if (subidasPorLaSuite.length > 0) {
        await servicio().storage.from('supply-images').remove(subidasPorLaSuite)
      }
    })

    it('es privado, con tope de 2 MB y solo WebP y JPEG', async () => {
      const { data, error } =
        await servicio().storage.getBucket('supply-images')
      expect(error, error?.message).toBeNull()
      expect(data?.public).toBe(false)
      expect(data?.file_size_limit).toBe(2_097_152)
      expect([...(data?.allowed_mime_types ?? [])].sort()).toEqual([
        'image/jpeg',
        'image/webp',
      ])
    })

    for (const perfil of PERFILES) {
      const puede = ADMIN_STOCK.includes(perfil)
      const etiqueta = `[${ETIQUETA[perfil]}]`

      it(`${etiqueta} sube una imagen -> ${puede ? 'permitido' : 'rechazado'} (IS-19, IS-32)`, async () => {
        const ruta = rutaDe(perfil, 'subida')
        const { data, error } = await clienteDe(perfil)
          .storage.from('supply-images')
          .upload(ruta, JPEG, { contentType: 'image/jpeg', upsert: false })
        if (puede) {
          expect(error, error?.message).toBeNull()
          subidasPorLaSuite.push(ruta)
        } else {
          expect(error, 'subió sin manage_stock').not.toBeNull()
          expect(data).toBeNull()
          const existe = await servicio()
            .storage.from('supply-images')
            .list(id.sA, { search: `${P}${perfil}-subida.jpg` })
          expect(existe.data ?? []).toHaveLength(0)
        }
      })

      it(`${etiqueta} reemplaza una imagen existente -> ${puede ? 'permitido' : 'rechazado'}`, async () => {
        const ruta = subidos[1]
        const { error } = await clienteDe(perfil)
          .storage.from('supply-images')
          .upload(ruta, JPEG_2, { contentType: 'image/jpeg', upsert: true })
        if (puede) {
          expect(error, error?.message).toBeNull()
        } else {
          expect(error, 'reemplazó sin manage_stock').not.toBeNull()
          const bytes = await servicio()
            .storage.from('supply-images')
            .download(ruta)
          expect((await bytes.data?.arrayBuffer())?.byteLength).toBe(
            JPEG.length,
          )
        }
      })

      it(`${etiqueta} lee una imagen -> ${perfil === 'anon' ? 'rechazado' : 'permitido'} (los usuarios autenticados la leen)`, async () => {
        const { data, error } = await clienteDe(perfil)
          .storage.from('supply-images')
          .createSignedUrl(subidos[0], 60)
        if (perfil === 'anon') {
          expect(error, 'el visitante firmó una URL').not.toBeNull()
          return
        }
        expect(error, error?.message).toBeNull()
        const respuesta = await fetch(data!.signedUrl)
        expect(respuesta.status).toBe(200)
      })

      it(`${etiqueta} borra una imagen -> ${puede ? 'permitido' : 'rechazado'}`, async () => {
        const ruta = rutaDe(perfil, 'borrar')
        const db = servicio()
        const sube = await db.storage
          .from('supply-images')
          .upload(ruta, JPEG, { contentType: 'image/jpeg', upsert: true })
        expect(sube.error, sube.error?.message).toBeNull()
        subidasPorLaSuite.push(ruta)
        await clienteDe(perfil).storage.from('supply-images').remove([ruta])
        const sigue = await db.storage
          .from('supply-images')
          .list(id.sA, { search: `${P}${perfil}-borrar.jpg` })
        expect(
          sigue.data ?? [],
          puede ? 'no se borró' : 'se borró sin permiso',
        ).toHaveLength(puede ? 0 : 1)
      })
    }

    it('[dueño] no sube un archivo de más de 2 MB ni un PNG, aunque tenga permiso', async () => {
      const grande = new Uint8Array(2_200_000)
      grande.set(JPEG)
      const ruta = rutaDe('owner', 'grande')
      const a = await clienteDe('owner')
        .storage.from('supply-images')
        .upload(ruta, grande, { contentType: 'image/jpeg' })
      expect(a.error, 'aceptó más de 2 MB').not.toBeNull()
      const b = await clienteDe('owner')
        .storage.from('supply-images')
        .upload(rutaDe('owner', 'png'), PNG, { contentType: 'image/png' })
      expect(b.error, 'aceptó un PNG').not.toBeNull()
    })
  })

  // -------------------------------------------------------------------------------------------
  // 9. Cuenta desactivada con el token todavía vigente (CB-18)
  // -------------------------------------------------------------------------------------------

  for (const perfil of ['empleado', 'supervisor', 'admin'] as const) {
    describe(`desactivado: ${ETIQUETA[perfil]} con el token todavía vigente (CB-18)`, () => {
      let db: Db
      let token: string

      beforeAll(async () => {
        token = await tokenVigente(perfil, 600)
        db = clienteConToken(token)
        // Control: antes de la baja el token sirve.
        const antes = await tabla(db, 'v_supply_catalog')
          .select('id')
          .eq('id', id.sA)
        expect(
          filas(antes),
          'el token no sirve ni antes de la baja',
        ).toHaveLength(1)
        const r = await servicio()
          .from('profiles')
          .update({ is_active: false })
          .eq('id', idPerfil(c(), perfil))
        expect(r.error, r.error?.message).toBeNull()
      })

      afterAll(async () => {
        await servicio()
          .from('profiles')
          .update({ is_active: true, deleted_at: null })
          .eq('id', idPerfil(c(), perfil))
      })

      it('no ve el catálogo, sus retiros, sus avisos ni las opciones de turno y sede (CB-18)', async () => {
        for (const vista of [
          'v_supply_catalog',
          'v_my_withdrawals',
          'v_my_shortage_reports',
          'v_withdrawal_shift_options',
          'v_withdrawal_site_options',
          'v_withdrawal_shift_options_admin',
          'v_withdrawal_site_options_admin',
          'v_stock_admin',
          'v_stock_movements_admin',
          'v_stock_counts_admin',
          'v_supply_consumption_by_client',
        ]) {
          const res = await tabla(db, vista).select('*').limit(5)
          expect(res.error, `${vista}: ${describir(res)}`).toBeNull()
          expect(filas(res), `${vista} devolvió filas`).toEqual([])
        }
      })

      it('no puede retirar, avisar, ingresar, ajustar, controlar, anular ni resolver (CB-18)', async () => {
        const antes = await stockDe(id.sD)
        const intentos: Array<[string, object]> = [
          [
            'register_withdrawal',
            { p_lines: [{ supply_id: id.sD, qty: 1 }], p_shift_id: id.turnoE1 },
          ],
          ['report_supply_shortage', { p_supply_id: id.sA }],
          ['register_stock_entry', { p_lines: [{ supply_id: id.sD, qty: 1 }] }],
          [
            'adjust_stock',
            { p_supply_id: id.sD, p_delta: 1, p_reason: 'count' },
          ],
          [
            'register_stock_count',
            {
              p_counted_at: new Date(Date.now() - 60_000).toISOString(),
              p_lines: [{ supply_id: id.sD, counted_qty: 1 }],
              p_reviewer_name: ins.texto('revisor'),
            },
          ],
          ['void_stock_movement', { p_movement_id: id.mR1, p_reason: 'x' }],
          ['resolve_supply_shortage', { p_report_id: id.avisoE1, p_note: 'x' }],
          ['get_stock_summary', {}],
          ['upsert_supply_category', { p_name: `${ins.prefijo}desactivado` }],
        ]
        for (const [nombre, args] of intentos) {
          const res = await rpc(db, nombre, args)
          expect(codigo(res), `${nombre}: ${describir(res)}`).toBe('FORBIDDEN')
        }
        expect(await stockDe(id.sD)).toBe(antes)
      })

      it('no lee ni sube imágenes del bucket (CB-18)', async () => {
        const firmada = await db.storage
          .from('supply-images')
          .createSignedUrl(subidos[0], 60)
        expect(
          firmada.error,
          'firmó una URL estando desactivado',
        ).not.toBeNull()
        const sube = await db.storage
          .from('supply-images')
          .upload(`${id.sA}/${P}desactivado-${perfil}.jpg`, JPEG, {
            contentType: 'image/jpeg',
          })
        expect(sube.error).not.toBeNull()
      })
    })
  }

  // -------------------------------------------------------------------------------------------
  // 10. El seed no se tocó
  // -------------------------------------------------------------------------------------------

  describe('al final', () => {
    it('el stock de los insumos del seed es el mismo que antes de la suite', async () => {
      expect(await snapshot()).toEqual(snapshotSeed)
    })

    it('el entorno es App_dev y no producción', () => {
      expect(requireE2eEnv().supabaseUrl).toContain('anesttvrnpsaaaxaquce')
    })
  })
})

// JPEG mínimo válido y uno distinto para el reemplazo.
const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01,
  0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
])
const JPEG_2 = new Uint8Array([...JPEG, 0x00, 0x00, 0x00, 0x00])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
