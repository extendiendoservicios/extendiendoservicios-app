import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { DataTable, type DataTableColumnDef } from './DataTable'

interface DemoRow {
  id: string
  name: string
  hour: string
}

const DATA: DemoRow[] = [
  { id: '1', name: 'Bravo', hour: '09:00' },
  { id: '2', name: 'Alfa', hour: '08:00' },
]

const COLUMNS: DataTableColumnDef<DemoRow>[] = [
  {
    accessorKey: 'name',
    header: 'Nombre',
    meta: { card: 'title' },
  },
  {
    accessorKey: 'hour',
    header: 'Horario',
    meta: { card: 'meta', cardLabel: 'Horario' },
  },
]

/** Simula el ancho de pantalla: `DataTable` decide tabla vs. `RowCard` con `useMediaQuery`. */
function mockDesktopViewport(isDesktop: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: isDesktop,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('DataTable — 1024 px o más (tabla)', () => {
  it('ordena al hacer clic en un encabezado', () => {
    mockDesktopViewport(true)
    render(<DataTable columns={COLUMNS} data={DATA} caption="Demo" />)

    const nameHeader = screen.getByRole('columnheader', { name: /Nombre/ })
    expect(nameHeader).toHaveAttribute('aria-sort', 'none')

    const bodyRowsBefore = screen.getAllByRole('row').slice(1)
    expect(
      within(bodyRowsBefore[0]!).getAllByRole('cell')[0],
    ).toHaveTextContent('Bravo')

    fireEvent.click(screen.getByRole('button', { name: /Nombre/ }))

    expect(nameHeader).toHaveAttribute('aria-sort', 'ascending')
    const bodyRowsAscending = screen.getAllByRole('row').slice(1)
    expect(
      within(bodyRowsAscending[0]!).getAllByRole('cell')[0],
    ).toHaveTextContent('Alfa')

    fireEvent.click(screen.getByRole('button', { name: /Nombre/ }))

    expect(nameHeader).toHaveAttribute('aria-sort', 'descending')
    const bodyRowsDescending = screen.getAllByRole('row').slice(1)
    expect(
      within(bodyRowsDescending[0]!).getAllByRole('cell')[0],
    ).toHaveTextContent('Bravo')
  })

  it('paginación por rango: texto, límites y callback', () => {
    mockDesktopViewport(true)
    const onPaginationChange = vi.fn()
    render(
      <DataTable
        columns={COLUMNS}
        data={DATA}
        caption="Demo"
        pagination={{ pageIndex: 0, pageSize: 2 }}
        onPaginationChange={onPaginationChange}
        pageCount={3}
        rowCount={5}
      />,
    )

    expect(screen.getByText('Mostrando 1–2 de 5')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(onPaginationChange).toHaveBeenCalledWith({
      pageIndex: 1,
      pageSize: 2,
    })
  })

  it('deshabilita "Siguiente" en la última página', () => {
    mockDesktopViewport(true)
    render(
      <DataTable
        columns={COLUMNS}
        data={DATA}
        caption="Demo"
        pagination={{ pageIndex: 2, pageSize: 2 }}
        onPaginationChange={vi.fn()}
        pageCount={3}
        rowCount={5}
      />,
    )
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled()
  })

  it('estado de carga: muestra el esqueleto, no la tabla', () => {
    mockDesktopViewport(true)
    render(<DataTable columns={COLUMNS} data={DATA} caption="Demo" isLoading />)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(
      screen.getByRole('status', { name: 'Cargando datos…' }),
    ).toBeInTheDocument()
  })

  it('fixedLayout: aplica table-fixed y un colgroup con los anchos de meta.width', () => {
    mockDesktopViewport(true)
    const columns: DataTableColumnDef<DemoRow>[] = [
      { accessorKey: 'name', header: 'Nombre', meta: { width: '70%' } },
      { accessorKey: 'hour', header: 'Horario', meta: { width: '30%' } },
    ]
    const { container } = render(
      <DataTable columns={columns} data={DATA} caption="Demo" fixedLayout />,
    )
    expect(screen.getByRole('table')).toHaveClass('table-fixed')
    const cols = container.querySelectorAll('colgroup > col')
    expect(cols).toHaveLength(2)
    expect((cols[0] as HTMLElement).style.width).toBe('70%')
    expect((cols[1] as HTMLElement).style.width).toBe('30%')
  })

  it('sin fixedLayout: no hay colgroup ni table-fixed', () => {
    mockDesktopViewport(true)
    const { container } = render(
      <DataTable columns={COLUMNS} data={DATA} caption="Demo" />,
    )
    expect(screen.getByRole('table')).not.toHaveClass('table-fixed')
    expect(container.querySelector('colgroup')).toBeNull()
  })

  it('estado vacío: muestra EmptyState, no la tabla', () => {
    mockDesktopViewport(true)
    render(<DataTable columns={COLUMNS} data={[]} caption="Demo" />)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByText('No hay datos para mostrar.')).toBeInTheDocument()
  })
})

describe('DataTable — menos de 1024 px (RowCard)', () => {
  it('no renderiza una tabla ni tiene scroll horizontal (tarjetas apiladas)', () => {
    mockDesktopViewport(false)
    render(<DataTable columns={COLUMNS} data={DATA} caption="Demo" />)

    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByText('Bravo')).toBeInTheDocument()
    expect(screen.getByText('Alfa')).toBeInTheDocument()
    expect(screen.getAllByText('Horario').length).toBeGreaterThan(0)
  })

  it("las acciones (`card: 'actions'`) van al pie de la tarjeta, después de los datos", () => {
    mockDesktopViewport(false)
    const columns: DataTableColumnDef<DemoRow>[] = [
      ...COLUMNS,
      {
        id: 'actions',
        header: 'Acciones',
        meta: { card: 'actions' },
        cell: ({ row }) => (
          <button type="button">Abrir {row.original.name}</button>
        ),
      },
    ]
    render(<DataTable columns={columns} data={DATA} caption="Demo" />)

    const button = screen.getByRole('button', { name: 'Abrir Bravo' })
    const hour = screen.getByText('09:00')
    expect(
      hour.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })
})
