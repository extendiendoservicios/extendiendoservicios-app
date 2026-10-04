// tests/permissions/suite/20-vistas.permissions.ts — TEST-019 (P18.3)
//
// Las 12 vistas `v_*` por los 7 perfiles: qué filas ve cada uno (las vistas son
// `security_invoker`: aplican la RLS de las tablas base, `04_Modelo_de_Datos.md` sección 4) y
// que ninguna se pueda escribir. `anon` solo lee `v_public_branding` (RB-X02, RB-A01).

import { beforeAll, describe, expect, it } from 'vitest'
import { clienteDe, contexto, servicio } from './contexto.ts'
import { caso, claveCaso } from './defectos.ts'
import {
  claves,
  denegado,
  describir,
  filas,
  tabla,
  type Resultado,
} from './ayudas.ts'
import { ETIQUETA, PERFILES } from './perfiles.ts'
import { VISTAS } from './vistas.ts'

describe.concurrent('lectura de vistas por perfil', () => {
  const conFilas = new Map<string, number>()

  beforeAll(async () => {
    // Una vista que nadie ve (cero filas en origen) no probaría nada: se comprueba con la clave
    // de servicio que tiene filas.
    for (const spec of VISTAS) {
      const { count, error } = await servicio()
        .from(spec.vista as 'v_clients')
        .select('*', { count: 'exact', head: true })
      if (error) throw new Error(`${spec.vista}: ${error.message}`)
      conFilas.set(spec.vista, count ?? 0)
    }
  })

  for (const spec of VISTAS) {
    if (spec.vista === 'v_public_branding') continue
    describe(`vista ${spec.vista}`, () => {
      for (const perfil of PERFILES) {
        const ve = spec.ve[perfil]
        const base = `[${ETIQUETA[perfil]}] ${spec.vista}.select -> ${
          typeof ve === 'string' ? ve : `ve ${ve.join(', ')}`
        } (RB-X02)`
        caso(
          claveCaso('vista', spec.vista, 'select', perfil),
          base,
          async () => {
            const c = contexto()
            const db = clienteDe(perfil)
            const plantadas = spec.filas(c)
            const valores = Object.values(plantadas)
            if (ve === 'denegado') {
              const res = await tabla(db, spec.vista).select('*').limit(5)
              expect(denegado(res), describir(res)).toBe(true)
              expect(filas(res)).toEqual([])
              return
            }
            if (ve === 'nada') {
              if (!spec.propia) {
                expect(conFilas.get(spec.vista) ?? 0).toBeGreaterThan(0)
              }
              const res = await tabla(db, spec.vista).select('*').limit(5)
              expect(res.error, describir(res)).toBeNull()
              expect(filas(res), `${spec.vista} devolvió filas`).toEqual([])
              return
            }
            const res = await tabla(db, spec.vista)
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

  describe('vista v_public_branding', () => {
    for (const perfil of PERFILES) {
      it(`[${ETIQUETA[perfil]}] v_public_branding.select -> una fila con nombre, logo y teléfono (RB-A01, RB-X02)`, async () => {
        const res = await tabla(clienteDe(perfil), 'v_public_branding').select(
          '*',
        )
        expect(res.error, describir(res)).toBeNull()
        const todas = filas(res)
        expect(todas).toHaveLength(1)
        // Solo las tres columnas públicas: nada del texto de consentimiento ni de quién editó.
        expect(Object.keys(todas[0]).sort()).toEqual([
          'logo_path',
          'name',
          'support_phone',
        ])
      })
    }

    it('[anon] company_settings: solo lee las columnas públicas, no el resto (RB-X02)', async () => {
      const db = clienteDe('anon')
      const publicas = await tabla(db, 'company_settings').select(
        'name,logo_path,support_phone',
      )
      expect(publicas.error, describir(publicas)).toBeNull()
      expect(filas(publicas)).toHaveLength(1)
      const privada = await tabla(db, 'company_settings').select(
        'location_consent_text',
      )
      expect(denegado(privada), describir(privada)).toBe(true)
      expect(filas(privada)).toEqual([])
    })
  })
})

describe('escritura de vistas: ninguna se puede escribir', () => {
  for (const spec of VISTAS) {
    describe(`vista ${spec.vista}`, () => {
      for (const perfil of PERFILES) {
        caso(
          claveCaso('vista', spec.vista, 'escritura', perfil),
          `[${ETIQUETA[perfil]}] ${spec.vista}.insert/update/delete -> rechazados (RB-X02)`,
          async () => {
            const db = clienteDe(perfil)
            // Una fila inexistente: aunque la vista fuera actualizable, no hay nada que tocar;
            // lo que se mira es que el rechazo sea por permisos y no por datos.
            const inexistente = '00000000-0000-4000-8000-000000000001'
            // `42501`: la vista no tiene grants de escritura. `55000`: ni siquiera es
            // actualizable (tiene joins o agregados). Cualquiera de las dos es un rechazo.
            const rechazada = (res: Resultado) =>
              !!res.error && ['42501', '55000'].includes(res.error.code)
            const ins = await tabla(db, spec.vista)
              .insert({ [spec.clave]: inexistente })
              .select()
            expect(rechazada(ins), `insert: ${describir(ins)}`).toBe(true)
            const upd = await tabla(db, spec.vista)
              .update({ [spec.clave]: inexistente })
              .eq(spec.clave, inexistente)
              .select()
            expect(rechazada(upd), `update: ${describir(upd)}`).toBe(true)
            const del = await tabla(db, spec.vista)
              .delete()
              .eq(spec.clave, inexistente)
              .select()
            expect(rechazada(del), `delete: ${describir(del)}`).toBe(true)
          },
        )
      }
    })
  }
})
