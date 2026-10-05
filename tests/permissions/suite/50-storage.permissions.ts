// tests/permissions/suite/50-storage.permissions.ts — TEST-019 (P18.3)
//
// Buckets de Storage `avatars` y `branding` (`04_Modelo_de_Datos.md` sección 7.3, ADR-016):
// leer, subir, reemplazar y borrar, en la carpeta PROPIA y en la AJENA, por los 7 perfiles, más
// los límites de tamaño y tipo.
//
//   avatars   `{profile_id}/{archivo}.jpg`, máx. 2 MB, solo JPEG. Lectura pública; escribe el
//             dueño de la carpeta, el administrador y el dueño de la empresa.
//   branding  logo, máx. 1 MB, PNG/JPEG/WebP (sin SVG desde P18.6, SEG-02). Lectura pública;
//             escriben administrador y dueño.
//
// Todo lo que sube la suite lleva el prefijo `e2e-perm-` y se borra al final.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clienteDe, contexto, servicio } from './contexto.ts'
import { caso, claveCaso } from './defectos.ts'
import { ES_ADMIN, ETIQUETA, PERFILES, type Perfil } from './perfiles.ts'
import { idPerfil } from './tablas.ts'
import { requireE2eEnv } from '../../fixtures/env.ts'

// JPEG mínimo válido (cabecera y fin de imagen).
const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01,
  0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const opcionesJpeg = { contentType: 'image/jpeg' }
const opcionesPng = { contentType: 'image/png' }

const esAdmin = (perfil: Perfil) => ES_ADMIN.includes(perfil)

