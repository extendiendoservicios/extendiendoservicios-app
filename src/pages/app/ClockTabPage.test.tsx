import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ClockTabPage from './ClockTabPage'
import * as queriesModule from '@/features/employee/queries'
import * as consentHookModule from '@/features/employee/useLocationConsent'
import type { LocationConsentState } from '@/features/employee/useLocationConsent'
import * as onlineModule from '@/features/employee/useOnlineStatus'
import type { MyDayAssignment } from '@/api/myDay'

/**
 * EMP-14 / EMP-05 · Fichar el inicio con ubicación en vivo (módulo B1,
 * P22.3): mini mapa, precisión, motivo de «fuera de zona», resultado de la
 * base y re-consentimiento (B-22). El mini mapa se reemplaza por un
 * marcador porque Leaflet no corre en jsdom.
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
    status: 'expected',
    shiftStatus: 'scheduled',
    checkInAt: null,
    checkOutAt: null,
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

function setup({
  consent = consentState(),
  mutateAsync = vi.fn().mockResolvedValue({}),
  reading = null as {
    latitude: number
    longitude: number
    accuracy: number
  } | null,
  item = assignment(),
} = {}) {
  vi.spyOn(consentHookModule, 'useLocationConsent').mockReturnValue(consent)
  vi.spyOn(onlineModule, 'useOnlineStatus').mockReturnValue(true)
  vi.spyOn(queriesModule, 'useMyDayQuery').mockReturnValue({
    data: [item],
    isLoading: false,
    isError: false,
  } as never)
  vi.spyOn(queriesModule, 'useRecordCheckInMutation').mockReturnValue({
    mutateAsync,
    isPending: false,
  } as never)
  mockWatchPosition(reading)
  render(
    <MemoryRouter initialEntries={['/app/fichar']}>
      <Routes>
        <Route path="/app/fichar" element={<ClockTabPage />} />
        <Route
          path="/app/fichar/consentimiento"
          element={<p>Pantalla de consentimiento</p>}
        />
        <Route
          path="/app/en-curso/:assignmentId"
          element={<p>Servicio en curso</p>}
        />
      </Routes>
    </MemoryRouter>,
  )
  return { mutateAsync }
}

afterEach(() => vi.restoreAllMocks())

describe('ClockTabPage · fichar el inicio con ubicación (módulo B1)', () => {
  it('dentro de la sede: mini mapa verde, precisión en vivo y manda la mejor posición', async () => {
    const { mutateAsync } = setup({
      reading: { latitude: -34.6037, longitude: -58.3816, accuracy: 35 },
    })

    expect(screen.getByTestId('mini-map')).toHaveAttribute(
      'data-status',
      'valid',
    )
    expect(screen.getByTestId('geo-accuracy')).toHaveTextContent(
      'Precisión: 35 m',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Registrar inicio' }))

    await vi.waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        assignmentId: 'a1',
        coords: { lat: -34.6037, lng: -58.3816, accuracyM: 35 },
        outsideReason: null,
      }),
    )
  })

  it('fuera de la zona: mapa rojo y el motivo opcional viaja como outsideReason', async () => {
    const { mutateAsync } = setup({
      reading: { latitude: -34.5937, longitude: -58.3816, accuracy: 20 },
    })

    expect(screen.getByTestId('mini-map')).toHaveAttribute(
      'data-status',
      'outside',
    )
    fireEvent.change(screen.getByLabelText(/por qué estás fuera de la zona/i), {
      target: { value: 'El GPS no anda en el subsuelo' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar inicio' }))

    await vi.waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          outsideReason: 'El GPS no anda en el subsuelo',
        }),
      ),
    )
  })

  it('precisión mala: ofrece esperar y «Fichar igual» queda disponible', () => {
    setup({
      item: assignment({ siteGeofenceRadiusM: 100 }),
      reading: { latitude: -34.6037, longitude: -58.3816, accuracy: 250 },
    })

    expect(
      screen.getByRole('button', { name: 'Esperar mejor señal' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fichar igual' })).toBeEnabled()
  })

  it('sin permiso de ubicación: avisa y se puede fichar igual, sin coordenadas', async () => {
    const { mutateAsync } = setup({})
    // `reading: null` equivale a un permiso que nunca responde: no hay posición.
    fireEvent.click(screen.getByRole('button', { name: 'Registrar inicio' }))

    await vi.waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        assignmentId: 'a1',
        coords: null,
        outsideReason: null,
      }),
    )
  })

  it('sin consentimiento (negativa recordada): no hay mapa y registra sin ubicación', async () => {
    const { mutateAsync } = setup({
      consent: consentState({ status: 'declined' }),
      reading: { latitude: -34.6037, longitude: -58.3816, accuracy: 10 },
    })

    expect(screen.queryByTestId('mini-map')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Registrar inicio' }))

    await vi.waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        assignmentId: 'a1',
        coords: null,
        outsideReason: null,
      }),
    )
  })

  it('sede sin coordenadas: sin mapa, aviso y se ficha normal', () => {
    setup({
      item: assignment({ siteLatitude: null, siteLongitude: null }),
      reading: { latitude: -34.6037, longitude: -58.3816, accuracy: 10 },
    })

    expect(screen.queryByTestId('mini-map')).not.toBeInTheDocument()
    expect(screen.getByTestId('geo-message')).toHaveTextContent(
      /no tiene ubicación cargada/,
    )
    expect(
      screen.getByRole('button', { name: 'Registrar inicio' }),
    ).toBeEnabled()
  })

  it('después de fichar muestra lo que devolvió la base y recién ahí pasa al servicio', async () => {
    // El celular veía «dentro» (35 m de precisión sobre la sede), la base resolvió «Fuera de zona».
    const mutateAsync = vi.fn().mockResolvedValue({
      recordedAt: '2026-10-14T11:03:00Z',
      geo: {
        status: 'outside',
        reason: null,
        distanceM: 350,
        radiusM: 150,
        overridden: false,
      },
    })
    setup({
      mutateAsync,
      reading: { latitude: -34.6037, longitude: -58.3816, accuracy: 35 },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Registrar inicio' }))

    expect(await screen.findByText('Inicio registrado')).toBeInTheDocument()
    expect(screen.getByText('08:03')).toBeInTheDocument()
    expect(screen.getByText(/Fuera de zona/)).toHaveTextContent('350 m')
    expect(screen.queryByText('Servicio en curso')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Ir a mi servicio' }))
    expect(await screen.findByText('Servicio en curso')).toBeInTheDocument()
  })

  it('texto de consentimiento nuevo (B-22): vuelve a pedirlo antes de fichar', () => {
    setup({
      consent: consentState({
        status: 'needs-consent',
        reconsent: true,
        consentUpdatedAt: '2026-10-14T12:00:00Z',
      }),
    })

    expect(
      screen.getByText(/Actualizamos el texto del consentimiento/),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Registrar inicio' }),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(screen.getByText('Pantalla de consentimiento')).toBeInTheDocument()
  })

  it('primera vez sin decidir: pide el consentimiento con el texto de siempre', () => {
    setup({ consent: consentState({ status: 'needs-consent' }) })

    expect(
      screen.getByText(
        'Antes de registrar el inicio, te pedimos tu consentimiento de ubicación.',
      ),
    ).toBeInTheDocument()
  })
})
