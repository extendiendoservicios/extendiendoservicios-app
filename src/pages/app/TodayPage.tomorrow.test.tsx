import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TodayPage from './TodayPage'
import * as queriesModule from '@/features/employee/queries'
import type { MyDayAssignment } from '@/api/myDay'

vi.mock('@/features/announcements/mobile/AnnouncementsBanner', () => ({
  AnnouncementsBanner: () => null,
}))
vi.mock('@/components/InstallBanner', () => ({ InstallBanner: () => null }))
vi.mock('@/features/employee/components/OnTheWayAction', () => ({
  OnTheWayAction: () => null,
}))

/** Atajo de «Hoy» (P32, D-08): solo mañana, más «Ver próximos días». Hoy simulado: 24/11/2026. */
function item(overrides: Partial<MyDayAssignment>): MyDayAssignment {
  return {
    assignmentId: 'a1',
    shiftId: 'sh1',
    shiftDate: '2026-11-24',
    isToday: true,
    clientName: 'Limpia Ya',
    siteName: 'Sede Centro',
    siteAddress: null,
    startTime: '08:00:00',
    endTime: '12:00:00',
    openEnded: false,
    noCheckout: false,
    status: 'expected',
    shiftStatus: 'scheduled',
    checkInAt: null,
    checkOutAt: null,
    changedSinceLastSeen: false,
    notes: null,
    shiftNotes: null,
    ...overrides,
  } as MyDayAssignment
}

function mockDay(data: MyDayAssignment[]) {
  vi.spyOn(queriesModule, 'useMyDayQuery').mockReturnValue({
    data,
    isLoading: false,
    isError: false,
  } as never)
  vi.spyOn(queriesModule, 'useMarkChangesSeenMutation').mockReturnValue({
    mutate: vi.fn(),
  } as never)
}

const renderPage = () =>
  render(
    <MemoryRouter>
      <TodayPage />
    </MemoryRouter>,
  )

beforeEach(() => {
  window.localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-24T15:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('TodayPage: «Mañana» y «Ver próximos días» (P32, D-08)', () => {
  it('muestra solo los servicios de mañana, bajo el título «Mañana»', () => {
    mockDay([
      item({}),
      item({
        assignmentId: 'm1',
        shiftDate: '2026-11-25',
        isToday: false,
        siteName: 'Sede de mañana',
      }),
      item({
        assignmentId: 'p1',
        shiftDate: '2026-11-27',
        isToday: false,
        siteName: 'Sede de pasado',
      }),
    ])
    renderPage()

    expect(screen.getByText('Mañana')).toBeInTheDocument()
    expect(screen.getByText(/Sede de mañana/)).toBeInTheDocument()
    expect(screen.queryByText(/Sede de pasado/)).not.toBeInTheDocument()
    expect(screen.queryByText('Próximos días')).not.toBeInTheDocument()
  })

  it('el enlace «Ver próximos días» aparece aunque mañana no tenga servicios', () => {
    mockDay([item({})])
    renderPage()

    expect(screen.queryByText('Mañana')).not.toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Ver próximos días' }),
    ).toHaveAttribute('href', '/app/proximos')
  })
})
