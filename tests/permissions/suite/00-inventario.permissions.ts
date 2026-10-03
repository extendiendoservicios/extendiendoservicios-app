// tests/permissions/suite/00-inventario.permissions.ts — TEST-019 (P18.3)
//
// Que la matriz no quede vieja: compara lo que HAY (las migraciones `supabase/migrations/`, las
// Edge Functions y, contra App_dev, lo que expone PostgREST) con lo que la matriz CUBRE. Si
// aparece una tabla, una vista, una RPC, un bucket, una Edge Function o una acción nueva sin
// casos, esta prueba falla y dice cuál es. También falla al revés: la matriz nombra algo que ya
// no existe.

import { describe, expect, it } from 'vitest'
import { requireE2eEnv } from '../../fixtures/env.ts'
import { BUCKETS_CUBIERTOS, EDGE_CUBIERTAS } from './cobertura.ts'
import { CASOS } from './edge-casos.ts'
import { leerInventario } from './inventario.ts'
import { CASOS_RPC, RPC_DE_PLATAFORMA } from './rpc.ts'
import { PERFILES } from './perfiles.ts'
import { TABLAS } from './tablas.ts'
import { VISTAS } from './vistas.ts'

const inventario = leerInventario()

function diferencias(hay: string[], cubre: string[]) {
  const sinCasos = hay.filter((x) => !cubre.includes(x))
  const sobrantes = cubre.filter((x) => !hay.includes(x))
  return { sinCasos, sobrantes }
}

describe('inventario de migraciones contra la matriz', () => {
  it('se leen las migraciones (0001 en adelante) (RB-X02)', () => {
    expect(inventario.archivos).toBeGreaterThanOrEqual(29)
    // Piso de lo conocido hoy: si el parser dejara de ver objetos, no se pasaría en silencio.
    expect(inventario.tablas.length).toBeGreaterThanOrEqual(25)
    expect(inventario.vistas.length).toBeGreaterThanOrEqual(10)
    expect(inventario.funciones.length).toBeGreaterThanOrEqual(29)
  })

  it('cada tabla de `public` tiene sus casos en la matriz (7 perfiles x select, insert, update, delete) (RB-X02)', () => {
    const { sinCasos, sobrantes } = diferencias(
      inventario.tablas,
      TABLAS.map((t) => t.tabla),
    )
    expect(
      sinCasos,
      `Tablas nuevas SIN casos en tests/permissions/suite/tablas.ts: ${sinCasos.join(', ')}`,
    ).toEqual([])
    expect(
      sobrantes,
      `La matriz nombra tablas que ya no existen: ${sobrantes.join(', ')}`,
    ).toEqual([])
  })

  it('cada tabla define el esperado de los 7 perfiles (RB-X02)', () => {
    for (const t of TABLAS) {
      expect(Object.keys(t.ve).sort(), t.tabla).toEqual([...PERFILES].sort())
      expect(t.insert.permitido, `${t.tabla}: insert`).toBeDefined()
      expect(
        t.update.length,
        `${t.tabla}: update sin variantes`,
      ).toBeGreaterThan(0)
    }
  })

  it('cada vista `v_*` tiene sus casos en la matriz (RB-X02)', () => {
    const { sinCasos, sobrantes } = diferencias(
      inventario.vistas,
      VISTAS.map((v) => v.vista),
    )
    expect(
      sinCasos,
      `Vistas nuevas SIN casos en tests/permissions/suite/vistas.ts: ${sinCasos.join(', ')}`,
    ).toEqual([])
    expect(
      sobrantes,
      `La matriz nombra vistas que ya no existen: ${sobrantes.join(', ')}`,
    ).toEqual([])
  })

  it('cada RPC expuesta tiene sus casos en la matriz (7 perfiles) (RB-X02)', () => {
    const expuestas = inventario.funciones
      .filter((f) => f.authenticated || f.soloServicio)
      .map((f) => f.nombre)
    const cubiertas = [...new Set(CASOS_RPC.map((c) => c.rpc))].filter(
      (r) => !(RPC_DE_PLATAFORMA as readonly string[]).includes(r),
    )
    const { sinCasos, sobrantes } = diferencias(expuestas, cubiertas)
    expect(
      sinCasos,
      `RPC nuevas SIN casos en tests/permissions/suite/rpc.ts: ${sinCasos.join(', ')}`,
    ).toEqual([])
    expect(
      sobrantes,
      `La matriz nombra RPC que ya no existen: ${sobrantes.join(', ')}`,
    ).toEqual([])
    for (const c of CASOS_RPC) {
      expect(Object.keys(c.esperado).sort(), c.rpc).toEqual(
        [...PERFILES].sort(),
      )
    }
    // Y las de la plataforma tienen su caso, aunque no salgan de las migraciones.
    for (const r of RPC_DE_PLATAFORMA) {
      expect(
        CASOS_RPC.some((c) => c.rpc === r),
        `${r} sin casos`,
      ).toBe(true)
    }
  })

  it('ninguna función de `public` queda ejecutable por `anon` o por PUBLIC (revoke explícito) (03 §15, RB-X02)', () => {
    const abiertas = inventario.funciones
      .filter((f) => !f.revocadaAAnon)
      .map((f) => f.nombre)
    expect(
      abiertas,
      `Funciones sin \`revoke execute ... from public, anon\`: ${abiertas.join(', ')}`,
    ).toEqual([])
  })

  it('cada función de `public` o la ejecuta `authenticated` o es de uso exclusivo de `service_role` (RB-X02)', () => {
    const sinDestino = inventario.funciones
      .filter((f) => !f.authenticated && !f.soloServicio)
      .map((f) => f.nombre)
    expect(
      sinDestino,
      `Funciones sin grant de execute: ${sinDestino.join(', ')}`,
    ).toEqual([])
  })

  it('cada bucket de Storage tiene sus casos (RB-X02)', () => {
    const { sinCasos, sobrantes } = diferencias(inventario.buckets, [
      ...BUCKETS_CUBIERTOS,
    ])
    expect(
      sinCasos,
      `Buckets nuevos SIN casos en 50-storage: ${sinCasos.join(', ')}`,
    ).toEqual([])
    expect(
      sobrantes,
      `La matriz nombra buckets que no existen: ${sobrantes.join(', ')}`,
    ).toEqual([])
  })

  it('cada Edge Function y cada acción tiene sus casos (RB-X02)', () => {
    const hay = inventario.edge.map((e) => e.nombre)
    const { sinCasos, sobrantes } = diferencias(
      hay,
      Object.keys(EDGE_CUBIERTAS),
    )
    expect(
      sinCasos,
      `Edge Functions nuevas SIN casos en 60-edge: ${sinCasos.join(', ')}`,
    ).toEqual([])
    expect(
      sobrantes,
      `La matriz nombra Edge Functions que no existen: ${sobrantes.join(', ')}`,
    ).toEqual([])
    for (const e of inventario.edge) {
      const cubiertas = [...(EDGE_CUBIERTAS[e.nombre] ?? [])]
      const { sinCasos: faltan, sobrantes: sobran } = diferencias(
        e.acciones,
        cubiertas,
      )
      expect(
        faltan,
        `${e.nombre}: acciones SIN casos: ${faltan.join(', ')}`,
      ).toEqual([])
      expect(
        sobran,
        `${e.nombre}: la matriz nombra acciones que no existen: ${sobran.join(', ')}`,
      ).toEqual([])
    }
    // Y los casos concretos cubren exactamente las acciones declaradas.
    expect(CASOS.map((c) => c.accion).sort()).toEqual(
      [...(EDGE_CUBIERTAS['admin-users'] ?? [])].sort(),
    )
  })
})

