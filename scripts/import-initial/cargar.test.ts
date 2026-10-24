// @vitest-environment node
// P24.6: pruebas de la carga de clientes y sedes preferenciales con una base FALSA en memoria
// (no toca ningún proyecto de Supabase). Comprueban el orden, que la segunda corrida no duplique
// y que una prioridad ya vigente (23505, el equivalente de PRIORITY_ALREADY_EXISTS) cuente como
// ya cargada.

import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { cargar, leerExistentes } from './cargar.ts'
import { leerPlantilla } from './leer-plantilla.ts'
import {
  crearPlanilla,
  datosValidos,
  type DatosPlanilla,
} from './pruebas/planilla-ficticia.ts'
import { validar } from './validar.ts'

type Fila = Record<string, unknown>

/** Base en memoria con lo justo que usa el importador. */
class BaseFalsa {
  tablas = new Map<string, Fila[]>()
  cuentas = new Map<string, string>()
  contador = 0
  /** Fuerza que todo insert en `supervisor_priorities` falle con 23505. */
  fallar23505EnPrioridades = false

  filas(tabla: string): Fila[] {
    let f = this.tablas.get(tabla)
    if (!f) {
      f = []
      this.tablas.set(tabla, f)
    }
    return f
  }

  nuevoId(): string {
    this.contador++
    return `00000000-0000-0000-0000-${String(this.contador).padStart(12, '0')}`
  }

  insertar(tabla: string, valores: Fila | Fila[]) {
    const lista = Array.isArray(valores) ? valores : [valores]
    if (tabla === 'supervisor_priorities') {
      for (const v of lista) {
        const repetida = this.filas(tabla).some(
          (f) =>
            f.removed_at == null &&
            f.supervisor_id === v.supervisor_id &&
            f.client_id === v.client_id &&
            f.site_id === v.site_id,
        )
        if (repetida || this.fallar23505EnPrioridades) {
          return { code: '23505', message: 'duplicate key' }
        }
      }
    }
    for (const v of lista) {
      this.filas(tabla).push({
        id: this.nuevoId(),
        deleted_at: null,
        removed_at: null,
        ...v,
      })
    }
    return null
  }
}

/** El cliente de Supabase falso que usa el importador, armado sobre la base en memoria. */
function clienteDe(base: BaseFalsa): SupabaseClient {
  const from = (tabla: string) => ({
    select: () => ({
      order: () => ({
        range: () =>
          Promise.resolve({ data: [...base.filas(tabla)], error: null }),
      }),
    }),
    insert: (valores: Fila | Fila[]) => {
      const error = base.insertar(tabla, valores)
      const ultima = base.filas(tabla).at(-1)
      return Object.assign(Promise.resolve({ error }), {
        select: () => ({
          single: () => Promise.resolve({ data: error ? null : ultima, error }),
        }),
      })
    },
    update: () => ({ eq: () => Promise.resolve({ error: null }) }),
  })
  const auth = {
    admin: {
      listUsers: () =>
        Promise.resolve({
          data: {
            users: [...base.cuentas].map(([email, id]) => ({ email, id })),
          },
          error: null,
        }),
      createUser: ({ email }: { email: string }) => {
        const id = base.nuevoId()
        base.cuentas.set(email, id)
        return Promise.resolve({ data: { user: { id } }, error: null })
      },
    },
  }
  return { from, auth } as unknown as SupabaseClient
}

async function planDe(datos: DatosPlanilla) {
  const res = validar(await leerPlantilla(await crearPlanilla(datos)))
  expect(res.incidencias.filter((i) => i.nivel === 'error')).toEqual([])
  return res.plan
}

function datosConPreferencias(): DatosPlanilla {
  const datos = datosValidos()
  const carla = datos.Supervisores?.[1]
  if (!carla) throw new Error('Falta Carla en los datos de prueba')
  carla.preferencias =
    'Test Limpiezas Alfa S.A.; Test Textiles Beta S.R.L. / Planta Uno; Test Sin Cuit Gamma / Principal'
  return datos
}

const PASO_PERSONAS = 'Personas con usuario (empleados y supervisores)'

