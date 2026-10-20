import { render, screen } from '@testing-library/react'
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
vi.mock('@/features/shifts/queries', () => ({
  useShiftsByDateQuery: () => ({
    isLoading: false,
    dataUpdatedAt: 0,
    data: [
      {
        id: 's1',
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

function renderList() {
  return render(
    <MemoryRouter>
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