describe('inventario de App_dev contra la matriz (lo que PostgREST expone de verdad)', () => {
  it('lo que App_dev expone en /rest/v1 coincide con las migraciones y con la matriz (RB-X02)', async () => {
    const env = requireE2eEnv()
    const respuesta = await fetch(`${env.supabaseUrl}/rest/v1/`, {
      headers: {
        apikey: env.serviceRoleKey,
        Authorization: `Bearer ${env.serviceRoleKey}`,
        Accept: 'application/openapi+json',
      },
    })
    expect(respuesta.status, 'no se pudo leer el esquema expuesto').toBe(200)
    const esquema = (await respuesta.json()) as {
      paths?: Record<string, unknown>
    }
    const rutas = Object.keys(esquema.paths ?? {})
    const rpcExpuestas = rutas
      .filter((r) => r.startsWith('/rpc/'))
      .map((r) => r.slice('/rpc/'.length))
      .sort()
    const objetos = rutas
      .filter((r) => r !== '/' && !r.startsWith('/rpc/'))
      .map((r) => r.slice(1))
      .sort()

    const cubiertasRpc = [...new Set(CASOS_RPC.map((c) => c.rpc))].sort()
    const { sinCasos: rpcSinCasos, sobrantes: rpcSobrantes } = diferencias(
      rpcExpuestas,
      cubiertasRpc,
    )
    expect(
      rpcSinCasos,
      `App_dev expone RPC sin casos: ${rpcSinCasos.join(', ')}`,
    ).toEqual([])
    expect(
      rpcSobrantes,
      `La matriz nombra RPC que App_dev no expone: ${rpcSobrantes.join(', ')}`,
    ).toEqual([])

    const cubiertos = [
      ...TABLAS.map((t) => t.tabla),
      ...VISTAS.map((v) => v.vista),
    ].sort()
    const { sinCasos, sobrantes } = diferencias(objetos, cubiertos)
    expect(
      sinCasos,
      `App_dev expone tablas o vistas sin casos: ${sinCasos.join(', ')}`,
    ).toEqual([])
    expect(
      sobrantes,
      `La matriz nombra tablas o vistas que App_dev no expone: ${sobrantes.join(', ')}`,
    ).toEqual([])
  })
})
