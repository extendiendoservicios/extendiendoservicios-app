// tests/permissions/suite/96-client-photos.permissions.ts — P25.5c
//
// Bucket `client-photos` (0039, AJ2-06): foto del cliente. Lo agregó P19.6c y la matriz no lo
// cubría: el inventario no lo veía porque su lector de migraciones no aceptaba guiones en el nombre
// del bucket (se corrigió al sumar `supply-images`). Lo que dice 0039:
//   - público (la URL pública abre sin sesión), 2 MB, solo JPEG;
//   - escriben (subir, reemplazar, borrar) los administradores y el dueño;
//   - `select` por la API (listar, firmar) para administración, y para el coordinador solo en la
//     carpeta de los clientes que supervisa.
// Todo lo que sube la suite lleva el prefijo `e2e-perm-` y se borra al final.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clienteDe, servicio } from './contexto.ts'
import { ES_ADMIN, ETIQUETA, PERFILES, type Perfil } from './perfiles.ts'
import { requireE2eEnv } from '../../fixtures/env.ts'

const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01,
  0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Carpeta de un cliente que no existe: alcanza para probar las políticas, que miran la carpeta. */
const CARPETA = '00000000-0000-4000-8000-0000000000c1'
const esAdmin = (perfil: Perfil) => ES_ADMIN.includes(perfil)

describe('Storage: client-photos', () => {
  const subidas: string[] = []
  const ruta = (nombre: string) => `${CARPETA}/e2e-perm-${nombre}.jpg`

  beforeAll(async () => {
    for (const nombre of ['lectura', 'reemplazo']) {
      const { error } = await servicio()
        .storage.from('client-photos')
        .upload(ruta(nombre), JPEG, { contentType: 'image/jpeg', upsert: true })
      if (error) throw new Error(`plantar ${nombre}: ${error.message}`)
      subidas.push(ruta(nombre))
    }
  })

  afterAll(async () => {
    await servicio().storage.from('client-photos').remove(subidas)
  })

  it('es público, de 2 MB y solo JPEG', async () => {
    const { data, error } = await servicio().storage.getBucket('client-photos')
    expect(error, error?.message).toBeNull()
    expect(data?.public).toBe(true)
    expect(data?.file_size_limit).toBe(2_097_152)
    expect(data?.allowed_mime_types).toEqual(['image/jpeg'])
  })

  it('la URL pública abre sin sesión (AJ2-06)', async () => {
    const url = `${requireE2eEnv().supabaseUrl}/storage/v1/object/public/client-photos/${ruta('lectura')}`
    expect((await fetch(url)).status).toBe(200)
  })

  for (const perfil of PERFILES) {
    const puede = esAdmin(perfil)
    const etiqueta = `[${ETIQUETA[perfil]}]`

    it(`${etiqueta} sube una foto de cliente -> ${puede ? 'permitido' : 'rechazado'} (RB-X02, AJ2-06)`, async () => {
      const destino = ruta(`subida-${perfil}`)
      const { error } = await clienteDe(perfil)
        .storage.from('client-photos')
        .upload(destino, JPEG, { contentType: 'image/jpeg', upsert: false })
      if (puede) {
        expect(error, error?.message).toBeNull()
        subidas.push(destino)
      } else {
        expect(error, 'subió sin ser administrador').not.toBeNull()
      }
    })

    it(`${etiqueta} reemplaza una foto -> ${puede ? 'permitido' : 'rechazado'} (RB-X02)`, async () => {
      const { error } = await clienteDe(perfil)
        .storage.from('client-photos')
        .upload(ruta('reemplazo'), JPEG, {
          contentType: 'image/jpeg',
          upsert: true,
        })
      if (puede) expect(error, error?.message).toBeNull()
      else expect(error, 'reemplazó sin ser administrador').not.toBeNull()
    })

    it(`${etiqueta} borra una foto -> ${puede ? 'permitido' : 'rechazado'} (RB-X02)`, async () => {
      const destino = ruta(`borrar-${perfil}`)
      const db = servicio()
      const sube = await db.storage
        .from('client-photos')
        .upload(destino, JPEG, { contentType: 'image/jpeg', upsert: true })
      expect(sube.error, sube.error?.message).toBeNull()
      subidas.push(destino)
      await clienteDe(perfil).storage.from('client-photos').remove([destino])
      const sigue = await db.storage
        .from('client-photos')
        .list(CARPETA, { search: `e2e-perm-borrar-${perfil}.jpg` })
      expect(sigue.data ?? []).toHaveLength(puede ? 0 : 1)
    })

    it(`${etiqueta} firma una URL de la foto por la API -> ${puede ? 'permitido' : 'rechazado'} (la carpeta no es de un cliente que supervise)`, async () => {
      const { error } = await clienteDe(perfil)
        .storage.from('client-photos')
        .createSignedUrl(ruta('lectura'), 60)
      if (puede) expect(error, error?.message).toBeNull()
      else expect(error, 'firmó sin permiso').not.toBeNull()
    })
  }

  it('[dueño] no sube un PNG ni más de 2 MB, aunque tenga permiso', async () => {
    const owner = clienteDe('owner')
    const png = await owner.storage
      .from('client-photos')
      .upload(ruta('png'), PNG, { contentType: 'image/png' })
    expect(png.error, 'aceptó un PNG').not.toBeNull()
    const grande = new Uint8Array(2_200_000)
    grande.set(JPEG)
    const g = await owner.storage
      .from('client-photos')
      .upload(ruta('grande'), grande, { contentType: 'image/jpeg' })
    expect(g.error, 'aceptó más de 2 MB').not.toBeNull()
  })
})
