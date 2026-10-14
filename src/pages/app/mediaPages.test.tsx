import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FinishPage from './FinishPage'
import InProgressPage from './InProgressPage'
import SummaryPage from './SummaryPage'
import * as queriesModule from '@/features/employee/queries'
import * as onlineModule from '@/features/employee/useOnlineStatus'
import * as authModule from '@/features/auth/AuthProvider'
import type { MyDayAssignment } from '@/api/myDay'

/**
 * Módulo H (P21.3) en las pantallas del empleado: EMP-07 (bloque «Fotos y
 * videos»), EMP-10 (advertencia que no bloquea) y EMP-11 (cantidad subida y
 * el mismo bloque, porque la ventana sigue abierta). El bloque en sí se
 * prueba en `ShiftMediaSection.test.tsx`; acá se lo reemplaza por un
 * marcador con las propiedades que recibe.
 */
vi.mock('@/features/employee/components/LazyShiftMediaSection', () => ({
  LazyShiftMediaSection: (props: {
    shiftId: string
    anchorId?: string
    counts: { photos: number; videos: number }
    requiresPhotos: boolean
    photosNotAllowed: boolean
  }) => (
    <div
      data-testid="media-section"
      data-shift={props.shiftId}
      data-anchor={props.anchorId ?? ''}
      data-photos={props.counts.photos}
      data-videos={props.counts.videos}
      data-requires={String(props.requiresPhotos)}
      data-not-allowed={String(props.photosNotAllowed)}
    />
  ),
}))

function assignment(overrides: Partial<MyDayAssignment>): MyDayAssignment {
  return {
    assignmentId: 'a1',
    shiftId: 'sh1',
    shiftDate: '2026-10-13',
    isToday: true,
    clientId: 'c1',
    clientName: 'Limpia Ya',
    siteId: 'si1',
    siteName: 'Sede Centro',
    siteAddress: null,
    siteContactName: null,
    siteContactPhone: null,
    accessInstructions: null,
    buildingHours: null,
    phoneRestricted: false,
    photosNotAllowed: false,
    requiresPhotos: false,
    myPhotosCount: 0,
    myVideosCount: 0,
    restrictionsNotes: null,
    startTime: '08:00:00',
    endTime: '12:00:00',
    startsAt: '2026-10-13T11:00:00Z',
    endsAt: '2026-10-13T15:00:00Z',
    openEnded: false,
    noCheckout: false,
    status: 'present',
    shiftStatus: 'in_progress',
    notes: null,
    tasksTotal: 2,
    tasksDone: 1,
    changedSinceLastSeen: false,
    checkInAt: '2026-10-13T11:02:00Z',
    checkOutAt: null,
    siteCity: null,
    siteLatitude: null,
    siteLongitude: null,
    checkInSource: null,
    checkInRecordedBy: null,
    checkOutSource: null,
    checkOutRecordedBy: null,
    lastNoticeKind: null,
    lastNoticeMinutesLate: null,
    lastNoticeReasonCode: null,
    lastNoticeReportedBy: null,
    lastNoticeReasonText: null,
    lastNoticeSource: null,
    lastNoticeAt: null,
    lastNoticeEstimatedArrivalAt: null,
    onTheWayExpiresAt: null,
    ...overrides,
  }
}

function mockDay(item: MyDayAssignment) {
  vi.spyOn(onlineModule, 'useOnlineStatus').mockReturnValue(true)
  vi.spyOn(queriesModule, 'useMyDayQuery').mockReturnValue({
    data: [item],
    isLoading: false,
    isError: false,
  } as never)
  vi.spyOn(queriesModule, 'useShiftTasksQuery').mockReturnValue({
    data: [],
  } as never)
  vi.spyOn(queriesModule, 'useRecordCheckOutMutation').mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  } as never)
  vi.spyOn(authModule, 'useAuth').mockReturnValue({
    userId: 'user-1',
    profile: null,
  } as never)
}

