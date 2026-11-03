import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as authModule from '@/features/auth/AuthProvider'
import type { AuthContextValue } from '@/features/auth/AuthProvider'
import { makeWorkday } from '@/features/geo/coordinatorFixtures'
import { AllWorkdaysTab } from './AllWorkdaysTab'

const { workdaysMock } = vi.hoisted(() => ({ workdaysMock: vi.fn() }))

vi.mock('../queries', () => ({ useAllWorkdaysQuery: workdaysMock }))
vi.mock('@/features/employees/queries', () => ({
  useEmployeesQuery: () => ({ data: [] }),
}))
vi.mock('./WorkdayCard', () => ({
  WorkdayCard: (props: {
    workday: { id: string; supervisorName: string }
    showSupervisor?: boolean
  }) => (
    <div data-testid="workday-card">
      {props.workday.supervisorName}:{String(props.showSupervisor)}
    </div>
  ),
}))

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
  } satisfies AuthContextValue)
  workdaysMock.mockReset().mockReturnValue({
    data: [],
    isLoading: false,
    dataUpdatedAt: 0,
    error: null,
  })
})

describe('AllWorkdaysTab (OD-05)', () => {
  it('arranca con el mes en curso, todos los coordinadores y todos los estados', () => {
    render(
      <MemoryRouter>
        <AllWorkdaysTab />
      </MemoryRouter>,
    )
    const filters = workdaysMock.mock.calls[0]![0] as Record<string, unknown>
    expect(filters.supervisorId).toBeUndefined()
    expect(filters.status).toBe('all')
    expect(String(filters.dateFrom)).toMatch(/^\d{4}-\d{2}-01$/)
    expect(
      screen.getByRole('combobox', { name: 'Filtrar por coordinador' }),
    ).toBeVisible()
    expect(
      screen.getByRole('combobox', { name: 'Filtrar por estado' }),
    ).toBeVisible()
    expect(
      screen.getByText('No hay jornadas para mostrar con estos filtros'),
    ).toBeVisible()
  })

  it('lista cada jornada con el mismo WorkdayCard de la ficha, mostrando al coordinador', () => {
    workdaysMock.mockReturnValue({
      data: [
        makeWorkday({ id: 'a', supervisorName: 'Ana Gómez' }),
        makeWorkday({ id: 'b', supervisorName: 'Beto Paz' }),
      ],
      isLoading: false,
      dataUpdatedAt: 0,
      error: null,
    })
    render(
      <MemoryRouter>
        <AllWorkdaysTab />
      </MemoryRouter>,
    )
    const cards = screen.getAllByTestId('workday-card')
    expect(cards.map((card) => card.textContent)).toEqual([
      'Ana Gómez:true',
      'Beto Paz:true',
    ])
  })
})
