import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PrintSheet, computePageLayout, computeSheetFit } from './PrintSheet'
import { PrintSignatures } from './PrintTable'

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
    const sheet = screen.getByTestId('print-sheet')
    expect(sheet).toHaveClass('w-[210mm]', 'shrink-0', 'p-[15mm]')
    expect(sheet?.className).not.toMatch(/\bw-full\b|max-w-/)
  })
})

describe('PrintSheet: vista previa en pantallas angostas', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('computeSheetFit achica la hoja para que entre y nunca la agranda', () => {
    expect(computeSheetFit(390, 794, 1123)).toEqual({
      scale: (390 - 16) / 794,
      width: 794 * ((390 - 16) / 794),
      height: 1123 * ((390 - 16) / 794),
    })
    expect(computeSheetFit(1280, 794, 1123).scale).toBe(1)
    expect(computeSheetFit(0, 0, 0).scale).toBe(1)
  })

  it('escala la hoja con transform cuando el ancho disponible es menor, y «Editar texto» sigue andando', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(390)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(794)
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(1000)
    renderSheet()
    const scale = (390 - 16) / 794
    const sheet = screen.getByTestId('print-sheet')
    expect(sheet.style.transform).toBe(`scale(${scale})`)
    const frame = screen.getByTestId('print-frame')
    expect(frame.style.width).toBe(`${794 * scale}px`)
    expect(frame.style.height).toBe(`${1000 * scale}px`)

    fireEvent.click(screen.getByRole('button', { name: 'Editar texto' }))
    expect(screen.getByTestId('print-content')).toHaveAttribute(
      'contenteditable',
      'true',
    )
    expect(
      screen.getByRole('button', { name: 'Imprimir o guardar como PDF' }),
    ).toBeInTheDocument()
  })

  it('no escala cuando la hoja entra', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1280)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(794)
    renderSheet()
    expect(screen.getByTestId('print-sheet').style.transform).toBe('')
  })
})

describe('PrintSheet: páginas A4 completas', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('una hoja corta mide una página A4 de 297 mm, ', () => {
    renderSheet()
    const sheet = screen.getByTestId('print-sheet')
    expect(sheet.style.minHeight).toBe('297mm')
  })

  it('un contenido largo ocupa tantas páginas completas como haga falta', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(2000)
    renderSheet()
    // 2000 px + 2 × 15 mm de margen = 2113 px > 1 página (1123 px) → 2 páginas.
    expect(screen.getByTestId('print-sheet').style.minHeight).toBe('594mm')
  })

  it('computePageLayout: múltiplo de 297 mm y firmas empujadas a la página siguiente si no entran', () => {
    const mm = 96 / 25.4
    expect(
      computePageLayout({
        contentHeight: 100,
        signaturesTop: null,
        signaturesHeight: 0,
      }),
    ).toEqual({ pages: 1, push: 0 })
    // Las firmas empiezan a 200 mm y miden 80 mm: pasan de los 267 mm útiles.
    const layout = computePageLayout({
      contentHeight: 280 * mm,
      signaturesTop: 200 * mm,
      signaturesHeight: 80 * mm,
    })
    expect(layout.push).toBeCloseTo(97 * mm)
    expect(layout.pages).toBe(2)
    // Si entran, no se mueven.
    expect(
      computePageLayout({
        contentHeight: 200 * mm,
        signaturesTop: 150 * mm,
        signaturesHeight: 50 * mm,
      }).push,
    ).toBe(0)
  })

  it('el bloque de firmas no se corta entre páginas', () => {
    render(<PrintSignatures signers={['A', 'B']} />)
    const block = document.querySelector('[data-print-signatures]')
    expect(block).toHaveClass('print-keep-together')
  })
})
