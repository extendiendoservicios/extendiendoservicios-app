import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeStatusRow, makeWorkday } from '@/features/geo/coordinatorFixtures'
import { CoordinatorsDaySection } from './CoordinatorsDaySection'

const { statusMock, workdaysMock } = vi.hoisted(() => ({
  statusMock: vi.fn(),
  workdaysMock: vi.fn(),
}))

vi.mock('@/features/geo/queries', () => ({
  useSupervisorStatusQuery: statusMock,
}))

vi.mock('@/features/workdays/queries', () => ({
  useWorkdaysByDateQuery: workdaysMock,
}))

beforeEach(() => {
  statusMock.mockReset().mockReturnValue({ data: [], isLoading: false })
  workdaysMock.mockReset().mockReturnValue({ data: [], isLoading: false })
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
})

function renderSection(isToday: boolean, date = '2026-10-23') {
  render(
    <MemoryRouter>
      <CoordinatorsDaySection date={date} isToday={isToday} />
    </MemoryRouter>,
  )
}

describe('CoordinatorsDaySection (ADM-10, P24.4)', () => {
  it('hoy: estado de cada jornada, horas netas y advertencia si se cerró sola', () => {
    statusMock.mockReturnValue({
      data: [
        makeStatusRow({
          supervisorId: 'a',
          firstName: 'Ana',
          lastName: 'Gómez',
          status: 'finished',
          autoClosed: true,
          endedAt: '2026-10-23T02:55:00Z',
          workedMinutes: 600,
        }),
        makeStatusRow({
          supervisorId: 'b',
          firstName: 'Beto',
          lastName: 'Paz',
          status: 'paused',
          pauseReason: 'Almuerzo',
          workedMinutes: 125,
        }),
        makeStatusRow({
          supervisorId: 'c',
          firstName: 'Carla',
          lastName: 'Luna',
          status: 'not_started',
          startedAt: null,
          workdayId: null,
          workedMinutes: 0,
          onLeave: true,
        }),
      ],
      isLoading: false,
    })
    renderSection(true)

    expect(statusMock).toHaveBeenCalledWith(true)
    expect(workdaysMock).toHaveBeenCalledWith('2026-10-23', false)
    expect(screen.getByRole('heading', { name: 'Coordinadores' })).toBeVisible()
    expect(screen.getByText('Finalizada')).toBeInTheDocument()
    expect(screen.getByText('10 h')).toBeInTheDocument()
    expect(
      screen.getByText('Se cerró sola: revisá el horario de fin'),
    ).toBeInTheDocument()
    expect(screen.getByText('En pausa')).toBeInTheDocument()
    expect(screen.getByText('Pausa: Almuerzo')).toBeInTheDocument()
    expect(screen.getByText('2 h 5 min')).toBeInTheDocument()
    expect(screen.getByText('Sin iniciar')).toBeInTheDocument()
    expect(screen.getByText('De licencia')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ana Gómez' })).toHaveAttribute(
      'href',
      '/admin/empleados/a?pestana=jornadas',
    )
  })

  it('una jornada corregida ya no lleva la advertencia, pero deja la constancia', () => {
    statusMock.mockReturnValue({
      data: [
        makeStatusRow({
          status: 'finished',
          autoClosed: true,
          corrected: true,
        }),
      ],
      isLoading: false,
    })
    renderSection(true)
    expect(screen.queryByText(/Se cerró sola/)).not.toBeInTheDocument()
    expect(screen.getByText('Corregida por la administración')).toBeVisible()
  })

  it('otra fecha: lee las jornadas de ese día y no el estado de hoy', () => {
    workdaysMock.mockReturnValue({
      data: [makeWorkday({ autoClosed: true, autoCloseWarning: true })],
      isLoading: false,
    })
    renderSection(false, '2026-10-21')

    expect(statusMock).toHaveBeenCalledWith(false)
    expect(workdaysMock).toHaveBeenCalledWith('2026-10-21', true)
    expect(screen.getByText('Sofía Ruiz')).toBeInTheDocument()
    expect(screen.getByText('8 h 30 min')).toBeInTheDocument()
    expect(
      screen.getByText('Se cerró sola: revisá el horario de fin'),
    ).toBeVisible()
  })

  it('sin jornadas lo dice', () => {
    renderSection(true)
    expect(
      screen.getByText('No hay jornadas de coordinadores para este día'),
    ).toBeInTheDocument()
  })
})