describe('carga de clientes y sedes preferenciales', () => {
  it('carga cada preferencia después de los clientes, las sedes y los coordinadores', async () => {
    const plan = await planDe(datosConPreferencias())
    const base = new BaseFalsa()
    const admin = clienteDe(base)
    const rastro = await cargar(admin, plan, await leerExistentes(admin), {
      resume: false,
    })
    expect(rastro.interrumpidaEn).toBeNull()
    const paso = rastro.pasos.find((p) => p.entidad.includes('preferenciales'))
    expect(paso).toMatchObject({ creados: 3, omitidos: 0, fallidos: [] })
    // Va después de las personas.
    const nombres = rastro.pasos.map((p) => p.entidad)
    expect(nombres.indexOf(paso?.entidad ?? '')).toBeGreaterThan(
      nombres.indexOf(PASO_PERSONAS),
    )

    const prioridades = base.filas('supervisor_priorities')
    expect(prioridades).toHaveLength(3)
    // Cada una es de un cliente o de una sede, nunca de las dos cosas.
    for (const p of prioridades) {
      expect((p.client_id == null) !== (p.site_id == null)).toBe(true)
    }
    expect(prioridades.filter((p) => p.client_id != null)).toHaveLength(1)
    expect(prioridades.filter((p) => p.site_id != null)).toHaveLength(2)
    // Son de Carla (la coordinadora con la lista), y de nadie más.
    const idCarla = base.cuentas.get('carla.tres@prueba.test')
    expect(new Set(prioridades.map((p) => p.supervisor_id))).toEqual(
      new Set([idCarla]),
    )
  })

  it('la segunda corrida (--resume) no duplica nada', async () => {
    const plan = await planDe(datosConPreferencias())
    const base = new BaseFalsa()
    const admin = clienteDe(base)
    await cargar(admin, plan, await leerExistentes(admin), { resume: false })

    const rastro = await cargar(admin, plan, await leerExistentes(admin), {
      resume: true,
    })
    const paso = rastro.pasos.find((p) => p.entidad.includes('preferenciales'))
    expect(paso).toMatchObject({ creados: 0, omitidos: 3, fallidos: [] })
    expect(base.filas('supervisor_priorities')).toHaveLength(3)
  })

  it('una prioridad dada de baja se puede volver a cargar', async () => {
    const plan = await planDe(datosConPreferencias())
    const base = new BaseFalsa()
    const admin = clienteDe(base)
    await cargar(admin, plan, await leerExistentes(admin), { resume: false })
    // Se da de baja la prioridad del cliente entero.
    const delCliente = base
      .filas('supervisor_priorities')
      .find((p) => p.client_id != null)
    if (!delCliente) throw new Error('Falta la prioridad del cliente')
    delCliente.removed_at = '2026-10-23T12:00:00Z'

    const rastro = await cargar(admin, plan, await leerExistentes(admin), {
      resume: true,
    })
    const paso = rastro.pasos.find((p) => p.entidad.includes('preferenciales'))
    expect(paso).toMatchObject({ creados: 1, omitidos: 2 })
    expect(
      base.filas('supervisor_priorities').filter((p) => p.removed_at == null),
    ).toHaveLength(3)
  })

  it('si la base responde "ya existe" (23505), se toma como ya cargada y no es una falla', async () => {
    const plan = await planDe(datosConPreferencias())
    const base = new BaseFalsa()
    base.fallar23505EnPrioridades = true
    const admin = clienteDe(base)
    const rastro = await cargar(admin, plan, await leerExistentes(admin), {
      resume: false,
    })
    const paso = rastro.pasos.find((p) => p.entidad.includes('preferenciales'))
    expect(paso).toMatchObject({ creados: 0, omitidos: 3, fallidos: [] })
  })

  it('sin preferencias en la planilla, el paso existe y no escribe nada', async () => {
    const plan = await planDe(datosValidos())
    const base = new BaseFalsa()
    const admin = clienteDe(base)
    const rastro = await cargar(admin, plan, await leerExistentes(admin), {
      resume: false,
    })
    const paso = rastro.pasos.find((p) => p.entidad.includes('preferenciales'))
    expect(paso).toMatchObject({ creados: 0, omitidos: 0, fallidos: [] })
    expect(base.filas('supervisor_priorities')).toEqual([])
  })
})
