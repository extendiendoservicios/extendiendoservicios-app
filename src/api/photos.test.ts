import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isApiError } from './errors'

/**
 * `src/api/photos.ts` (AJ2-06, AJ2-07): subida y baja de fotos de personas
 * (`avatars`/`profiles.avatar_path`) y de clientes
 * (`client-photos`/`clients.photo_path`), sin red (se mockea `@/lib/supabase`).
 */

const {
  uploadMock,
  removeMock,
  updateMock,
  eqMock,
  fromMock,
  storageFromMock,
} = vi.hoisted(() => ({
  uploadMock: vi.fn(),
  removeMock: vi.fn(),
  updateMock: vi.fn(),
  eqMock: vi.fn(),
  fromMock: vi.fn(),
  storageFromMock: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { from: fromMock, storage: { from: storageFromMock } },
}))

const { savePhoto, removePhoto, clientPhotoUrl, photoPublicUrl } =
  await import('./photos')

const blob = new Blob(['x'], { type: 'image/jpeg' })

beforeEach(() => {
  uploadMock.mockReset().mockResolvedValue({ error: null })
  removeMock.mockReset().mockResolvedValue({ error: null })
  eqMock.mockReset().mockResolvedValue({ error: null })
  updateMock.mockReset().mockReturnValue({ eq: eqMock })
  fromMock.mockReset().mockReturnValue({ update: updateMock })
  storageFromMock.mockReset().mockReturnValue({
    upload: uploadMock,
    remove: removeMock,
    getPublicUrl: (path: string) => ({
      data: { publicUrl: `https://x.test/public/${path}` },
    }),
  })
})

describe('savePhoto', () => {
  it('foto de cliente: sube a client-photos, guarda photo_path y borra la anterior', async () => {
    const path = await savePhoto('client', 'cli-1', blob, 'cli-1/vieja.jpg')

    expect(storageFromMock).toHaveBeenCalledWith('client-photos')
    expect(path).toMatch(/^cli-1\/[0-9a-f-]{36}\.jpg$/)
    expect(uploadMock).toHaveBeenCalledWith(path, blob, {
      contentType: 'image/jpeg',
      upsert: false,
    })
    expect(fromMock).toHaveBeenCalledWith('clients')
    expect(updateMock).toHaveBeenCalledWith({ photo_path: path })
    expect(eqMock).toHaveBeenCalledWith('id', 'cli-1')
    expect(removeMock).toHaveBeenCalledWith(['cli-1/vieja.jpg'])
  })

  it('foto de persona: usa avatars y profiles.avatar_path, sin borrar si no había anterior', async () => {
    const path = await savePhoto('profile', 'per-1', blob)

    expect(storageFromMock).toHaveBeenCalledWith('avatars')
    expect(fromMock).toHaveBeenCalledWith('profiles')
    expect(updateMock).toHaveBeenCalledWith({ avatar_path: path })
    expect(removeMock).not.toHaveBeenCalled()
  })

  it('si falla la subida, lanza un error tipado y no toca la tabla', async () => {
    uploadMock.mockResolvedValue({ error: { message: 'boom' } })

    const error = await savePhoto('client', 'cli-1', blob).catch(
      (e: unknown) => e,
    )

    expect(isApiError(error)).toBe(true)
    expect((error as { hint: string }).hint).toBe('PHOTO_UPLOAD_FAILED')
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('si falla guardar la ruta, borra el archivo recién subido', async () => {
    eqMock.mockResolvedValue({ error: { message: 'rls' } })

    const error = await savePhoto(
      'client',
      'cli-1',
      blob,
      'cli-1/vieja.jpg',
    ).catch((e: unknown) => e)

    expect((error as { hint: string }).hint).toBe('PHOTO_SAVE_FAILED')
    expect((error as Error).message).toBe(
      'No pudimos guardar la foto en el cliente. Probá de nuevo.',
    )
    const uploadedPath = uploadMock.mock.calls[0]![0] as string
    expect(removeMock).toHaveBeenCalledTimes(1)
    expect(removeMock).toHaveBeenCalledWith([uploadedPath])
  })
})

describe('removePhoto', () => {
  it('pone la ruta en null y borra el archivo', async () => {
    await removePhoto('client', 'cli-1', 'cli-1/foto.jpg')

    expect(updateMock).toHaveBeenCalledWith({ photo_path: null })
    expect(removeMock).toHaveBeenCalledWith(['cli-1/foto.jpg'])
  })

  it('si falla la tabla, lanza y no borra el archivo', async () => {
    eqMock.mockResolvedValue({ error: { message: 'rls' } })

    await expect(
      removePhoto('client', 'cli-1', 'cli-1/foto.jpg'),
    ).rejects.toThrow('No pudimos quitar la foto. Probá de nuevo.')
    expect(removeMock).not.toHaveBeenCalled()
  })
})

describe('URLs públicas', () => {
  it('arman la URL del bucket que corresponde', () => {
    expect(clientPhotoUrl('cli-1/a.jpg')).toBe(
      'https://x.test/public/cli-1/a.jpg',
    )
    expect(photoPublicUrl('profile', 'p/a.jpg')).toBe(
      'https://x.test/public/p/a.jpg',
    )
    expect(storageFromMock).toHaveBeenCalledWith('client-photos')
    expect(storageFromMock).toHaveBeenCalledWith('avatars')
  })
})
