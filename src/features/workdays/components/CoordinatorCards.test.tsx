import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Role } from '@/api/users'
import * as authModule from '@/features/auth/AuthProvider'
import type { AuthContextValue } from '@/features/auth/AuthProvider'
import { makeStatusRow, makeWorkday } from '@/features/geo/coordinatorFixtures'
import { CoordinatorCards } from './CoordinatorCards'

const { statusMock, workdaysMock } = vi.hoisted(() => ({
  statusMock: vi.fn(),
  workdaysMock: vi.fn(),
}))

vi.mock('@/features/geo/queries', () => ({
  useSupervisorStatusQuery: statusMock,
}))
vi.mock('../queries', () => ({
  useWorkdaysByDateQuery: workdaysMock,
}))
vi.mock('./EndWorkdayDialog', () => ({
  EndWorkdayDialog: (props: { workdayId: string }) => (
    <div role="dialog" aria-label="Finalizar">
      finalizar:{props.workdayId}
    </div>
  ),
}))

function authAs(roles: Role[]): AuthContextValue {
  return {
    status: 'authenticated',
    userId: 'u1',
    email: 'x@example.com',
    roles,
    capabilities: [],
    profile: null,
    displayName: 'Dueña',
    isPasswordRecovery: false,
    signOut: vi.fn(),
    refreshProfile: vi.fn(),
  }
}

beforeEach(() => {
  vi.spyOn(authModule, 'useAuth').mockReturnValue(authAs(['owner']))
  statusMock.mockReset().mockReturnValue({ data: [], isLoading: false })
  workdaysMock.mockReset().mockReturnValue({ data: [], isLoading: false })
})

function renderCards(isToday: boolean, date = '2026-10-23') {
  render(
    <MemoryRouter>
      <CoordinatorCards date={date} isToday={isToday} />
    </MemoryRouter>,
  )
}

const todayStatus = [
  makeStatusRow({
    supervisorId: 'a',
    firstName: 'Ana',
    lastName: 'Gómez',
    status: 'paused',
    workdayId: 'w-a',
  }),
  makeStatusRow({
    supervisorId: 'c',
    firstName: 'Carla',
    lastName: 'Luna',
    status: 'not_started',
    startedAt: null,
    workdayId: null,
    onLeave: true,
  }),
]
const todayWorkday = makeWorkday({
  id: 'w-a',
  supervisorId: 'a',
  supervisorName: 'Ana Gómez',
  state: 'paused',
  endedAt: null,
  isOpen: true,
  workedMinutes: 125,
  openPauseEventId: 'e-pause',
})

describe('CoordinatorCards: sin iniciar (P27.10b)', () => {
  it('con muchos sin iniciar muestra algunos y «y N más» expande el resto', () => {
    statusMock.mockReturnValue({
      data: ['A', 'B', 'C', 'D', 'E', 'F'].map((letter) =>
        makeStatusRow({
          supervisorId: letter,
          firstName: letter,
          lastName: 'Ruiz',
          status: 'not_started',
          startedAt: null,
          workdayId: null,
        }),
      ),
      isLoading: false,
    })
    renderCards(true)
    const line = screen.getByTestId('coordinators-not-started')
    expect(line).toHaveTextContent('Sin iniciar (6):')
    expect(line).not.toHaveTextContent('F Ruiz')
    fireEvent.click(screen.getByRole('button', { name: 'y 2 más' }))
    expect(screen.getByTestId('coordinators-not-started')).toHaveTextContent(
      'F Ruiz',
    )
  })
})