describe('Storage: avatars y branding', () => {
  const subidos: Array<{ bucket: 'avatars' | 'branding'; ruta: string }> = []
  /** Carpeta propia de cada perfil (el visitante `anon` no tiene: una inventada). */
  const propia = (perfil: Perfil) => idPerfil(contexto(), perfil)
  const ajena = () => contexto().ids.empleado2

  const registrar = (bucket: 'avatars' | 'branding', ruta: string) => {
    subidos.push({ bucket, ruta })
    return ruta
  }

  beforeAll(async () => {
    const c = contexto()
    const db = servicio()
    // Objetos plantados para leer, reemplazar y borrar.
    for (const id of [
      c.ids.empleado2,
      c.ids.empleado1,
      c.ids.supervisor1,
      c.ids.dual,
      c.ids.adminSin,
      c.ids.admin,
      c.ids.owner,
    ]) {
      for (const nombre of ['lectura', 'reemplazo', 'borrado']) {
        const ruta = registrar('avatars', `${id}/e2e-perm-${nombre}.jpg`)
        const { error } = await db.storage
          .from('avatars')
          .upload(ruta, JPEG, { ...opcionesJpeg, upsert: true })
        if (error) throw new Error(`plantar ${ruta}: ${error.message}`)
      }
    }
    for (const nombre of [
      'lectura',
      'reemplazo',
      ...PERFILES.map((p) => `borrado-${p}`),
    ]) {
      const ruta = registrar('branding', `e2e-perm-${nombre}.png`)
      const { error } = await db.storage
        .from('branding')
        .upload(ruta, PNG, { ...opcionesPng, upsert: true })
      if (error) throw new Error(`plantar ${ruta}: ${error.message}`)
    }
    // Una foto ajena para borrar por cada perfil (los administradores la borran de verdad).
    for (const perfil of PERFILES) {
      const ruta = registrar(
        'avatars',
        `${c.ids.empleado2}/e2e-perm-borrado-${perfil}.jpg`,
      )
      const { error } = await db.storage
        .from('avatars')
        .upload(ruta, JPEG, { ...opcionesJpeg, upsert: true })
      if (error) throw new Error(`plantar ${ruta}: ${error.message}`)
    }
  })

  afterAll(async () => {
    const db = servicio()
    for (const bucket of ['avatars', 'branding'] as const) {
      const rutas = subidos
        .filter((s) => s.bucket === bucket)
        .map((s) => s.ruta)
      if (rutas.length > 0) await db.storage.from(bucket).remove(rutas)
    }
  })

  describe('avatars', () => {
    for (const perfil of PERFILES) {
      const etiqueta = `[${ETIQUETA[perfil]}]`

      caso(
        claveCaso('storage', 'avatars', 'leer', perfil),
        `${etiqueta} avatars: lee una foto ajena por URL pública (RB-E01, P-037)`,
        async () => {
          const url = `${requireE2eEnv().supabaseUrl}/storage/v1/object/public/avatars/${ajena()}/e2e-perm-lectura.jpg`
          const respuesta = await fetch(url, {
            headers:
              perfil === 'anon'
                ? {}
                : { Authorization: `Bearer ${contexto().tokens[perfil]}` },
          })
          expect(respuesta.status).toBe(200)
        },
      )

      caso(
        claveCaso('storage', 'avatars', 'subir propia', perfil),
        `${etiqueta} avatars: sube a su carpeta -> ${perfil === 'anon' ? 'rechazado' : 'permitido'} (P-037, RB-X02)`,
        async () => {
          const ruta = registrar(
            'avatars',
            `${propia(perfil)}/e2e-perm-nueva-${perfil}.jpg`,
          )
          const { error } = await clienteDe(perfil)
            .storage.from('avatars')
            .upload(ruta, JPEG, { ...opcionesJpeg, upsert: true })
          if (perfil === 'anon')
            expect(error?.message).toMatch(/row-level security/i)
          else expect(error, error?.message).toBeNull()
        },
      )

      caso(
        claveCaso('storage', 'avatars', 'subir ajena', perfil),
        `${etiqueta} avatars: sube a la carpeta de otra persona -> ${esAdmin(perfil) ? 'permitido' : 'rechazado'} (RB-X02)`,
        async () => {
          const ruta = registrar(
            'avatars',
            `${ajena()}/e2e-perm-intruso-${perfil}.jpg`,
          )
          const { error } = await clienteDe(perfil)
            .storage.from('avatars')
            .upload(ruta, JPEG, opcionesJpeg)
          if (esAdmin(perfil)) expect(error, error?.message).toBeNull()
          else
            expect(error?.message, 'se pudo subir a una carpeta ajena').toMatch(
              /row-level security/i,
            )
        },
      )

      caso(
        claveCaso('storage', 'avatars', 'reemplazar propia', perfil),
        `${etiqueta} avatars: reemplaza una foto de su carpeta -> ${perfil === 'anon' ? 'rechazado' : 'permitido'} (P-037)`,
        async () => {
          if (perfil === 'anon') {
            const { error } = await clienteDe('anon')
              .storage.from('avatars')
              .upload(`${ajena()}/e2e-perm-reemplazo.jpg`, JPEG, {
                ...opcionesJpeg,
                upsert: true,
              })
            expect(error?.message).toMatch(/row-level security/i)
            return
          }
          const { error } = await clienteDe(perfil)
            .storage.from('avatars')
            .upload(`${propia(perfil)}/e2e-perm-reemplazo.jpg`, JPEG, {
              ...opcionesJpeg,
              upsert: true,
            })
          expect(error, error?.message).toBeNull()
        },
      )

      caso(
        claveCaso('storage', 'avatars', 'reemplazar ajena', perfil),
        `${etiqueta} avatars: reemplaza una foto ajena -> ${esAdmin(perfil) ? 'permitido' : 'rechazado'} (RB-X02)`,
        async () => {
          const { error } = await clienteDe(perfil)
            .storage.from('avatars')
            .upload(`${ajena()}/e2e-perm-reemplazo.jpg`, JPEG, {
              ...opcionesJpeg,
              upsert: true,
            })
          if (esAdmin(perfil)) expect(error, error?.message).toBeNull()
          else
            expect(error?.message, 'se pudo reemplazar una foto ajena').toMatch(
              /row-level security/i,
            )
        },
      )

      caso(
        claveCaso('storage', 'avatars', 'borrar propia', perfil),
        `${etiqueta} avatars: borra una foto de su carpeta -> ${perfil === 'anon' ? 'rechazado' : 'permitido'} (P-037)`,
        async () => {
          if (perfil === 'anon') {
            const { data } = await clienteDe('anon')
              .storage.from('avatars')
              .remove([`${ajena()}/e2e-perm-borrado.jpg`])
            expect(data ?? []).toHaveLength(0)
            return
          }
          const ruta = `${propia(perfil)}/e2e-perm-borrado.jpg`
          const { data, error } = await clienteDe(perfil)
            .storage.from('avatars')
            .remove([ruta])
          expect(error, error?.message).toBeNull()
          expect(data).toHaveLength(1)
        },
      )

      caso(
        claveCaso('storage', 'avatars', 'borrar ajena', perfil),
        `${etiqueta} avatars: borra una foto ajena -> ${esAdmin(perfil) ? 'permitido' : 'rechazado'} (RB-X02)`,
        async () => {
          const nombre = `e2e-perm-borrado-${perfil}.jpg`
          const ruta = `${ajena()}/${nombre}`
          const { data, error } = await clienteDe(perfil)
            .storage.from('avatars')
            .remove([ruta])
          if (esAdmin(perfil)) {
            expect(error, error?.message).toBeNull()
            expect(data).toHaveLength(1)
          } else {
            // Sin permiso, el borrado no alcanza ninguna fila y el objeto sigue ahí.
            expect(data ?? []).toHaveLength(0)
            const { data: existe } = await servicio()
              .storage.from('avatars')
              .list(ajena(), { search: nombre })
            expect((existe ?? []).length).toBeGreaterThan(0)
          }
        },
      )

      caso(
        claveCaso('storage', 'avatars', 'listar', perfil),
        `${etiqueta} avatars: ${esAdmin(perfil) ? 'lista las carpetas' : 'no puede listar las carpetas de otras personas'} (RB-X02, P-037)`,
        async () => {
          const { data, error } = await clienteDe(perfil)
            .storage.from('avatars')
            .list('', { limit: 100 })
          // La URL de una foto es pública por diseño, pero NO adivinable: listar las carpetas
          // entregaría el id de cada persona con foto (04 §7.3: "URL no adivinable").
          expect(error, error?.message).toBeNull()
          // El administrador y el dueño sí pueden ver a todas las personas (03 §6).
          if (esAdmin(perfil)) return
          const carpetasAjenas = (data ?? [])
            .map((d) => d.name)
            .filter((n) => n !== propia(perfil))
          expect(
            carpetasAjenas,
            'lista las carpetas (ids) de otras personas',
          ).toEqual([])
        },
      )
    }

    describe('límites de tamaño y tipo (avatars: 2 MB, solo JPEG)', () => {
      it('una foto de más de 2 MB se rechaza (RB-X02, P-037)', async () => {
        const ruta = `${propia('empleado')}/e2e-perm-grande.jpg`
        const { error } = await clienteDe('empleado')
          .storage.from('avatars')
          .upload(ruta, new Uint8Array(2 * 1024 * 1024 + 10), opcionesJpeg)
        expect(error?.message).toMatch(/exceeded|too large|maximum/i)
      })
      it('un PNG se rechaza: solo JPEG (RB-X02, P-037)', async () => {
        const ruta = `${propia('empleado')}/e2e-perm-png.png`
        const { error } = await clienteDe('empleado')
          .storage.from('avatars')
          .upload(ruta, PNG, opcionesPng)
        expect(error?.message).toMatch(/mime type/i)
      })
      it('un HTML disfrazado de JPEG por el nombre pero declarado como text/html se rechaza (sin ejecución de contenido) (RB-X02)', async () => {
        const ruta = `${propia('empleado')}/e2e-perm-pagina.jpg`
        const { error } = await clienteDe('empleado')
          .storage.from('avatars')
          .upload(ruta, new TextEncoder().encode('<script>alert(1)</script>'), {
            contentType: 'text/html',
          })
        expect(error?.message).toMatch(/mime type/i)
      })
    })
  })

  describe('branding', () => {
    for (const perfil of PERFILES) {
      const etiqueta = `[${ETIQUETA[perfil]}]`
      const puede = esAdmin(perfil)

      caso(
        claveCaso('storage', 'branding', 'leer', perfil),
        `${etiqueta} branding: lee el logo por URL pública (RB-A01, P-117)`,
        async () => {
          const url = `${requireE2eEnv().supabaseUrl}/storage/v1/object/public/branding/e2e-perm-lectura.png`
          const respuesta = await fetch(url, {
            headers:
              perfil === 'anon'
                ? {}
                : { Authorization: `Bearer ${contexto().tokens[perfil]}` },
          })
          expect(respuesta.status).toBe(200)
        },
      )

      caso(
        claveCaso('storage', 'branding', 'subir', perfil),
        `${etiqueta} branding: sube un logo -> ${puede ? 'permitido' : 'rechazado'} (P-117, RB-X02)`,
        async () => {
          const ruta = registrar('branding', `e2e-perm-logo-${perfil}.png`)
          const { error } = await clienteDe(perfil)
            .storage.from('branding')
            .upload(ruta, PNG, { ...opcionesPng, upsert: true })
          if (puede) expect(error, error?.message).toBeNull()
          else
            expect(error?.message, 'se pudo subir un logo').toMatch(
              /row-level security/i,
            )
        },
      )

      caso(
        claveCaso('storage', 'branding', 'reemplazar', perfil),
        `${etiqueta} branding: reemplaza el logo -> ${puede ? 'permitido' : 'rechazado'} (P-117, RB-X02)`,
        async () => {
          const { error } = await clienteDe(perfil)
            .storage.from('branding')
            .upload('e2e-perm-reemplazo.png', PNG, {
              ...opcionesPng,
              upsert: true,
            })
          if (puede) expect(error, error?.message).toBeNull()
          else
            expect(error?.message, 'se pudo reemplazar el logo').toMatch(
              /row-level security/i,
            )
        },
      )

      caso(
        claveCaso('storage', 'branding', 'borrar', perfil),
        `${etiqueta} branding: borra el logo -> ${puede ? 'permitido' : 'rechazado'} (P-117, RB-X02)`,
        async () => {
          const nombre = `e2e-perm-borrado-${perfil}.png`
          const { data, error } = await clienteDe(perfil)
            .storage.from('branding')
            .remove([nombre])
          if (puede) {
            expect(error, error?.message).toBeNull()
            expect(data).toHaveLength(1)
          } else {
            expect(data ?? []).toHaveLength(0)
            const { data: existe } = await servicio()
              .storage.from('branding')
              .list('', { search: nombre })
            expect((existe ?? []).length).toBeGreaterThan(0)
          }
        },
      )
    }

    describe('límites de tamaño y tipo (branding: 1 MB; PNG, JPEG y WebP)', () => {
      it('un SVG se rechaza: puede llevar scripts y se abre en el origen de Storage (SEG-02, RB-X02)', async () => {
        const { error } = await clienteDe('admin')
          .storage.from('branding')
          .upload(
            'e2e-perm-logo.svg',
            new TextEncoder().encode(
              '<svg xmlns="http://www.w3.org/2000/svg"/>',
            ),
            { contentType: 'image/svg+xml' },
          )
        expect(error?.message).toMatch(/mime type/i)
      })
      it('un logo de más de 1 MB se rechaza (RB-X02, P-117)', async () => {
        const { error } = await clienteDe('admin')
          .storage.from('branding')
          .upload(
            'e2e-perm-grande.png',
            new Uint8Array(1024 * 1024 + 10),
            opcionesPng,
          )
        expect(error?.message).toMatch(/exceeded|too large|maximum/i)
      })
      it('un HTML o un ejecutable se rechazan: tipo no permitido (RB-X02)', async () => {
        for (const tipo of [
          'text/html',
          'application/javascript',
          'application/x-msdownload',
        ]) {
          const { error } = await clienteDe('admin')
            .storage.from('branding')
            .upload('e2e-perm-malo.bin', new Uint8Array([1, 2, 3]), {
              contentType: tipo,
            })
          expect(error?.message, tipo).toMatch(/mime type/i)
        }
      })
    })
  })
})
