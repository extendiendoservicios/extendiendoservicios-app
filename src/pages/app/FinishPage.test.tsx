import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FinishPage from './FinishPage'
import * as queriesModule from '@/features/employee/queries'
import * as consentHookModule from '@/features/employee/useLocationConsent'
import type { LocationConsentState } from '@/features/employee/useLocationConsent'
import * as onlineModule from '@/features/employee/useOnlineStatus'
import type { MyDayAssignment } from '@/api/myDay'

/**
 * EMP-10 · Finalizar con ubicación en vivo (módulo B1, P22.3): mismo panel
 * que el inicio, resultado de la base y re-consentimiento (B-22).
 */
vi.mock('@/components/map', () => ({
  GeofenceMiniMap: (props: { status: string | null }) => (
    <div data-testid="mini-map" data-status={String(props.status)} />
  ),
}))

function assignment(overrides: Partial<MyDayAssignment> = {}): MyDayAssignment {
  return {
    assignmentId: 'a1',
    shiftId: 'sh1',
    shiftDate: '2026-10-14',
    isToday: true,
    clientName: 'Limpia Ya',
    siteName: 'Sede Centro',
    startTime: '08:00:00',
    endTime: '12:00:00',
    openEnded: false,
    noCheckout: false,
    status: 'present',
    shiftStatus: 'scheduled',
    checkInAt: '2026-10-14T11:00:00Z',
    checkOutAt: null,
    tasksDone: 1,
    tasksTotal: 2,
    notes: null,
    requiresPhotos: false,
    myPhotosCount: 0,
    photosNotAllowed: false,
    siteLatitude: -34.6037,
    siteLongitude: -58.3816,
    siteGeofenceRadiusM: 150,
    geofenceMaxAccuracyM: 150,
    checkInGeo: null,
    checkOutGeo: null,
    ...overrides,
  } as MyDayAssignment
}

function consentState(
  overrides: Partial<LocationConsentState> = {},
): LocationConsentState {
  return {
    status: 'granted',
    loading: false,
    reconsent: false,
    consentUpdatedAt: null,
    ...overrides,
  }
}

function mockWatchPosition(
  reading: { latitude: number; longitude: number; accuracy: number } | null,
) {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      watchPosition: (success: (position: unknown) => void) => {
        if (reading) success({ coords: reading, timestamp: Date.now() })
        return 1
      },
      clearWatch: vi.fn(),
    },
  })
}

function Where() {
  const location = useLocation()
  return <p data-testid="where">{location.pathname + location.search}</p>
}

function setup({
  consent = consentState(),
  mutateAsync = vi.fn().mockResolvedValue({}),
  reading = null as {
    latitude: number
    longitude: number
    accuracy: number
  } | null,
} = {}) {
  vi.spyOn(consentHookModule, 'useLocationConsent').mockReturnValue(consent)
  vi.spyOn(onlineModule, 'useOnlineStatus').mockReturnValue(true)
  vi.spyOn(queriesModule, 'useMyDayQuery').mockReturnValue({
    data: [assignment()],
    isLoading: false,
  } as never)
  vi.spyOn(queriesModule, 'useShiftTasksQuery').mockReturnValue({
    data: [],
  } as never)
  vi.spyOn(queriesModule, 'useRecordCheckOutMutation').mockReturnValue({
    mutateAsync,
    isPending: false,
  } as never)
  mockWatchPosition(reading)
  render(
    <MemoryRouter initialEntries={['/app/en-curso/a1/finalizar']}>
      <Routes>
        <Route
          path="/app/en-curso/:assignmentId/finalizar"
          element={<FinishPage />}
        />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
  return { mutateAsync }
}

afterEach(() => vi.restoreAllMocks())

describe('FinishPage · finalizar con ubicación en vivo (módulo B1)', () => {
  it('fuera de la zona: motivo opcional y mejor posición al registrar el fin', async () => {
    const { mutateAsync } = setup({
      reading: { latitude: -34.5937, longitude: -58.3816, accuracy: 20 },
    })

    expect(screen.getByTestId('mini-map')).toHaveAttribute(
      'data-status',
      'outside',
    )
    fireEvent.change(screen.getByLabelText(/por qué estás fuera de la zona/i), {
      target: { value: 'Salí a buscar insumos' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar fin' }))

    await vi.waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        assignmentId: 'a1',
        coords: { lat: -34.5937, lng: -58.3816, accuracyM: 20 },
        outsideReason: 'Salí a buscar insumos',
      }),
    )
  })

  it('precisión mala: el botón dice «Finalizar igual» y no bloquea', () => {
    setup({
      reading: { latitude: -34.6037, longitude: -58.3816, accuracy: 400 },
    })

    expect(
      screen.getByRole('button', { name: 'Esperar mejor señal' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Finalizar igual' }),
    ).toBeEnabled()
  })

  it('sin consentimiento: sin mapa y registra sin coordenadas', async () => {
    const { mutateAsync } = setup({
      consent: consentState({ status: 'declined' }),
      reading: { latitude: -34.6037, longitude: -58.3816, accuracy: 10 },
    })

    expect(screen.queryByTestId('mini-map')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Registrar fin' }))

    await vi.waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        assignmentId: 'a1',
        coords: null,
        outsideReason: null,
      }),
    )
  })

  it('después de registrar el fin muestra el resultado de la base y sigue al resumen', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({
      recordedAt: '2026-10-14T15:01:00Z',
      geo: {
        status: 'valid',
        reason: null,
        distanceM: 12,
        radiusM: 150,
        overridden: false,
      },
    })
    setup({
      mutateAsync,
      reading: { latitude: -34.6037, longitude: -58.3816, accuracy: 10 },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Registrar fin' }))

    expect(await screen.findByText('Fin registrado')).toBeInTheDocument()
    expect(screen.getByText('12:01')).toBeInTheDocument()
    expect(screen.getByText('Validado')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Ver el resumen' }))
    expect(await screen.findByTestId('where')).toHaveTextContent(
      '/app/resumen/a1',
    )
  })

  it('texto de consentimiento nuevo (B-22): vuelve a mostrarlo y regresa a esta pantalla', () => {
    setup({
      consent: consentState({
        status: 'needs-consent',
        reconsent: true,
        consentUpdatedAt: '2026-10-14T12:00:00Z',
      }),
    })

    expect(screen.getByTestId('where')).toHaveTextContent(
      '/app/fichar/consentimiento?volver=%2Fapp%2Fen-curso%2Fa1%2Ffinalizar',
    )
  })
})
