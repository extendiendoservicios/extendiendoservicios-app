import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockViewport, testItem } from '@/features/stock/testSupport'
import { ControlSheetAction } from './ControlSheetAction'

vi.mock('@/features/settings/queries', () => ({
  useCompanySettingsQuery: () => ({
    data: { name: 'Extendiendo Servicios', logoPath: null, supportPhone: null },
  }),
}))

const CATEGORIES = [
  { id: 'c1', name: 'Químicos', sortOrder: 0, active: true },
  { id: 'c2', name: 'Descartables', sortOrder: 1, active: true },
]

const ITEMS = [
  testItem({ id: 'a', code: 'QUI-001', name: 'Lavandina' }),
  testItem({
    id: 'b',
    code: 'DES-010',
    name: 'Bolsa de residuos',
    categoryId: 'c2',
    categoryName: 'Descartables',
    categorySortOrder: 1,
  }),
  testItem({ id: 'x', code: 'QUI-099', name: 'Discontinuado', active: false }),
]

beforeEach(() => {
  mockViewport(true)
  Element.prototype.scrollIntoView = vi.fn()
  window.print = vi.fn()
})

function renderAction(defaultCategoryId = 'all') {
  return render(
    <ControlSheetAction
      items={ITEMS}
      categories={CATEGORIES}
      defaultCategoryId={defaultCategoryId}
    />,
  )
}

describe('ControlSheetAction: «Imprimir planilla» (IS-15)', () => {
  it('abre la vista previa con los artículos activos de todas las categorías', async () => {
    renderAction()
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir planilla' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Ver planilla' }))

    const sheet = within(await screen.findByTestId('print-sheet'))
    expect(sheet.getAllByTestId('control-sheet-row')).toHaveLength(2)
    expect(sheet.queryByText('Discontinuado')).toBeNull()
    expect(sheet.queryByText('Categoría:')).toBeNull()
  })

  it('arranca con la categoría que ya está filtrada en Stock y la nombra en el encabezado', async () => {
    renderAction('c2')
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir planilla' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Ver planilla' }))

    const sheet = within(await screen.findByTestId('print-sheet'))
    expect(sheet.getAllByTestId('control-sheet-row')).toHaveLength(1)
    expect(sheet.getByText('Bolsa de residuos')).toBeInTheDocument()
    expect(sheet.getByText('Categoría:')).toBeInTheDocument()
  })

  it('«Cerrar» vuelve a la pantalla', async () => {
    renderAction()
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir planilla' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Ver planilla' }))
    await screen.findByTestId('print-sheet')
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(screen.queryByTestId('print-sheet')).toBeNull()
  })
})
