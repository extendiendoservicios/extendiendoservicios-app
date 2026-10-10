import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** `ClientPhotoUpload` (AJ2-06): quitar la foto usa `clients.photo_path` y `client-photos`. */

const { updateMock, eqMock, removeMock, fromMock, storageFromMock } =
  vi.hoisted(() => ({
    updateMock: vi.fn(),
    eqMock: vi.fn(),
    removeMock: vi.fn(),
    fromMock: vi.fn(),
    storageFromMock: vi.fn(),
  }))

vi.mock('@/lib/supabase', () => ({
  supabase: { from: fromMock, storage: { from: storageFromMock } },
}))

const { ClientPhotoUpload } = await import('./ClientPhotoUpload')

beforeEach(() => {
  eqMock.mockReset().mockResolvedValue({ error: null })
  updateMock.mockReset().mockReturnValue({ eq: eqMock })
  fromMock.mockReset().mockReturnValue({ update: updateMock })
  removeMock.mockReset().mockResolvedValue({ error: null })
  storageFromMock.mockReset().mockReturnValue({
    remove: removeMock,
    getPublicUrl: (path: string) => ({
      data: { publicUrl: `https://x.test/${path}` },
    }),
  })
})

describe('ClientPhotoUpload', () => {
  it('sin foto ofrece "Subir foto" y el botón de cámara del cliente', () => {
    render(
      <ClientPhotoUpload clientId="cli-1" name="Limpiolux" photoPath={null} />,
    )

    expect(
      screen.getByRole('button', { name: 'Subir foto' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Cambiar foto del cliente' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Quitar foto' }),
    ).not.toBeInTheDocument()
  })

  it('"Quitar foto" limpia clients.photo_path, borra el archivo y avisa con null', async () => {
    const onChange = vi.fn()
    render(
      <ClientPhotoUpload
        clientId="cli-1"
        name="Limpiolux"
        photoPath="cli-1/foto.jpg"
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Quitar foto' }))

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(null))
    expect(fromMock).toHaveBeenCalledWith('clients')
    expect(updateMock).toHaveBeenCalledWith({ photo_path: null })
    expect(eqMock).toHaveBeenCalledWith('id', 'cli-1')
    expect(storageFromMock).toHaveBeenCalledWith('client-photos')
    expect(removeMock).toHaveBeenCalledWith(['cli-1/foto.jpg'])
  })
})
