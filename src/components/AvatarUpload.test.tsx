import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AvatarUpload } from './AvatarUpload'

/**
 * `AvatarUpload` (EMP-011): qué botones se ven según haya o no foto,
 * validación del archivo elegido (mensaje en español, sin abrir el
 * recorte) y la acción de quitar la foto (Storage + `profiles` + aviso a
 * quien lo usa). El recorte y la subida en sí (con el diálogo abierto) se
 * prueban en `lib/avatarImage.test.ts`, sin necesidad de simular un
 * `<canvas>` completo acá.
 */

interface ProfilesUpdateResult {
  data: null
  error: { message: string } | null
}
interface StorageRemoveResult {
  data: unknown
  error: null
}
interface PublicUrlResult {
  data: { publicUrl: string }
}

const { profilesUpdateMock, storageRemoveMock, getPublicUrlMock } = vi.hoisted(
  () => ({
    profilesUpdateMock:
      vi.fn<
        (
          values: { avatar_path: string | null },
          column: string,
          value: unknown,
        ) => Promise<ProfilesUpdateResult>
      >(),
    storageRemoveMock:
      vi.fn<(paths: string[]) => Promise<StorageRemoveResult>>(),
    getPublicUrlMock: vi.fn<(path: string) => PublicUrlResult>(),
  }),
)

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'profiles') {
        throw new Error(`tabla no mockeada en el test: ${table}`)
      }
      return {
        update: (values: { avatar_path: string | null }) => ({
          eq: (column: string, value: unknown) =>
            profilesUpdateMock(values, column, value),
        }),
      }
    },
    storage: {
      from: (bucket: string) => {
        if (bucket !== 'avatars') {
          throw new Error(`bucket no mockeado en el test: ${bucket}`)
        }
        return {
          remove: (paths: string[]) => storageRemoveMock(paths),
          getPublicUrl: (path: string) => getPublicUrlMock(path),
        }
      },
    },
  },
}))

afterEach(() => {
  vi.restoreAllMocks()
  profilesUpdateMock.mockReset().mockResolvedValue({ data: null, error: null })
  storageRemoveMock.mockReset().mockResolvedValue({ data: null, error: null })
  getPublicUrlMock.mockReset().mockImplementation((path: string) => ({
    data: {
      publicUrl: `https://ejemplo.supabase.co/storage/v1/object/public/avatars/${path}`,
    },
  }))
})

describe('AvatarUpload — sin foto', () => {
  it('ofrece "Subir foto", sin la opción de quitarla', () => {
    render(
      <AvatarUpload
        profileId="perfil-1"
        name="Sofía Ibarra"
        avatarPath={null}
      />,
    )

    expect(
      screen.getByRole('button', { name: 'Subir foto' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Quitar foto' }),
    ).not.toBeInTheDocument()
  })

  it('con un archivo de un tipo no admitido, avisa en español y no ofrece "Quitar foto"', async () => {
    render(
      <AvatarUpload
        profileId="perfil-1"
        name="Sofía Ibarra"
        avatarPath={null}
      />,
    )

    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement
    const archivo = new File(['contenido'], 'documento.pdf', {
      type: 'application/pdf',
    })
    fireEvent.change(input, { target: { files: [archivo] } })

    expect(
      await screen.findByText(
        'La foto tiene que ser un archivo JPG, PNG o WEBP.',
      ),
    ).toBeInTheDocument()
    // El diálogo de recorte no se abre con un archivo inválido.
    expect(
      screen.queryByRole('dialog', { name: 'Ajustar la foto' }),
    ).not.toBeInTheDocument()
  })
})

describe('AvatarUpload — con foto', () => {
  it('ofrece "Cambiar foto" y "Quitar foto"', () => {
    render(
      <AvatarUpload
        profileId="perfil-1"
        name="Sofía Ibarra"
        avatarPath="perfil-1/foto.jpg"
      />,
    )

    expect(
      screen.getByRole('button', { name: 'Cambiar foto' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Quitar foto' }),
    ).toBeInTheDocument()
  })

  it('"Quitar foto" borra la ruta en profiles, el objeto en Storage y avisa con onChange(null)', async () => {
    const onChange = vi.fn()
    render(
      <AvatarUpload
        profileId="perfil-1"
        name="Sofía Ibarra"
        avatarPath="perfil-1/foto.jpg"
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Quitar foto' }))

    await waitFor(() =>
      expect(profilesUpdateMock).toHaveBeenCalledWith(
        { avatar_path: null },
        'id',
        'perfil-1',
      ),
    )
    expect(storageRemoveMock).toHaveBeenCalledWith(['perfil-1/foto.jpg'])
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('si falla el guardado, muestra un error y no llama a onChange', async () => {
    profilesUpdateMock.mockResolvedValue({
      data: null,
      error: { message: 'error de prueba' },
    })
    const onChange = vi.fn()
    render(
      <AvatarUpload
        profileId="perfil-1"
        name="Sofía Ibarra"
        avatarPath="perfil-1/foto.jpg"
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Quitar foto' }))

    expect(
      await screen.findByText('No pudimos quitar la foto. Probá de nuevo.'),
    ).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })
})
