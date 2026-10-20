import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { WeekGrid } from './WeekGrid'

/**
 * ADM-04 grilla semanal (P19.11d): se ajusta al ancho disponible y, si no
 * entra, el contenedor desplaza en horizontal con la columna de empleados
 * fija. jsdom no calcula el layout, así que se verifican las clases que lo
 * producen (el razonamiento de anchos está en el comentario de `WeekGrid`).
 */

vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => true }))

vi.mock('@/features/employees/queries', () => ({
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
    ],
  }),
}))

vi.mock('@/features/employees/employeeLeaveStatus', () => ({
  todayInBuenosAires: () => '2026-10-20',
}))

function renderGrid() {
  return render(
    <MemoryRouter>
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
})
