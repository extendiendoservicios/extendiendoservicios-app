import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { DataTable, type DataTableColumnDef } from './DataTable'

interface DemoRow {
  id: string
  name: string
  n: number
}

const DATA: DemoRow[] = [
  { id: '1', name: 'Bravo', n: 20 },
  { id: '2', name: 'Alfa', n: 5 },
]

const COLUMNS: DataTableColumnDef<DemoRow>[] = [
  { accessorKey: 'name', header: 'Nombre', meta: { card: 'title' } },
  { accessorKey: 'n', header: 'Cantidad', meta: { card: 'meta' } },
]

/** Simula celular táctil (tarjetas) o computadora (tabla). */
function mockCardViewport(isCards: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: isCards,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

const HANDLE_NAME = 'Cambiar el ancho de la columna Nombre'

function firstCells() {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0]!.textContent)
}

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('DataTable — OH-01 (alto acotado)', () => {
  it('sin maxVisibleRows ni maxHeight, la tabla crece sin límite ni encabezado fijo', () => {
    mockCardViewport(false)
    const { container } = render(
      <DataTable columns={COLUMNS} data={DATA} caption="Demo" />,
    )
    const box = container.querySelector<HTMLElement>(
      '[data-slot="table-container"]',
    )!
    expect(box.style.maxHeight).toBe('')
    expect(
      screen.getByRole('columnheader', { name: /Nombre/ }),
    ).not.toHaveClass('top-0')
  })

  it('maxVisibleRows acota el alto del bloque y deja el encabezado fijo', () => {
    mockCardViewport(false)
    const { container } = render(
      <DataTable
        columns={COLUMNS}
        data={DATA}
        caption="Demo"
        maxVisibleRows={10}
      />,
    )
    const box = container.querySelector<HTMLElement>(
      '[data-slot="table-container"]',
    )!
    expect(box.style.maxHeight).toBe('calc(32.5rem)')
    expect(box).toHaveClass('overflow-y-auto', 'overflow-x-auto')
    const headers = screen.getAllByRole('columnheader')
    // La primera columna queda fija a la izquierda y arriba a la vez.
    expect(headers[0]).toHaveClass('sticky', 'top-0', 'left-0')
    expect(headers[1]).toHaveClass('sticky', 'top-0')
  })

  it('DEF-P30-06: el encabezado fijo es opaco y queda por encima de las celdas y de las filas resaltadas', () => {
    mockCardViewport(false)
    render(
      <DataTable
        columns={COLUMNS}
        data={DATA}
        caption="Demo"
        maxVisibleRows={10}
        rowVariant={() => 'crit'}
      />,
    )
    const headers = screen.getAllByRole('columnheader')
    for (const header of headers) {
      expect(header).toHaveClass('bg-[var(--table-header-bg)]')
    }
    // Encabezado (z 4) por encima de las celdas (z 1); la esquina (z 5), por encima de ambos.
    expect(headers[1]).toHaveClass('z-[4]')
    expect(headers[0]).toHaveClass('z-[5]')
    const firstBodyCell = screen.getAllByRole('cell')[0] as HTMLElement
    expect(firstBodyCell).toHaveClass('z-[1]')
    expect(firstBodyCell).not.toHaveClass('z-[4]', 'z-[5]')
  })

  it('maxHeight tiene prioridad sobre maxVisibleRows', () => {
    mockCardViewport(false)
    const { container } = render(
      <DataTable
        columns={COLUMNS}
        data={DATA}
        caption="Demo"
        maxVisibleRows={10}
        maxHeight="20rem"
      />,
    )
    expect(
      container.querySelector<HTMLElement>('[data-slot="table-container"]')!
        .style.maxHeight,
    ).toBe('20rem')
  })

  it('en tarjetas (celular) nada de esto aplica', () => {
    mockCardViewport(true)
    const { container } = render(
      <DataTable
        columns={COLUMNS}
        data={DATA}
        caption="Demo"
        maxVisibleRows={1}
        resizableColumns
      />,
    )
    expect(container.querySelector('[data-slot="table-container"]')).toBeNull()
    expect(container.querySelector('[data-slot="column-resizer"]')).toBeNull()
  })
})

