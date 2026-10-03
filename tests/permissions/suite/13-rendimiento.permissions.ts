// tests/permissions/suite/13-rendimiento.permissions.ts — TEST-019 (P18.3)
//
// La RLS no puede volver inutilizable una tabla para quien tiene permiso de leerla. Un
// `select` sin filtro sobre `shift_tasks` por un empleado o un supervisor evalúa la política
// fila por fila: con 6.655 filas hoy tarda 7 a 8 segundos y con el doble rol se cancela por el
// límite de la consulta (DEF-P02). Cualquier cuenta de empleado puede ocupar la base con eso.
// Criterio: responde sin error en menos de 3 segundos (RB-X02; `03` sección 14.1, rendimiento).

import { describe, expect } from 'vitest'
import { clienteDe } from './contexto.ts'
import { caso, claveCaso } from './defectos.ts'
import { describir, tabla } from './ayudas.ts'
import { ETIQUETA, type Perfil } from './perfiles.ts'

const LIMITE_MS = 3_000

describe('rendimiento de la RLS sobre tablas grandes', () => {
  for (const perfil of ['empleado', 'supervisor'] as Perfil[]) {
    caso(
      claveCaso('rendimiento', 'shift_tasks', perfil),
      `[${ETIQUETA[perfil]}] shift_tasks.select sin filtro responde en menos de ${LIMITE_MS} ms (RB-X02)`,
      async () => {
        const t0 = Date.now()
        const res = await tabla(clienteDe(perfil), 'shift_tasks')
          .select('*')
          .limit(5)
        const ms = Date.now() - t0
        expect(res.error, describir(res)).toBeNull()
        expect(ms, `tardó ${ms} ms`).toBeLessThan(LIMITE_MS)
      },
    )
  }
})
