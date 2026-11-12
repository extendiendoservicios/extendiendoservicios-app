import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as authModule from '@/features/auth/AuthProvider'
import { makeAssignment } from '@/features/dashboard/fixtures'
import { AttendanceTodayList } from './AttendanceTodayList'

/**
 * Toque perdido en «Registrar en nombre» (P19.12a): al llegar la consulta de
 * teléfonos (o un refresco) la celda de acciones no se tiene que volver a
 * montar; si se remontara, un toque a medio camino caería en un nodo ya
 * descartado.
 */

const { boardMock, phonesMock } = vi.hoisted(() => ({
  boardMock: vi.fn(),
  phonesMock: vi.fn(),
}))

vi.mock('@/features/attendance/queries', () => ({
  useAttendanceBoardByDateQuery: boardMock,
  useEmployeePhonesQuery: phonesMock,
}))

vi.mock('./UpdatedAgo', () => ({ UpdatedAgo: () => null }))

vi.mock('./CoordinatorsDaySection', () => ({
  CoordinatorsDaySection: () => null,
}))

vi.mock('./RecordAttendanceSheet', () => ({
  RecordAttendanceSheet: () => <div role="dialog" aria-label="Registrar" />,
}))

const rows = [
  makeAssignment({
    id: 'a1',
    employeeId: 'e1',
    shiftStatus: 'assigned',
    status: 'expected',
    startsAt: '2026-09-30T08:00:00-03:00',
    endsAt: '2026-09-30T12:00:00-03:00',
  }),
]

function renderList() {
  return render(
    <MemoryRouter>
      <AttendanceTodayList date="2026-09-30" onDateChange={vi.fn()} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.spyOn(authModule, 'useAuth').mockReturnValue({
    status: 'authenticated',
    userId: 'u1',
    email: 'x@example.com',
    roles: ['owner'],
    capabilities: [],
    profile: null,
    displayName: 'Dueña',
    isPasswordRecovery: false,
    signOut: vi.fn(),
    refreshProfile: vi.fn(),
  })
  boardMock.mockReset().mockReturnValue({ data: rows, isLoading: false })
  phonesMock.mockReset().mockReturnValue({ data: undefined })
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    // Celular táctil: tarjetas (OF-17).
    matches: query.includes('pointer: coarse'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
})

describe('AttendanceTodayList: celda de acciones estable', () => {
  it('el botón «Registrar en nombre» sigue siendo el mismo nodo cuando llegan los teléfonos', () => {
    const view = renderList()
    const before = screen.getByRole('button', { name: 'Registrar en nombre' })
    expect(screen.queryByText('Llamar')).toBeNull()

    phonesMock.mockReturnValue({ data: new Map([['e1', '1155550000']]) })
    view.rerender(
      <MemoryRouter>
        <AttendanceTodayList date="2026-09-30" onDateChange={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('Llamar')).toBeInTheDocument()
    const after = screen.getByRole('button', { name: 'Registrar en nombre' })
    expect(after).toBe(before)
    expect(before.isConnected).toBe(true)
  })

  it('el primer toque abre el registro en nombre', () => {
    renderList()
    fireEvent.click(screen.getByRole('button', { name: 'Registrar en nombre' }))
    expect(
      screen.getByRole('dialog', { name: /Registrar/i }),
    ).toBeInTheDocument()
  })
})

describe('AttendanceTodayList: cierre automático (OF-11)', () => {
  const auto = makeAssignment({
    id: 'a2',
    employeeId: 'e2',
    employeeFirstName: 'Beto',
    employeeLastName: 'Ruiz',
    shiftStatus: 'completed',
    status: 'finished',
    displayStatus: 'finished',
    checkInAt: '2026-09-30T08:00:00-03:00',
    checkOutAt: '2026-09-30T12:00:00-03:00',
    checkOutAutoClosed: true,
  })

  it('el fin cerrado automáticamente lleva la píldora y el filtro deja solo esas filas', () => {
    boardMock.mockReturnValue({ data: [...rows, auto], isLoading: false })
    renderList()
    expect(screen.getAllByText('Cierre automático')).toHaveLength(2) // filtro + píldora
    expect(screen.queryAllByText('Ana Gómez').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('switch', { name: 'Cierre automático' }))
    expect(screen.queryAllByText('Ana Gómez')).toHaveLength(0)
    expect(screen.queryAllByText('Beto Ruiz').length).toBeGreaterThan(0)
  })

  it('en la fila con fichaje y fin hay «Corregir» para el inicio y el fin', () => {
    boardMock.mockReturnValue({
      data: [
        {
          ...auto,
          checkInGeo: {
            recordId: 'r1',
            status: 'valid',
            reason: null,
            distanceM: null,
            radiusM: null,
            accuracyM: null,
            outsideReason: null,
            overridden: false,
            timeCorrected: false,
          },
          checkOutGeo: {
            recordId: 'r2',
            status: 'valid',
            reason: null,
            distanceM: null,
            radiusM: null,
            accuracyM: null,
            outsideReason: null,
            overridden: false,
            timeCorrected: false,
          },
        },
      ],
      isLoading: false,
    })
    renderList()
    expect(
      screen.getByRole('button', { name: /Corregir inicio de Beto/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Corregir fin de Beto/ }),
    ).toBeInTheDocument()
  })
})
