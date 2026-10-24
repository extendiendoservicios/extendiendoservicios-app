import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TodayShiftsList } from './TodayShiftsList'
import * as todayModule from '@/api/supervisorToday'
import { makeTodayShift } from '../fixtures'
import { renderRoute } from '../testUtils'

/** Lista de turnos de SUP-02 (CJ-04, CJ-25): dos bloques, orden por estado, quién supervisa y buscador. */
function mockShifts(data: ReturnType<typeof makeTodayShift>[] | undefined) {
  vi.spyOn(todayModule, 'useSupervisorTodayQuery').mockReturnValue({
    data,
    isLoading: false,
    isError: data === undefined,
  } as never)
}

function renderList() {
  return renderRoute(<TodayShiftsList />, { path: '/sup', entry: '/sup' })
}

// Reloj fijo: 23/10/2026 20:30 en Argentina (23:30 UTC).
const NOW = '2026-10-23T23:30:00Z'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('TodayShiftsList', () => {
  it('a las 20:30 los turnos de la mañana figuran «Terminado» y van al final', () => {
    mockShifts([
      makeTodayShift({
        shiftId: 'manana',
        startTime: '06:00:00',
        endTime: '10:00:00',
        startsAt: '2026-10-23T09:00:00Z',
        endsAt: '2026-10-23T13:00:00Z',
      }),
      makeTodayShift({
        shiftId: 'noche',
        startTime: '22:00:00',
        endTime: '23:59:00',
        startsAt: '2026-10-24T01:00:00Z',
        endsAt: '2026-10-24T02:59:00Z',
      }),
      makeTodayShift({
        shiftId: 'curso',
        startTime: '19:00:00',
        endTime: '22:00:00',
        startsAt: '2026-10-23T22:00:00Z',
        endsAt: '2026-10-24T01:00:00Z',
      }),
    ])
    renderList()

    const links = within(
      screen.getByRole('region', { name: 'Otras sedes' }),
    ).getAllByRole('link')
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/sup/turnos/curso',
      '/sup/turnos/noche',
      '/sup/turnos/manana',
    ])
    expect(within(links[0]!).getByText('En curso')).toBeInTheDocument()
    expect(within(links[1]!).getByText('Por empezar')).toBeInTheDocument()
    expect(within(links[2]!).getByText('Terminado')).toBeInTheDocument()
  })

  it('separa «Mis sedes» y «Otras sedes», con los turnos en curso primero', () => {
    mockShifts([
      makeTodayShift({
        shiftId: 'p1',
        isPriority: true,
        siteName: 'Torre Norte',
        displayState: 'finished',
      }),
      makeTodayShift({
        shiftId: 'p2',
        isPriority: true,
        siteName: 'Torre Sur',
        displayState: 'in_progress',
        endsAt: '2026-10-24T03:00:00Z',
      }),
      makeTodayShift({ shiftId: 'o1', siteName: 'Local Centro' }),
    ])
    renderList()

    const mine = screen.getByRole('region', { name: 'Mis sedes' })
    const others = screen.getByRole('region', { name: 'Otras sedes' })
    const mineLinks = within(mine).getAllByRole('link')
    expect(mineLinks.map((l) => l.getAttribute('href'))).toEqual([
      '/sup/turnos/p2',
      '/sup/turnos/p1',
    ])
    expect(within(mine).getByText('En curso')).toBeInTheDocument()
    expect(within(mine).getByText('Terminado')).toBeInTheDocument()
    expect(within(others).getAllByRole('link')).toHaveLength(1)
  })

  it('muestra quién supervisa o ya supervisó cada turno para que no se pisen', () => {
    mockShifts([
      makeTodayShift({
        shiftId: 'o1',
        displayState: 'in_progress',
        supervisors: [
          {
            supervisionId: 's1',
            supervisorId: 'u2',
            firstName: 'Ana',
            lastName: 'Ruiz',
            status: 'in_progress',
            checkInAt: '2026-10-23T11:30:00Z',
            checkOutAt: null,
            isMe: false,
          },
        ],
      }),
    ])
    renderList()

    expect(screen.getByText('Supervisando: Ana')).toBeInTheDocument()
  })

  it('el buscador de «Otras sedes» filtra por cliente o sede', () => {
    mockShifts([
      makeTodayShift({
        shiftId: 'o1',
        clientName: 'Banco',
        siteName: 'Sucursal Sur',
      }),
      makeTodayShift({
        shiftId: 'o2',
        clientName: 'Óptica',
        siteName: 'Local 1',
      }),
    ])
    renderList()

    fireEvent.change(screen.getByLabelText('Buscar por cliente o sede'), {
      target: { value: 'optica' },
    })

    const others = screen.getByRole('region', { name: 'Otras sedes' })
    expect(within(others).getAllByRole('link')).toHaveLength(1)
    expect(within(others).getByText('Óptica')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Buscar por cliente o sede'), {
      target: { value: 'zzz' },
    })
    expect(
      screen.getByText('No encontramos turnos con esa búsqueda.'),
    ).toBeInTheDocument()
  })

  it('sin turnos hoy muestra el estado vacío', () => {
    mockShifts([])
    renderList()
    expect(screen.getByText('No hay turnos hoy')).toBeInTheDocument()
  })

  it('si falla la carga, avisa', () => {
    mockShifts(undefined)
    renderList()
    expect(
      screen.getByText(/No pudimos cargar los turnos de hoy/),
    ).toBeInTheDocument()
  })
})
