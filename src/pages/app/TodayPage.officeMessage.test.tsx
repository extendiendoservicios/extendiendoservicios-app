import { render, screen, waitFor } from '@testing-library/react'
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

function item(overrides: Partial<MyDayAssignment>): MyDayAssignment {
  return {
    assignmentId: 'a1',
    shiftId: 'sh1',
    shiftDate: '2026-11-14',
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
    notes: 'Mi observación',
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

beforeEach(() => window.localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('TodayPage: mensaje de la oficina (P29 OG-05)', () => {
  it('muestra el mensaje en la tarjeta, distinto de la observación propia', () => {
    mockDay([item({ shiftNotes: 'Llevar llaves' })])
    renderPage()
    expect(screen.getByText('Mensaje de la oficina')).toBeInTheDocument()
    expect(screen.getByText('Llevar llaves')).toBeInTheDocument()
  })

  it('anuncia «Nuevo mensaje de la oficina» cuando cambió el mensaje visto', async () => {
    window.localStorage.setItem('es.officeMessage.a1', 'Mensaje viejo')
    mockDay([item({ shiftNotes: 'Mensaje nuevo', changedSinceLastSeen: true })])
    renderPage()
    expect(
      screen.getByText(/Cambios desde tu última visita/),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(
        screen.getByText(/Nuevo mensaje de la oficina/),
      ).toBeInTheDocument(),
    )
  })

  it('si el cambio no fue el mensaje, el turno queda en cambios sin esa leyenda', () => {
    window.localStorage.setItem('es.officeMessage.a1', 'Mismo mensaje')
    mockDay([item({ shiftNotes: 'Mismo mensaje', changedSinceLastSeen: true })])
    renderPage()
    expect(
      screen.getByText(/Cambios desde tu última visita/),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/Nuevo mensaje de la oficina/),
    ).not.toBeInTheDocument()
  })
})