function renderAt(path: string, route: string, element: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={route} element={element} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('InProgressPage (EMP-07) · fotos y videos', () => {
  const renderPage = () =>
    renderAt(
      '/app/en-curso/a1',
      '/app/en-curso/:assignmentId',
      <InProgressPage />,
    )

  it('incluye el bloque con los contadores y el ancla #fotos', () => {
    mockDay(
      assignment({
        requiresPhotos: true,
        myPhotosCount: 3,
        myVideosCount: 1,
      }),
    )
    renderPage()

    const section = screen.getByTestId('media-section')
    expect(section).toHaveAttribute('data-shift', 'sh1')
    expect(section).toHaveAttribute('data-anchor', 'fotos')
    expect(section).toHaveAttribute('data-photos', '3')
    expect(section).toHaveAttribute('data-videos', '1')
    expect(section).toHaveAttribute('data-requires', 'true')
  })

  it('le pasa al bloque que la sede no permite fotos', () => {
    mockDay(assignment({ photosNotAllowed: true }))
    renderPage()
    expect(screen.getByTestId('media-section')).toHaveAttribute(
      'data-not-allowed',
      'true',
    )
  })
})

describe('FinishPage (EMP-10) · servicio que pide fotos', () => {
  const renderPage = () =>
    renderAt(
      '/app/en-curso/a1/finalizar',
      '/app/en-curso/:assignmentId/finalizar',
      <FinishPage />,
    )

  it('sin fotos propias advierte, ofrece «Sacar foto» y el botón pasa a «Finalizar igual»', () => {
    mockDay(assignment({ requiresPhotos: true, myPhotosCount: 0 }))
    renderPage()

    expect(
      screen.getByText(/Este servicio pide fotos y todavía no subiste ninguna/),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sacar foto' })).toHaveAttribute(
      'href',
      '/app/en-curso/a1#fotos',
    )
    const finish = screen.getByRole('button', { name: 'Finalizar igual' })
    // La advertencia no bloquea.
    expect(finish).toBeEnabled()
    expect(
      screen.queryByRole('button', { name: 'Registrar fin' }),
    ).not.toBeInTheDocument()
  })

  it('«Finalizar igual» registra el fin', async () => {
    mockDay(assignment({ requiresPhotos: true, myPhotosCount: 0 }))
    const mutateAsync = vi.fn().mockResolvedValue({})
    vi.spyOn(queriesModule, 'useRecordCheckOutMutation').mockReturnValue({
      mutateAsync,
      isPending: false,
    } as never)
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Finalizar igual' }))

    await vi.waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        assignmentId: 'a1',
        coords: null,
      }),
    )
  })

  it('con al menos una foto propia no advierte', () => {
    mockDay(assignment({ requiresPhotos: true, myPhotosCount: 1 }))
    renderPage()

    expect(screen.queryByText(/pide fotos/)).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Registrar fin' }),
    ).toBeInTheDocument()
  })

  it('si el servicio no pide fotos no advierte', () => {
    mockDay(assignment({ requiresPhotos: false, myPhotosCount: 0 }))
    renderPage()

    expect(screen.queryByText(/pide fotos/)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Sacar foto' }),
    ).not.toBeInTheDocument()
  })

  it('en una sede sin fotos no advierte (no habría cómo cumplirlo)', () => {
    mockDay(
      assignment({
        requiresPhotos: true,
        myPhotosCount: 0,
        photosNotAllowed: true,
      }),
    )
    renderPage()

    expect(screen.queryByText(/pide fotos/)).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Registrar fin' }),
    ).toBeInTheDocument()
  })
})

describe('SummaryPage (EMP-11) · fotos y videos', () => {
  const renderPage = () =>
    renderAt('/app/resumen/a1', '/app/resumen/:assignmentId', <SummaryPage />)

  it('cuenta lo subido y deja agregar más con el mismo bloque', () => {
    mockDay(
      assignment({
        checkOutAt: '2026-10-13T15:00:00Z',
        myPhotosCount: 3,
        myVideosCount: 1,
      }),
    )
    renderPage()

    expect(screen.getByText('Fotos y videos')).toBeInTheDocument()
    expect(screen.getByText('3 fotos y 1 video')).toBeInTheDocument()
    expect(screen.getByTestId('media-section')).toHaveAttribute(
      'data-photos',
      '3',
    )
  })

  it('sin nada subido dice «Ninguno»', () => {
    mockDay(assignment({ checkOutAt: '2026-10-13T15:00:00Z' }))
    renderPage()
    expect(screen.getByText('Ninguno')).toBeInTheDocument()
  })

  it('en una sede sin fotos no lista la cantidad', () => {
    mockDay(
      assignment({
        checkOutAt: '2026-10-13T15:00:00Z',
        photosNotAllowed: true,
      }),
    )
    renderPage()

    expect(screen.queryByText('Ninguno')).not.toBeInTheDocument()
  })
})
