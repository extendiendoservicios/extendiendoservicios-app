// tests/permissions/suite/10-tablas-lectura.permissions.ts — TEST-019 (P18.3)
//
// Lectura (`select`) de las 25 tablas de `public` por los 7 perfiles, por API directa.
// Esperado: `04_Modelo_de_Datos.md` sección 7.2 (ver `tablas.ts`). Cubre RB-X02, RB-A01 a RB-A09,
// RB-E02 a RB-E07 y RB-S02 a RB-S05; CB-15 (el empleado lee `ratings` y obtiene cero filas) y
// CB-17 (nadie sin ser dueño ve ni toca capacidades ajenas).

import { beforeAll, describe, expect } from 'vitest'
import { clienteDe, contexto, servicio } from './contexto.ts'
import { caso, claveCaso } from './defectos.ts'
import { claves, denegado, describir, filas, tabla } from './ayudas.ts'
import { ETIQUETA, PERFILES } from './perfiles.ts'
import { TABLAS } from './tablas.ts'

describe.concurrent('lectura de tablas por perfil', () => {
  const conFilas = new Map<string, number>()

  beforeAll(async () => {
    // La tabla tiene que tener filas de verdad: si no, un "cero filas" no prueba nada.
    for (const spec of TABLAS) {
      const { count, error } = await servicio()
        .from(spec.tabla as 'profiles')
        .select('*', { count: 'exact', head: true })
      if (error) throw new Error(`${spec.tabla}: ${error.message}`)
      conFilas.set(spec.tabla, count ?? 0)
    }
  })

  for (const spec of TABLAS) {
    describe(`tabla ${spec.tabla}`, () => {
      for (const perfil of PERFILES) {
        const ve = spec.ve[perfil]
        const base = `[${ETIQUETA[perfil]}] ${spec.tabla}.select -> ${
          typeof ve === 'string' ? ve : `ve ${ve.join(', ')}`
        } (RB-X02${spec.tabla === 'ratings' ? ', CB-15' : ''}${
          spec.tabla === 'admin_capabilities' ? ', CB-17' : ''
        })`
        caso(
          claveCaso('tabla', spec.tabla, 'select', perfil),
          base,
          async () => {
            const c = contexto()
            const db = clienteDe(perfil)
            const plantadas = spec.filas(c)
            const valores = Object.values(plantadas)

            if (ve === 'denegado') {
              const res = await tabla(db, spec.tabla).select('*').limit(5)
              expect(denegado(res), describir(res)).toBe(true)
              expect(filas(res)).toEqual([])
              return
            }
            if (ve === 'nada') {
              expect(
                conFilas.get(spec.tabla) ?? 0,
                `${spec.tabla} no tiene filas: un "cero filas" no probaría nada`,
              ).toBeGreaterThan(0)
              const consulta = tabla(db, spec.tabla).select('*')
              const res = await (spec.pesada
                ? consulta.in(spec.clave, valores)
                : consulta.limit(5))
              expect(res.error, describir(res)).toBeNull()
              expect(filas(res), `${spec.tabla} devolvió filas`).toEqual([])
              return
            }
            const res = await tabla(db, spec.tabla)
              .select('*')
              .in(spec.clave, valores)
            expect(res.error, describir(res)).toBeNull()
            const esperadas = new Set(
              ve === 'todo' ? valores : ve.map((k) => plantadas[k]),
            )
            expect(claves(res, spec.clave)).toEqual(esperadas)
          },
        )
      }
    })
  }
})
