// tests/permissions/suite/11-tablas-escritura.permissions.ts — TEST-019 (P18.3)
//
// Escritura (`insert`, `update`, `delete`) de las 25 tablas de `public` por los 7 perfiles, por
// API directa. Lo permitido tiene que funcionar (contraprueba: así un `deny all` accidental no
// pasa la suite) y lo no permitido tiene que ser rechazado: error `42501` (grants o RLS),
// `FORBIDDEN` (trigger de columnas de `profiles`) o cero filas afectadas, con la verificación
// de que la fila no cambió. Cubre RB-X02 y CB-17 (escalamiento: darse un rol o una capacidad).

import { describe, expect } from 'vitest'
import { clienteDe, contexto, servicio } from './contexto.ts'
import { caso, claveCaso } from './defectos.ts'
import {
  denegado,
  describir,
  filas,
  tabla,
  type Consulta,
  type Fila,
} from './ayudas.ts'
import { ETIQUETA, PERFILES } from './perfiles.ts'
import { idPerfil, TABLAS, type Pk, type TablaSpec } from './tablas.ts'

/** Aplica la igualdad por columna de la clave a una consulta. */
function conPk(consulta: Consulta, pk: Pk): Consulta {
  let q = consulta
  for (const [columna, valor] of Object.entries(pk)) q = q.eq(columna, valor)
  return q
}

function pkDe(spec: TablaSpec, fila: Fila): Pk {
  return Object.fromEntries(spec.pk.map((col) => [col, String(fila[col])]))
}

/** Borra con la clave de servicio lo que una prueba haya creado (indebida o debidamente). */
async function borrarConServicio(spec: TablaSpec, filasCreadas: Fila[]) {
  for (const fila of filasCreadas) {
    await conPk(tabla(servicio(), spec.tabla).delete(), pkDe(spec, fila))
  }
}

async function crearVictima(spec: TablaSpec): Promise<Fila> {
  if (!spec.victima)
    throw new Error(`${spec.tabla} no tiene fábrica de víctima`)
  const res = await tabla(servicio(), spec.tabla)
    .insert(spec.victima(contexto()))
    .select()
  const creada = filas(res)[0]
  if (res.error || !creada) {
    throw new Error(
      `No se pudo crear la víctima de ${spec.tabla}: ${describir(res)}`,
    )
  }
  return creada
}

describe('escritura de tablas por perfil', () => {
  for (const spec of TABLAS) {
    describe(`tabla ${spec.tabla}`, () => {
      // ---- insert ------------------------------------------------------------------------
      for (const perfil of PERFILES) {
        const permitido = spec.insert.permitido.includes(perfil)
        const base = `[${ETIQUETA[perfil]}] ${spec.tabla}.insert -> ${
          permitido ? 'permitido' : 'rechazado'
        } (RB-X02${spec.tabla === 'user_roles' || spec.tabla === 'admin_capabilities' ? ', CB-17' : ''})`
        caso(
          claveCaso('tabla', spec.tabla, 'insert', perfil),
          base,
          async () => {
            const c = contexto()
            const res = await tabla(clienteDe(perfil), spec.tabla)
              .insert(spec.insert.fila(c, perfil))
              .select()
            const creadas = filas(res)
            try {
              if (permitido) {
                expect(res.error, describir(res)).toBeNull()
                expect(creadas).toHaveLength(1)
              } else {
                expect(
                  denegado(res),
                  `se creó una fila: ${describir(res)}`,
                ).toBe(true)
              }
            } finally {
              await borrarConServicio(spec, creadas)
            }
          },
        )
      }

      // ---- update ------------------------------------------------------------------------
      for (const variante of spec.update) {
        for (const perfil of PERFILES) {
          const permitido = variante.permitido.includes(perfil)
          const base = `[${ETIQUETA[perfil]}] ${spec.tabla}.update (${variante.nombre}) -> ${
            permitido ? 'permitido' : 'rechazado'
          } (RB-X02${variante.nombre.includes('status') ? ', CB-17' : ''})`
          caso(
            claveCaso('tabla', spec.tabla, `update ${variante.nombre}`, perfil),
            base,
            async () => {
              const c = contexto()
              let victima: Fila | null = null
              let pk: Pk
              if (variante.propio) {
                pk = { [variante.propio]: idPerfil(c, perfil) }
              } else if (variante.objetivo) {
                pk = variante.objetivo(c, perfil)
              } else if (spec.victima) {
                victima = await crearVictima(spec)
                pk = pkDe(spec, victima)
              } else {
                pk = spec.objetivo(c)
              }
              const columnas = Object.keys(variante.parche).join(',')
              // Foto de la fila antes: se repone al final y sirve para comprobar que no cambió.
              const antes = filas(
                await conPk(tabla(servicio(), spec.tabla).select(columnas), pk),
              )[0]
              try {
                const res = await conPk(
                  tabla(clienteDe(perfil), spec.tabla).update(variante.parche),
                  pk,
                ).select()
                if (permitido) {
                  expect(res.error, describir(res)).toBeNull()
                  expect(filas(res).length).toBeGreaterThanOrEqual(1)
                } else {
                  expect(denegado(res), `se modificó: ${describir(res)}`).toBe(
                    true,
                  )
                  if (!res.error && antes) {
                    const despues = filas(
                      await conPk(
                        tabla(servicio(), spec.tabla).select(columnas),
                        pk,
                      ),
                    )[0]
                    expect(
                      despues,
                      'la fila cambió aunque no devolvió filas',
                    ).toEqual(antes)
                  }
                }
              } finally {
                if (antes) {
                  await conPk(tabla(servicio(), spec.tabla).update(antes), pk)
                }
                if (victima) await borrarConServicio(spec, [victima])
              }
            },
          )
        }
      }

      // ---- delete ------------------------------------------------------------------------
      for (const perfil of PERFILES) {
        const permitido = spec.delete?.permitido.includes(perfil) ?? false
        const base = `[${ETIQUETA[perfil]}] ${spec.tabla}.delete -> ${
          permitido ? 'permitido' : 'rechazado'
        } (RB-X02)`
        caso(
          claveCaso('tabla', spec.tabla, 'delete', perfil),
          base,
          async () => {
            const c = contexto()
            const victima = spec.victima ? await crearVictima(spec) : null
            const pk = victima ? pkDe(spec, victima) : spec.objetivo(c)
            try {
              const res = await conPk(
                tabla(clienteDe(perfil), spec.tabla).delete(),
                pk,
              ).select()
              if (permitido) {
                expect(res.error, describir(res)).toBeNull()
                expect(filas(res)).toHaveLength(1)
              } else {
                expect(denegado(res), `se borró: ${describir(res)}`).toBe(true)
                if (!res.error) {
                  const sigue = filas(
                    await conPk(tabla(servicio(), spec.tabla).select(), pk),
                  )
                  expect(
                    sigue,
                    'la fila ya no está aunque no devolvió filas',
                  ).toHaveLength(1)
                }
              }
            } finally {
              if (victima) await borrarConServicio(spec, [victima])
            }
          },
        )
      }
    })
  }
})
