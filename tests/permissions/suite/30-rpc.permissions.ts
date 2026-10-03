// tests/permissions/suite/30-rpc.permissions.ts — TEST-019 (P18.3)
//
// Cada RPC expuesta de `public` llamada por cada uno de los 7 perfiles, por API directa.
// Esperado en `rpc.ts` (`06_API.md`: toda RPC verifica rol y capacidad antes de hacer nada).

import { describe, expect } from 'vitest'
import { clienteDe, contexto } from './contexto.ts'
import { caso, claveCaso } from './defectos.ts'
import { ETIQUETA, PERFILES } from './perfiles.ts'
import { CASOS_RPC } from './rpc.ts'

describe.concurrent('RPC por perfil', () => {
  for (const c of CASOS_RPC) {
    const nombre = c.variante ? `${c.rpc} (${c.variante})` : c.rpc
    describe(nombre, () => {
      for (const perfil of PERFILES) {
        const esperado = c.esperado[perfil]
        const rastro = (c.cubre ?? ['RB-X02']).join(', ')
        caso(
          claveCaso('rpc', nombre, perfil),
          `[${ETIQUETA[perfil]}] ${nombre} -> ${esperado} (${rastro})`,
          async () => {
            const { error } = await clienteDe(perfil).rpc(
              c.rpc as 'mark_changes_seen',
              c.args(contexto(), perfil) as never,
            )
            const observado = error
              ? error.code === '42501'
                ? '42501'
                : (error.hint ?? error.code)
              : 'OK'
            expect(
              observado,
              error ? `${error.code}: ${error.message}` : 'la RPC no falló',
            ).toBe(esperado)
          },
        )
      }
    })
  }
})
