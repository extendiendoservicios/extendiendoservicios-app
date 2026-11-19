import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MonthCalendar } from './MonthCalendar'

/**
 * Calendario mensual (P27.5): filtros desde la URL (OD-12), licencias en las
 * celdas (OD-14) e «Imprimir calendario» (OD-15).
 */

const { boardMock } = vi.hoisted(() => ({ boardMock: vi.fn() }))

vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => true }))
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ roles: ['owner'], capabilities: [] }),
}))
vi.mock('@/features/employees/employeeLeaveStatus', () => ({
  todayInBuenosAires: () => '2026-10-20',
}))
vi.mock('@/features/employees/queries', () => ({
  useLeavesInRangeQuery: () => ({
    data: [
      { employeeId: 'e1', startsOn: '2026-10-05', endsOn: '2026-10-06' },
      { employeeId: 'e2', startsOn: '2026-10-06', endsOn: '2026-10-06' },
    ],
  }),
  useEmployeesQuery: () => ({
    data: [
      { profileId: 'e1', firstName: 'Ana', lastName: 'Gómez' },
      { profileId: 'e2', firstName: 'Luis', lastName: 'Díaz' },
    ],
  }),
}))
vi.mock('@/features/sites/queries', () => ({
  useClientFilterOptionsQuery: () => ({
    data: [{ id: 'c1', name: 'Limpia Ya' }],
  }),
  useSitesMapQuery: () => ({ data: [] }),
}))
vi.mock('@/features/settings/queries', () => ({
  useHolidaysQuery: () => ({ data: [] }),
}))
vi.mock('@/features/planning/queries', () => ({
  useShiftsBoardRangeQuery: boardMock,
}))

function LocationProbe() {
  const location = useLocation()
  return <p data-testid="url">{location.search}</p>
}

function renderMonth(url = '/admin/planificacion') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <MonthCalendar onOpenDay={() => undefined} />
      <LocationProbe />
    </MemoryRouter>,
  )
}

describe('MonthCalendar: el mes vive en la dirección (OH-03)', () => {
  it('muestra el mes de ?mes= (al volver de un turno no salta al mes actual)', () => {
    renderMonth('/admin/planificacion?mes=2026-12')
    expect(boardMock).toHaveBeenCalledWith(
      '2026-12-01',
      '2026-12-31',
      expect.anything(),
    )
  })

  it('«Mes siguiente» lo escribe en la dirección y conserva los filtros', () => {
    renderMonth('/admin/planificacion?cliente=c1')
    fireEvent.click(screen.getByRole('button', { name: 'Mes siguiente' }))
    expect(screen.getByTestId('url').textContent).toBe(
      '?cliente=c1&mes=2026-11',
    )
  })

  it('DEF-P30-01: dos clics seguidos en «Mes siguiente» avanzan dos meses', () => {
    renderMonth('/admin/planificacion?cliente=c1')
    const next = screen.getByRole('button', { name: 'Mes siguiente' })
    act(() => {
      fireEvent.click(next)
      fireEvent.click(next)
    })
    expect(screen.getByTestId('url').textContent).toBe(
      '?cliente=c1&mes=2026-12',
    )
  })

  it('volver al mes actual quita el parámetro', () => {
    renderMonth('/admin/planificacion?mes=2026-11')
    fireEvent.click(screen.getByRole('button', { name: 'Mes anterior' }))
    expect(screen.getByTestId('url').textContent).toBe('')
  })

  it('un mes inválido en la dirección cae en el actual', () => {
    renderMonth('/admin/planificacion?mes=2026-13')
    expect(boardMock).toHaveBeenCalledWith(
      '2026-10-01',
      '2026-10-31',
      expect.anything(),
    )
  })
})

beforeEach(() => {
  window.localStorage.clear()
  boardMock.mockReset().mockReturnValue({ data: [] })
})

describe('MonthCalendar: filtros de la URL (OD-12)', () => {
  it('pasa los filtros de la URL a la consulta del mes', () => {
    renderMonth(
      '/admin/planificacion?cliente=c1&sede=s1&empleado=e1&estado=assigned',
    )
    expect(boardMock).toHaveBeenCalledWith('2026-10-01', '2026-10-31', {
      clientId: 'c1',
      siteId: 's1',
      employeeId: 'e1',
      status: 'assigned',
    })
  })
})

describe('MonthCalendar: licencias (OD-14)', () => {
  it('con una persona de licencia el día nombra a esa persona; con varias cuenta', () => {
    renderMonth()
    const chips = screen.getAllByTestId('leave-chip')
    expect(chips.map((chip) => chip.textContent)).toEqual([
      'Licencia: Ana Gómez',
      '2 licencias',
    ])
    expect(chips[1]).toHaveAttribute(
      'title',
      'De licencia: Ana Gómez, Luis Díaz',
    )
  })

  it('al filtrar por empleado quedan solo sus licencias', () => {
    renderMonth('/admin/planificacion?empleado=e2')
    const chips = screen.getAllByTestId('leave-chip')
    expect(chips.map((chip) => chip.textContent)).toEqual([
      'Licencia: Luis Díaz',
    ])
  })

  it('al filtrar por cliente sin empleado no se muestran licencias', () => {
    renderMonth('/admin/planificacion?cliente=c1')
    expect(screen.queryAllByTestId('leave-chip')).toHaveLength(0)
  })
})

describe('MonthCalendar: imprimir (OD-15)', () => {
  it('arma la hoja con el mes y los filtros aplicados y llama a imprimir', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    renderMonth('/admin/planificacion?cliente=c1&estado=uncovered')
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir calendario' }))

    expect(
      await screen.findByText('Calendario · octubre 2026'),
    ).toBeInTheDocument()
    expect(screen.getByTestId('calendar-print-filters')).toHaveTextContent(
      'Cliente: Limpia Ya · Estado: Sin cubrir',
    )
    await vi.waitFor(() => expect(print).toHaveBeenCalledTimes(1))
    fireEvent(window, new Event('afterprint'))
    await vi.waitFor(() =>
      expect(screen.queryByTestId('calendar-print')).toBeNull(),
    )
    print.mockRestore()
  })

  it('sin filtros el encabezado dice «Sin filtros»', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    renderMonth()
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir calendario' }))
    expect(
      await screen.findByTestId('calendar-print-filters'),
    ).toHaveTextContent('Sin filtros')
    fireEvent(window, new Event('afterprint'))
    print.mockRestore()
  })
})
