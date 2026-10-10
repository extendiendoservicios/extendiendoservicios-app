import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PendingPhotoPicker } from './PendingPhotoPicker'

/**
 * `PendingPhotoPicker` (AJ2-07): foto elegida en un formulario de alta, en
 * memoria. El recorte en sí se prueba en `lib/avatarImage.test.ts`.
 */

describe('PendingPhotoPicker', () => {
  it('sin foto ofrece "Subir foto" y no "Quitar foto"', () => {
    render(
      <PendingPhotoPicker name="Ana Gómez" value={null} onChange={vi.fn()} />,
    )

    expect(
      screen.getByRole('button', { name: 'Subir foto' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Quitar foto' }),
    ).not.toBeInTheDocument()
  })

  it('con foto en memoria ofrece "Cambiar foto" y "Quitar foto" (avisa con null)', () => {
    const onChange = vi.fn()
    render(
      <PendingPhotoPicker
        name="Ana Gómez"
        value={new Blob(['x'], { type: 'image/jpeg' })}
        onChange={onChange}
      />,
    )

    expect(
      screen.getByRole('button', { name: 'Cambiar foto' }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Quitar foto' }))
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('con un archivo no admitido avisa en español y no abre el recorte', async () => {
    const onChange = vi.fn()
    render(<PendingPhotoPicker name="" value={null} onChange={onChange} />)

    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement
    fireEvent.change(input, {
      target: {
        files: [new File(['c'], 'doc.pdf', { type: 'application/pdf' })],
      },
    })

    expect(
      await screen.findByText(
        'La foto tiene que ser un archivo JPG, PNG o WEBP.',
      ),
    ).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
