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
    matches: false,
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