describe('DataTable — OH-02 (orden y ancho de columnas)', () => {
  it('el ciclo es ascendente, descendente y sin orden (también en números)', () => {
    mockCardViewport(false)
    render(<DataTable columns={COLUMNS} data={DATA} caption="Demo" />)
    const header = screen.getByRole('columnheader', { name: /Cantidad/ })
    const button = screen.getByRole('button', { name: /Cantidad/ })
    fireEvent.click(button)
    expect(header).toHaveAttribute('aria-sort', 'ascending')
    expect(firstCells()).toEqual(['Alfa', 'Bravo'])
    fireEvent.click(button)
    expect(header).toHaveAttribute('aria-sort', 'descending')
    expect(firstCells()).toEqual(['Bravo', 'Alfa'])
    fireEvent.click(button)
    expect(header).toHaveAttribute('aria-sort', 'none')
    expect(firstCells()).toEqual(['Bravo', 'Alfa'])
  })

  it('una columna con enableSorting: false no ordena', () => {
    mockCardViewport(false)
    const columns: DataTableColumnDef<DemoRow>[] = [
      { accessorKey: 'name', header: 'Nombre', enableSorting: false },
    ]
    render(<DataTable columns={columns} data={DATA} caption="Demo" />)
    expect(screen.queryByRole('button', { name: /Nombre/ })).toBeNull()
  })

  it('sin resizableColumns no hay asas de ancho', () => {
    mockCardViewport(false)
    const { container } = render(
      <DataTable columns={COLUMNS} data={DATA} caption="Demo" />,
    )
    expect(container.querySelector('[data-slot="column-resizer"]')).toBeNull()
  })

  it('DEF-P30-11: el asa siempre lleva aria-valuenow, también sin ancho fijado', () => {
    mockCardViewport(false)
    render(
      <DataTable
        columns={COLUMNS}
        data={DATA}
        caption="Demo"
        resizableColumns
      />,
    )
    const handle = screen.getByRole('separator', { name: HANDLE_NAME })
    expect(handle).toHaveAttribute('aria-valuenow')
    expect(handle).toHaveAttribute('aria-valuemin')
    expect(handle).toHaveAttribute('aria-valuemax')
    expect(handle).toHaveAttribute('aria-orientation', 'vertical')
  })

  it('las flechas sobre el asa cambian el ancho, con mínimo y máximo', () => {
    mockCardViewport(false)
    render(
      <DataTable
        columns={COLUMNS}
        data={DATA}
        caption="Demo"
        resizableColumns
      />,
    )
    const handle = screen.getByRole('separator', { name: HANDLE_NAME })
    const header = screen.getByRole('columnheader', { name: /Nombre/ })
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue({
      width: 200,
    } as DOMRect)
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(header.style.width).toBe('216px')
    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true })
    expect(header.style.width).toBe('264px')
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(header.style.width).toBe('248px')
    for (let i = 0; i < 30; i++) {
      fireEvent.keyDown(handle, { key: 'ArrowLeft', shiftKey: true })
    }
    expect(header.style.width).toBe('80px')
    fireEvent.keyDown(handle, { key: 'Home' })
    expect(header.style.width).toBe('')
  })

  it('arrastrar el borde con el puntero cambia el ancho; doble clic lo restaura', () => {
    mockCardViewport(false)
    render(
      <DataTable
        columns={COLUMNS}
        data={DATA}
        caption="Demo"
        resizableColumns
      />,
    )
    const header = screen.getByRole('columnheader', { name: /Nombre/ })
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue({
      width: 200,
    } as DOMRect)
    const handle = screen.getByRole('separator', { name: HANDLE_NAME })
    fireEvent.pointerDown(handle, { clientX: 300, button: 0 })
    fireEvent.pointerMove(handle, { clientX: 350 })
    expect(header.style.width).toBe('250px')
    fireEvent.pointerUp(handle, { clientX: 350 })
    // Soltado el puntero, mover ya no cambia nada.
    fireEvent.pointerMove(handle, { clientX: 500 })
    expect(header.style.width).toBe('250px')

    fireEvent.doubleClick(handle)
    expect(header.style.width).toBe('')
  })

  it('el asa no dispara el orden de la columna', () => {
    mockCardViewport(false)
    render(
      <DataTable
        columns={COLUMNS}
        data={DATA}
        caption="Demo"
        resizableColumns
      />,
    )
    fireEvent.click(screen.getByRole('separator', { name: HANDLE_NAME }))
    expect(
      screen.getByRole('columnheader', { name: /Nombre/ }),
    ).toHaveAttribute('aria-sort', 'none')
  })

  it('con fixedLayout el ancho redimensionado va en el colgroup', () => {
    mockCardViewport(false)
    const { container } = render(
      <DataTable
        columns={COLUMNS}
        data={DATA}
        caption="Demo"
        fixedLayout
        resizableColumns
      />,
    )
    const header = screen.getByRole('columnheader', { name: /Nombre/ })
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue({
      width: 200,
    } as DOMRect)
    fireEvent.keyDown(screen.getByRole('separator', { name: HANDLE_NAME }), {
      key: 'ArrowRight',
    })
    expect(
      (container.querySelector('colgroup > col') as HTMLElement).style.width,
    ).toBe('216px')
  })

  it('persistKey: recuerda anchos y orden y los recupera al montar de nuevo', () => {
    mockCardViewport(false)
    const props = {
      columns: COLUMNS,
      data: DATA,
      caption: 'Demo',
      resizableColumns: true,
      persistKey: 'prueba',
    }
    const first = render(<DataTable {...props} />)
    const header = screen.getByRole('columnheader', { name: /Nombre/ })
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue({
      width: 200,
    } as DOMRect)
    fireEvent.keyDown(screen.getByRole('separator', { name: HANDLE_NAME }), {
      key: 'ArrowRight',
    })
    fireEvent.click(screen.getByRole('button', { name: /Nombre/ }))
    expect(
      JSON.parse(window.localStorage.getItem('datatable:prueba')!),
    ).toEqual({
      sizing: { name: 216 },
      sorting: [{ id: 'name', desc: false }],
    })
    first.unmount()

    render(<DataTable {...props} />)
    const again = screen.getByRole('columnheader', { name: /Nombre/ })
    expect(again.style.width).toBe('216px')
    expect(again).toHaveAttribute('aria-sort', 'ascending')
    expect(firstCells()).toEqual(['Alfa', 'Bravo'])
  })

  it('persistKey con datos rotos o sin poder escribir: anda igual', () => {
    mockCardViewport(false)
    window.localStorage.setItem('datatable:rota', '{no es json')
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('cuota')
      })
    render(
      <DataTable
        columns={COLUMNS}
        data={DATA}
        caption="Demo"
        resizableColumns
        persistKey="rota"
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Nombre/ }))
    expect(setItem).toHaveBeenCalled()
    expect(
      screen.getByRole('columnheader', { name: /Nombre/ }),
    ).toHaveAttribute('aria-sort', 'ascending')
  })

  it('sin persistKey no se escribe nada', () => {
    mockCardViewport(false)
    render(
      <DataTable
        columns={COLUMNS}
        data={DATA}
        caption="Demo"
        resizableColumns
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Nombre/ }))
    expect(window.localStorage.length).toBe(0)
  })
})
