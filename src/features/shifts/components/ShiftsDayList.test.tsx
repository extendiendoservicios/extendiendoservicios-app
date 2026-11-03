import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ShiftsDayList } from './ShiftsDayList'

/**
 * ADM-05 (P19.11d): desde 1024 px la tabla entra en el ancho sin desplazar
 * (columnas compactas, acciones con ícono) y el desplazamiento queda de
 * respaldo con alto máximo. jsdom no calcula el layout: se verifican las
 * clases y la estructura que lo producen.
 */
const { desktop } = vi.hoisted(() => ({ desktop: { value: true } }))

vi.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: () => desktop.value,
}))
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ roles: ['owner'], capabilities: [] }),
}))
vi.mock('@/features/employees/employeeLeaveStatus', () => ({
  todayInBuenosAires: () => '2026-10-20',
}))
vi.mock('@/features/employees/queries', () => ({
  // OD-14: Ana tiene licencia ese día.
  useLeavesInRangeQuery: () => ({
    data: [
      {
        employeeId: 'e1',
        startsOn: '2026-10-20',
        endsOn: '2026-10-22',
        reason: 'Franco',
      },
    ],
  }),
  useEmployeesQuery: () => ({
    data: [{ profileId: 'e1', firstName: 'Ana', lastName: 'Gómez' }],
  }),
}))
vi.mock('@/features/sites/queries', () => ({
  useClientFilterOptionsQuery: () => ({
    data: [{ id: 'c1', name: 'Cliente con un nombre larguísimo' }],
  }),
  useSitesMapQuery: () => ({ data: [] }),
}))
vi.mock('@/features/planning/queries', () => ({
  useShiftsBoardRangeQuery: () => ({ data: [] }),
}))
vi.mock('@/features/shifts/queries', () => ({
  useShiftsByDateQuery: () => ({
    isLoading: false,
    dataUpdatedAt: 0,
    data: [
      {
        id: 's1',
        clientId: 'c1',
        siteId: 'si1',
        clientName: 'Cliente con un nombre larguísimo',
        siteName: 'Sede Central',
        shiftDate: '2026-10-20',
        startTime: '08:00:00',
        endTime: '12:00:00',
        requiredStaff: 2,
        status: 'scheduled',
        displayStatus: 'scheduled',
        openEnded: false,
        assignedCount: 1,
        noCheckoutCount: 0,
      },
    ],
  }),
  useShiftPeopleByDateQuery: () => ({ data: undefined }),
  useCancelShiftMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

function renderList(url = '/admin/planificacion?vista=dia') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ShiftsDayList date="2026-10-20" onDateChange={() => undefined} />
    </MemoryRouter>,
  )
}

describe('ShiftsDayList (ancho)', () => {
  beforeEach(() => {
    desktop.value = true
  })

  it('en escritorio el contenedor tiene alto máximo, desplazamiento interno y relleno compacto', () => {
    renderList()
    const scroll = screen.getByTestId('day-list-scroll')
    expect(scroll.className).toContain('overflow-auto')
    expect(scroll.className).toContain('max-h-')
    expect(scroll.className).toContain('[&_td]:px-2')
    // El mínimo de respaldo (44 rem = 704 px) es menor que los 736 px de
    // 1024 px con el menú abierto: ahí no hay barra horizontal.
    expect(screen.getByTestId('day-list-content').className).toContain(
      'lg:min-w-[44rem]',
    )
  })

  it('las acciones son íconos con nombre accesible y el cliente · sede se recorta con título', () => {
    renderList()
    for (const name of ['Ver', 'Editar', 'Cancelar']) {
      const action = screen.getByRole(name === 'Cancelar' ? 'button' : 'link', {
        name,
      })
      expect(action).toHaveAttribute('title', name)
    }
    const label = 'Cliente con un nombre larguísimo · Sede Central'
    const cell = screen.getByTitle(label)
    expect(cell.className).toContain('truncate')
  })

  it('en celular no cambia: botones con texto', () => {
    desktop.value = false
    renderList()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveTextContent(
      'Cancelar',
    )
    expect(screen.getByRole('link', { name: 'Editar' })).toHaveTextContent(
      'Editar',
    )
  })
})

describe('ShiftsDayList: filtros, color por estado y licencias (P27.5)', () => {
  beforeEach(() => {
    desktop.value = true
    window.localStorage.clear()
  })

  it('OD-13: por defecto colorea por estado (el color del estado en el cliente · sede)', () => {
    renderList()
    const cell = screen.getByTestId('status-colored-cell')
    expect(cell).toHaveTextContent(
      'Cliente con un nombre larguísimo · Sede Central',
    )
    expect(cell).toHaveTextContent('Programado')
  })

  it('OD-13: al colorear por cliente deja de pintar por estado', () => {
    renderList()
    fireEvent.click(screen.getByRole('radio', { name: 'Cliente' }))
    expect(screen.queryByTestId('status-colored-cell')).toBeNull()
    expect(screen.getAllByTestId('status-dot').length).toBeGreaterThan(0)
  })

  it('OD-12: un filtro de cliente que no coincide muestra el vacío con filtros', () => {
    renderList('/admin/planificacion?vista=dia&cliente=otro')
    expect(
      screen.getByText('No hay turnos con estos filtros'),
    ).toBeInTheDocument()
  })

  it('OD-12: un filtro de cliente que coincide conserva el turno', () => {
    renderList('/admin/planificacion?vista=dia&cliente=c1&estado=scheduled')
    expect(screen.getByTestId('status-colored-cell')).toBeInTheDocument()
  })

  it('OD-14: lista a quienes están de licencia ese día', () => {
    renderList()
    expect(screen.getByTestId('day-leaves')).toHaveTextContent('Ana Gómez')
  })

  it('P27.10b: la licencia del día muestra también el motivo', () => {
    renderList()
    expect(screen.getByTestId('day-leaves')).toHaveTextContent(
      'Ana Gómez (Franco)',
    )
  })

  it('P27.10b: el cliente · sede largo se trunca con el texto completo en el título', () => {
    renderList()
    const cell = screen.getByTitle(
      'Cliente con un nombre larguísimo · Sede Central',
    )
    expect(cell.className).toContain('truncate')
  })

  it('OD-14: con otro empleado filtrado no aparecen las licencias de Ana', () => {
    renderList('/admin/planificacion?vista=dia&empleado=e9')
    expect(screen.queryByTestId('day-leaves')).toBeNull()
  })

  it('OD-15: hay un botón «Imprimir calendario»', () => {
    renderList()
    expect(
      screen.getByRole('button', { name: 'Imprimir calendario' }),
    ).toBeInTheDocument()
  })
})
