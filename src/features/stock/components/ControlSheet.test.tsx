import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { testItem } from '@/features/stock/testSupport'
import { CONTROL_SHEET_COLUMNS, ControlSheet } from './ControlSheet'

vi.mock('@/features/settings/queries', () => ({
  useCompanySettingsQuery: () => ({
    data: {
      name: 'Extendiendo Servicios',
      logoPath: null,
      supportPhone: null,
    },
  }),
}))

const ISSUED_AT = new Date('2026-10-26T17:30:00Z')

const ITEMS = [
  testItem({
    id: 'a',
    code: 'QUI-001',
    name: 'Lavandina',
    presentation: '1 L',
    stockQty: 12,
  }),
  testItem({
    id: 'b',
    code: 'DES-010',
    name: 'Bolsa de residuos',
    presentation: 'x 10',
    categoryId: 'c2',
    categoryName: 'Descartables',
    categorySortOrder: 1,
    stockQty: 1250,
  }),
]

function renderSheet(
  props: Partial<React.ComponentProps<typeof ControlSheet>> = {},
) {
  return render(
    <ControlSheet
      items={ITEMS}
      categoryName={null}
      issuedAt={ISSUED_AT}
      issuedDateLabel="26 de octubre de 2026"
      {...props}
    />,
  )
}

describe('ControlSheet: planilla imprimible de control (IS-15)', () => {
  it('el encabezado trae membrete, título, fecha y «Revisó: ____»', () => {
    renderSheet()
    expect(
      screen.getByRole('heading', { name: 'Planilla de control de stock' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Extendiendo Servicios')).toBeInTheDocument()
    expect(screen.getByText('Fecha:')).toBeInTheDocument()
    expect(screen.getByText('26 de octubre de 2026')).toBeInTheDocument()
    expect(screen.getByText('Revisó:')).toBeInTheDocument()
    expect(screen.getByText(/^_{10,}$/)).toBeInTheDocument()
    // Sin categoría filtrada, no hay dato de categoría en el encabezado.
    expect(screen.queryByText('Categoría:')).toBeNull()
  })

  it('con una categoría filtrada, la nombra en el encabezado', () => {
    renderSheet({ items: [ITEMS[0]!], categoryName: 'Químicos' })
    expect(screen.getByText('Categoría:')).toBeInTheDocument()
    expect(screen.getByText('Químicos')).toBeInTheDocument()
  })

  it('las columnas son las de la planilla, en orden', () => {
    renderSheet()
    expect(
      within(screen.getByRole('table').querySelector('thead') as HTMLElement)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual([
      'Código',
      'Artículo',
      'Presentación',
      'Stock del sistema',
      'Contado',
      '✓',
      '+ / −',
      'Observación',
    ])
    // Los anchos suman el ancho útil de un A4 con 15 mm de margen.
    expect(CONTROL_SHEET_COLUMNS.reduce((sum, c) => sum + c.width, 0)).toBe(180)
  })

  it('cada artículo lleva su stock del sistema y espacio en blanco para escribir', () => {
    renderSheet()
    const rows = screen.getAllByTestId('control-sheet-row')
    expect(rows).toHaveLength(2)
    const cells = within(rows[1]!).getAllByRole('cell')
    expect(cells[0]).toHaveTextContent('DES-010')
    expect(cells[1]).toHaveTextContent('Bolsa de residuos')
    expect(cells[2]).toHaveTextContent('x 10')
    expect(cells[3]).toHaveTextContent('1.250')
    // «Contado», «+ / −» y «Observación» quedan vacíos; el casillero es un cuadrado.
    expect(cells[4]).toBeEmptyDOMElement()
    expect(cells[6]).toBeEmptyDOMElement()
    expect(cells[7]).toBeEmptyDOMElement()
    expect(cells[5]?.querySelector('span')).not.toBeNull()
  })

  it('separa por categoría cuando están todas', () => {
    renderSheet()
    expect(
      screen
        .getAllByTestId('control-sheet-category')
        .map((row) => row.textContent),
    ).toEqual(['Químicos', 'Descartables'])
  })

  it('con una sola categoría filtrada no repite el separador', () => {
    renderSheet({ items: [ITEMS[0]!], categoryName: 'Químicos' })
    expect(screen.queryByTestId('control-sheet-category')).toBeNull()
  })

  it('el pie trae observaciones generales, firma, aclaración y fecha', () => {
    renderSheet()
    expect(screen.getByText('Observaciones generales')).toBeInTheDocument()
    expect(screen.getByText('Firma')).toBeInTheDocument()
    expect(screen.getByText('Aclaración')).toBeInTheDocument()
    expect(screen.getByText('Fecha')).toBeInTheDocument()
    // El bloque de firmas lo reconoce PrintSheet para no partirlo entre hojas.
    expect(document.querySelector('[data-print-signatures]')).not.toBeNull()
  })

  it('sin artículos activos lo dice en vez de dejar la tabla vacía', () => {
    renderSheet({ items: [] })
    expect(
      screen.getByText('No hay artículos activos para controlar.'),
    ).toBeInTheDocument()
  })

  it('la tabla tiene encabezado propio (thead) para que se repita en cada hoja', () => {
    renderSheet()
    const table = screen.getByRole('table')
    expect(table.querySelector('thead')).not.toBeNull()
    expect(table.querySelectorAll('col')).toHaveLength(8)
  })
})
