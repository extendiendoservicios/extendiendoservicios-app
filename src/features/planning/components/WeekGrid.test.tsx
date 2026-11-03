import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WeekGrid } from './WeekGrid'

/**
 * ADM-04 grilla semanal (P19.11d): se ajusta al ancho disponible y, si no
 * entra, el contenedor desplaza en horizontal con la columna de empleados
 * fija. jsdom no calcula el layout, así que se verifican las clases que lo
 * producen (el razonamiento de anchos está en el comentario de `WeekGrid`).
 */

vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => true }))

vi.mock('@/features/employees/queries', () => ({
  // OD-14: Ana tiene licencia el miércoles 21/10 de la semana mostrada.
  useLeavesInRangeQuery: () => ({
    data: [{ employeeId: 'e1', startsOn: '2026-10-21', endsOn: '2026-10-21' }],
  }),
  useEmployeesQuery: () => ({
    data: [
      {
        profileId: 'e1',
        firstName: 'Ana',
        lastName: 'Gómez con un apellido larguísimo',
        effectiveStatus: 'active',
      },
      {
        profileId: 'e2',
        firstName: 'Luis',
        lastName: 'Díaz',
        effectiveStatus: 'on_leave',
      },
    ],
  }),
}))

vi.mock('@/features/sites/queries', () => ({
  useClientFilterOptionsQuery: () => ({ data: [] }),
  useSitesMapQuery: () => ({ data: [] }),
}))

vi.mock('@/features/planning/queries', () => ({
  useShiftsBoardRangeQuery: () => ({ data: [] }),
  useAssignmentsBoardRangeQuery: () => ({
    data: [
      {
        id: 'a1',
        shiftId: 'sh1',
        employeeId: 'e1',
        shiftDate: '2026-10-19',
        siteName: 'Sede Centro de un nombre muy largo',
        startTime: '08:00:00',
        endTime: '12:00:00',
        openEnded: false,
      },
      {
        id: 'a2',
        shiftId: 'sh2',
        employeeId: 'e1',
        shiftDate: '2026-10-20',
        siteName: 'Sede Norte',
        startTime: '10:00:00',
        endTime: '23:59:00',
        openEnded: true,
      },
    ],
  }),
}))

vi.mock('@/features/employees/employeeLeaveStatus', () => ({
  todayInBuenosAires: () => '2026-10-20',
}))

function renderGrid(url = '/admin/planificacion?vista=semana') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <WeekGrid />
    </MemoryRouter>,
  )
}

describe('WeekGrid (escritorio)', () => {
  it('el contenedor desplaza en horizontal y la tabla tiene un ancho mínimo', () => {
    renderGrid()
    const scroll = screen.getByTestId('week-grid-scroll')
    expect(scroll.className).toContain('overflow-auto')
    expect(scroll.className).toContain('max-h-')
    const table = screen.getByTestId('week-grid-table')
    expect(table.className).toContain('min-w-[760px]')
    // Columnas flexibles: se reparten el ancho disponible.
    expect(table.className).toContain('w-full')
    expect(table.className).toContain('table-fixed')
  })

  it('la columna de empleados queda fija al desplazar', () => {
    renderGrid()
    const header = screen.getByRole('columnheader', { name: 'Empleado' })
    expect(header.className).toContain('sticky')
    expect(header.className).toContain('left-0')
    const nameCell = screen
      .getByRole('link', { name: /Ana Gómez/ })
      .closest('td')
    expect(nameCell?.className).toContain('sticky')
    expect(nameCell?.className).toContain('left-0')
  })

  it('el texto largo se recorta con puntos suspensivos y conserva el texto completo', () => {
    renderGrid()
    const name = screen.getByRole('link', { name: /Ana Gómez/ })
    expect(name.className).toContain('truncate')
    expect(name).toHaveAttribute(
      'title',
      'Ana Gómez con un apellido larguísimo',
    )
    const chip = screen.getByRole('link', { name: /Sede Centro/ })
    expect(chip).toHaveAttribute(
      'title',
      'Sede Centro de un nombre muy largo · 08:00–12:00',
    )
    const site = within(chip).getByText('Sede Centro de un nombre muy largo')
    expect(site.className).toContain('truncate')
  })

  it('el empleado de licencia se atenúa sin volver translúcida la columna fija', () => {
    renderGrid()
    const row = screen.getByText('Luis Díaz').closest('tr')
    expect(row?.className ?? '').not.toContain('opacity')
    expect(screen.getByText('(de licencia)')).toBeInTheDocument()
  })

  it('el horario nunca se recorta: va en su propia línea y sin cortes', () => {
    renderGrid()
    const ranges = screen.getAllByTestId('week-chip-range')
    const closed = ranges.find((node) => node.textContent === '08:00–12:00')
    expect(closed).toBeDefined()
    expect(closed?.className).toContain('whitespace-nowrap')
    expect(closed?.className).toContain('tabular-nums')
    expect(closed?.className).not.toContain('truncate')
    // La sede sí se recorta.
    for (const site of screen.getAllByTestId('week-chip-site')) {
      expect(site.className).toContain('truncate')
    }
  })

  it('«A terminar» se parte en dos líneas completas', () => {
    renderGrid()
    const open = screen
      .getAllByTestId('week-chip-range')
      .find((node) => node.textContent === '10:00–A terminar')
    expect(open).toBeDefined()
    const lines = Array.from(open?.children ?? [])
    expect(lines.map((line) => line.textContent)).toEqual([
      '10:00–',
      'A terminar',
    ])
    for (const line of lines) {
      expect(line.className).toContain('whitespace-nowrap')
      expect(line.className).not.toContain('truncate')
    }
  })
})

describe('WeekGrid: filtros, licencias e impresión (P27.5)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('OD-14: marca «Licencia» el día de licencia de Ana', () => {
    renderGrid()
    const cells = screen.getAllByTestId('leave-cell')
    expect(cells).toHaveLength(1)
    expect(cells[0]).toHaveTextContent('Licencia')
    expect(cells[0]?.closest('tr')).toHaveTextContent('Ana Gómez')
  })

  it('OD-12: el filtro de empleado de la URL deja solo a esa persona', () => {
    renderGrid('/admin/planificacion?vista=semana&empleado=e2')
    expect(screen.getByRole('link', { name: /Luis Díaz/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Ana Gómez/ })).toBeNull()
    // Las licencias de Ana no se muestran: se filtra por Luis.
    expect(screen.queryByTestId('leave-cell')).toBeNull()
  })

  it('OD-12: con un filtro de cliente no se mezclan las licencias', () => {
    renderGrid('/admin/planificacion?vista=semana&cliente=c1')
    expect(screen.queryByTestId('leave-cell')).toBeNull()
  })

  it('OD-15: «Imprimir calendario» arma la hoja con el encabezado de filtros y llama a imprimir', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    renderGrid('/admin/planificacion?vista=semana&empleado=e2')
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir calendario' }))

    const sheet = await screen.findByTestId('calendar-print')
    expect(sheet.parentElement).toBe(document.body)
    expect(screen.getByTestId('calendar-print-filters')).toHaveTextContent(
      'Empleado: Luis Díaz',
    )
    expect(
      within(sheet).getByText(/Calendario · semana del/),
    ).toBeInTheDocument()
    await vi.waitFor(() => expect(print).toHaveBeenCalledTimes(1))

    // Al terminar de imprimir la hoja se desmonta.
    fireEvent(window, new Event('afterprint'))
    await vi.waitFor(() =>
      expect(screen.queryByTestId('calendar-print')).toBeNull(),
    )
  })
})
