import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PrintSheet } from './PrintSheet'

function renderSheet(text = 'Texto original', onClose = vi.fn()) {
  const view = render(
    <PrintSheet documentTitle="Informe" onClose={onClose}>
      <p>{text}</p>
    </PrintSheet>,
  )
  return { ...view, onClose }
}

describe('PrintSheet: editar texto (AJ3-03)', () => {
  it('el conmutador activa y desactiva la edición con aria-pressed y el aviso', () => {
    renderSheet()
    const toggle = screen.getByRole('button', { name: 'Editar texto' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('print-content')).not.toHaveAttribute(
      'contenteditable',
    )
    expect(screen.queryByText(/no se guardan en la app/)).toBeNull()

    fireEvent.click(toggle)
    const active = screen.getByRole('button', { name: 'Terminar edición' })
    expect(active).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('print-content')).toHaveAttribute(
      'contenteditable',
      'true',
    )
    expect(
      screen.getByText(
        'Los cambios valen solo para esta impresión: no se guardan en la app.',
      ),
    ).toBeInTheDocument()

    fireEvent.click(active)
    expect(screen.getByTestId('print-content')).not.toHaveAttribute(
      'contenteditable',
    )
  })

  it('no pisa lo editado cuando llegan datos nuevos y «Deshacer cambios» vuelve al original', () => {
    const { rerender } = renderSheet('Original')
    fireEvent.click(screen.getByRole('button', { name: 'Editar texto' }))
    screen.getByText('Original').textContent = 'Corregido a mano'

    rerender(
      <PrintSheet documentTitle="Informe" onClose={vi.fn()}>
        <p>Dato refrescado</p>
      </PrintSheet>,
    )
    expect(screen.getByText('Corregido a mano')).toBeInTheDocument()
    expect(screen.queryByText('Dato refrescado')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Deshacer cambios' }))
    expect(screen.queryByText('Corregido a mano')).toBeNull()
    expect(screen.getByText('Dato refrescado')).toBeInTheDocument()
  })

  it('Escape no cierra la vista previa mientras se edita', () => {
    const { onClose } = renderSheet()
    fireEvent.click(screen.getByRole('button', { name: 'Editar texto' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Terminar edición' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('PrintSheet: hoja A4 de ancho fijo', () => {
  it('la hoja mide siempre 210 mm, sin achicarse con la ventana ni crecer con el contenido', () => {
    renderSheet()
    const sheet = screen.getByTestId('print-content').parentElement
    expect(sheet).toHaveClass('w-[210mm]', 'shrink-0', 'p-[15mm]')
    expect(sheet?.className).not.toMatch(/\bw-full\b|max-w-/)
  })
})