describe('CoordinatorCards (OD-04)', () => {
  it('hoy: una tarjeta por coordinador con estado, inicio, pausa con motivo y horas netas', () => {
    statusMock.mockReturnValue({ data: todayStatus, isLoading: false })
    workdaysMock.mockReturnValue({ data: [todayWorkday], isLoading: false })
    renderCards(true)

    expect(statusMock).toHaveBeenCalledWith(true)
    // Hoy las jornadas del día se refrescan cada 60 s.
    expect(workdaysMock).toHaveBeenCalledWith('2026-10-23', true, true)
    const ana = screen.getByRole('article', { name: 'Coordinador Ana Gómez' })
    expect(ana).toHaveTextContent('En pausa')
    expect(ana).toHaveTextContent('08:00')
    expect(ana).toHaveTextContent('12:00 a 12:30 · Almuerzo')
    expect(ana).toHaveTextContent('2 h 5 min')
    // P27.10b: quien no inició no tiene tarjeta, va en una línea compacta.
    expect(
      screen.queryByRole('article', { name: 'Coordinador Carla Luna' }),
    ).toBeNull()
    expect(screen.getByTestId('coordinators-not-started')).toHaveTextContent(
      'Sin iniciar (1): Carla Luna (de licencia)',
    )
    expect(
      screen.queryByRole('button', { name: 'Ver actividad de Carla Luna' }),
    ).toBeNull()
  })

  it('«Ver actividad» abre el panel con la línea de tiempo del día', () => {
    statusMock.mockReturnValue({ data: todayStatus, isLoading: false })
    workdaysMock.mockReturnValue({
      data: [
        {
          ...todayWorkday,
          events: [
            {
              id: 'e1',
              kind: 'start',
              recordedAt: '2026-10-21T11:00:00Z',
              reason: null,
              supervisionId: null,
              hasPosition: true,
              corrected: false,
              correctedFrom: null,
              correctionReason: null,
              removed: false,
            },
          ],
        },
      ],
      isLoading: false,
    })
    renderCards(true)
    fireEvent.click(
      screen.getByRole('button', { name: 'Ver actividad de Ana Gómez' }),
    )
    expect(screen.getByText('Actividad de Ana Gómez')).toBeVisible()
    expect(screen.getByText('08:00 · Inicio de la jornada')).toBeVisible()
  })

  it('OD-06: «Finalizar jornada» con permiso y jornada abierta abre el diálogo', () => {
    statusMock.mockReturnValue({ data: todayStatus, isLoading: false })
    workdaysMock.mockReturnValue({ data: [todayWorkday], isLoading: false })
    renderCards(true)
    fireEvent.click(
      screen.getByRole('button', { name: 'Finalizar la jornada de Ana Gómez' }),
    )
    expect(screen.getByRole('dialog', { name: 'Finalizar' })).toHaveTextContent(
      'finalizar:w-a',
    )
  })

  it('sin manage_attendance no ofrece «Finalizar jornada», pero sí «Ver actividad»', () => {
    vi.spyOn(authModule, 'useAuth').mockReturnValue(authAs(['admin']))
    statusMock.mockReturnValue({ data: todayStatus, isLoading: false })
    workdaysMock.mockReturnValue({ data: [todayWorkday], isLoading: false })
    renderCards(true)
    expect(
      screen.queryByRole('button', { name: /Finalizar la jornada/ }),
    ).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Ver actividad de Ana Gómez' }),
    ).toBeVisible()
  })

  it('una jornada finalizada no ofrece «Finalizar jornada»', () => {
    statusMock.mockReturnValue({
      data: [makeStatusRow({ supervisorId: 'sv1', status: 'finished' })],
      isLoading: false,
    })
    workdaysMock.mockReturnValue({ data: [makeWorkday()], isLoading: false })
    renderCards(true)
    expect(
      screen.queryByRole('button', { name: /Finalizar la jornada/ }),
    ).toBeNull()
  })

  it('otra fecha: lee las jornadas de ese día y no el estado de hoy', () => {
    workdaysMock.mockReturnValue({
      data: [makeWorkday({ autoClosed: true, autoCloseWarning: true })],
      isLoading: false,
    })
    renderCards(false, '2026-10-21')
    expect(statusMock).toHaveBeenCalledWith(false)
    expect(workdaysMock).toHaveBeenCalledWith('2026-10-21', true, false)
    expect(screen.getByText('Sofía Ruiz')).toBeVisible()
    expect(screen.getByText('8 h 30 min')).toBeVisible()
    expect(
      screen.getByText('Se cerró sola: revisá el horario de fin'),
    ).toBeVisible()
  })

  it('sin jornadas lo dice', () => {
    renderCards(true)
    expect(
      screen.getByText('No hay jornadas de coordinadores para este día'),
    ).toBeInTheDocument()
  })
})
