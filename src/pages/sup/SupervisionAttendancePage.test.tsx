import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SupervisionAttendancePage from './SupervisionAttendancePage'
import * as mySupervisionsModule from '@/api/mySupervisions'
import type { MySupervision } from '@/api/mySupervisions'
import * as authModule from '@/features/auth/AuthProvider'
import type { AuthContextValue } from '@/features/auth/AuthProvider'
import * as settingsModule from '@/features/settings/queries'
import * as onlineModule from '@/features/employee/useOnlineStatus'
import * as consentHookModule from '@/features/employee/useLocationConsent'
import type { LocationConsentState } from '@/features/employee/useLocationConsent'

// Leaflet no corre en jsdom: el mini mapa del fichaje (módulo B1) se
// reemplaza por un marcador que deja ver el color del círculo de la sede.
vi.mock('@/components/map', () => ({
  GeofenceMiniMap: (props: { status: string | null }) => (
    <div data-testid="mini-map" data-status={String(props.status)} />
  ),
}))

/**
 * El bloque «Fotos y videos» (módulo H, P21.3) tiene sus propios tests en
 * `ShiftMediaSection.test.tsx`: acá se reemplaza por un marcador con las
 * propiedades que recibe.
 */
vi.mock('@/features/employee/components/LazyShiftMediaSection', () => ({
  LazyShiftMediaSection: (props: {
    shiftId: string
    counts: { photos: number; videos: number }
    requiresPhotos: boolean
    photosNotAllowed: boolean
  }) => (
    <div
      data-testid="media-section"
      data-shift={props.shiftId}
      data-photos={props.counts.photos}
      data-videos={props.counts.videos}
      data-requires={String(props.requiresPhotos)}
      data-not-allowed={String(props.photosNotAllowed)}
    />
  ),
}))

/**
 * SUP-04 (MOB-SUP-005): pide el consentimiento de ubicación (reutilizado de
 * EMP-06) cuando todavía no está resuelto, muestra "Registrar inicio" sin
 * inicio propio y "Registrar fin" con el inicio ya registrado. La hora que
 * vale es la que devuelve la RPC, nunca la del dispositivo -- estos tests
 * no verifican esa hora (la pone `mySupervisionCheckIn`/`Out`, ya probado en
 * `src/api/mySupervisions.test.ts`), solo qué pantalla corresponde mostrar.
 */
function supervision(overrides: Partial<MySupervision>): MySupervision {
  return {
    id: 'sv1',
    shiftId: 'sh1',
    shiftDate: '2026-09-27',
    isToday: true,
    clientId: 'c1',
    clientName: 'Limpiadora SRL',
    siteId: 'si1',
    siteName: 'Sede Centro',
    siteAddress: 'Av. Siempre Viva 123',
    siteCity: 'San Isidro',
    siteLatitude: -34.47,
    siteLongitude: -58.5,
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
    startsAt: null,
    endsAt: null,
    shiftOpenEnded: false,
    status: 'assigned',
    assignedAt: '2026-09-20T10:00:00Z',
    notDoneReason: null,
    cancelReason: null,
    generalNotes: null,
    criteriaSnapshot: null,
    checkInAt: null,
    checkOutAt: null,
    siteGeofenceRadiusM: 150,
    geofenceMaxAccuracyM: 150,
    checkInGeo: null,
    checkOutGeo: null,
    assignedEmployees: [],
    ...overrides,
  }
}

function authValue(overrides: Partial<AuthContextValue>): AuthContextValue {
  return {
    status: 'authenticated',
    userId: 'user-1',
    email: 'marta.rios@extendiendoservicios.com',
    roles: ['supervisor'],
    capabilities: [],
    profile: null,
    displayName: 'Marta Ríos',
    isPasswordRecovery: false,
    signOut: vi.fn(),
    refreshProfile: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/sup/supervisiones/sv1/registro']}>
        <Routes>
          <Route
            path="/sup/supervisiones/:id/registro"
            element={<SupervisionAttendancePage />}
          />
          <Route
            path="/sup/supervisiones/:id"
            element={<p>Detalle de la supervisión</p>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** Estado del consentimiento (B-22) que devuelve `useLocationConsent` en cada caso. */
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

/** Simula la geolocalización del navegador: entrega una lectura apenas se empieza a seguir. */
function mockWatchPosition(
  reading: { latitude: number; longitude: number; accuracy: number } | null,
) {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      watchPosition: (success: (position: unknown) => void) => {
        if (reading) {
          success({ coords: reading, timestamp: Date.now() })
        }
        return 1
      },
      clearWatch: vi.fn(),
    },
  })
}

function mockCommon(consent: LocationConsentState = consentState()) {
  vi.spyOn(consentHookModule, 'useLocationConsent').mockReturnValue(consent)
  mockWatchPosition(null)
  vi.spyOn(settingsModule, 'useCompanySettingsQuery').mockReturnValue({
    data: { locationConsentText: 'Guardamos tu ubicación al fichar.' },
  } as never)
  vi.spyOn(onlineModule, 'useOnlineStatus').mockReturnValue(true)
  vi.spyOn(
    mySupervisionsModule,
    'useSupervisionCheckInMutation',
  ).mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never)
  vi.spyOn(
    mySupervisionsModule,
    'useSupervisionCheckOutMutation',
  ).mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SupervisionAttendancePage (SUP-04)', () => {
  it('pide el consentimiento de ubicación cuando todavía no está resuelto', () => {
    mockCommon(consentState({ status: 'needs-consent' }))
    vi.spyOn(mySupervisionsModule, 'useMySupervisionQuery').mockReturnValue({
      data: supervision({}),
      isLoading: false,
      isError: false,
    } as never)
    vi.spyOn(authModule, 'useAuth').mockReturnValue(
      authValue({ profile: null }),
    )

    renderPage()

    expect(screen.getByText('Tu ubicación al fichar')).toBeInTheDocument()
    expect(
      screen.getByText('Guardamos tu ubicación al fichar.'),
    ).toBeInTheDocument()
  })

  it('muestra "Registrar inicio" cuando el consentimiento ya está resuelto y no hay inicio propio', () => {
    mockCommon()
    vi.spyOn(mySupervisionsModule, 'useMySupervisionQuery').mockReturnValue({
      data: supervision({}),
      isLoading: false,
      isError: false,
    } as never)
    vi.spyOn(authModule, 'useAuth').mockReturnValue(
      authValue({
        profile: {
          id: 'user-1',
          firstName: 'Marta',
          lastName: 'Ríos',
          displayName: 'Marta Ríos',
          contactEmail: null,
          phone: null,
          avatarPath: null,
          locationConsentAt: '2026-09-01T00:00:00Z',
          highContrast: false,
        },
      }),
    )

    renderPage()

    expect(
      screen.getByRole('button', { name: 'Registrar inicio' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Limpiadora SRL')).toBeInTheDocument()
  })

  it('muestra la hora de inicio y "Registrar fin" cuando ya se registró el inicio', () => {
    mockCommon()
    vi.spyOn(mySupervisionsModule, 'useMySupervisionQuery').mockReturnValue({
      data: supervision({
        status: 'in_progress',
        checkInAt: '2026-09-27T11:05:00Z',
      }),
      isLoading: false,
      isError: false,
    } as never)
    vi.spyOn(authModule, 'useAuth').mockReturnValue(
      authValue({
        profile: {
          id: 'user-1',
          firstName: 'Marta',
          lastName: 'Ríos',
          displayName: 'Marta Ríos',
          contactEmail: null,
          phone: null,
          avatarPath: null,
          locationConsentAt: '2026-09-01T00:00:00Z',
          highContrast: false,
        },
      }),
    )

    renderPage()

    expect(
      screen.getByRole('button', { name: 'Registrar fin' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Supervisión iniciada a las/)).toBeInTheDocument()
  })

  it('llama a la RPC de inicio con las coordenadas al confirmar', async () => {
    mockCommon()
    const mutateAsync = vi.fn().mockResolvedValue({})
    vi.spyOn(
      mySupervisionsModule,
      'useSupervisionCheckInMutation',
    ).mockReturnValue({ mutateAsync, isPending: false } as never)
    mockWatchPosition({ latitude: -34.47, longitude: -58.5, accuracy: 10 })
    vi.spyOn(mySupervisionsModule, 'useMySupervisionQuery').mockReturnValue({
      data: supervision({}),
      isLoading: false,
      isError: false,
    } as never)
    vi.spyOn(authModule, 'useAuth').mockReturnValue(
      authValue({
        profile: {
          id: 'user-1',
          firstName: 'Marta',
          lastName: 'Ríos',
          displayName: 'Marta Ríos',
          contactEmail: null,
          phone: null,
          avatarPath: null,
          locationConsentAt: '2026-09-01T00:00:00Z',
          highContrast: false,
        },
      }),
    )

    renderPage()
    screen.getByRole('button', { name: 'Registrar inicio' }).click()

    await vi.waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        supervisionId: 'sv1',
        coords: { lat: -34.47, lng: -58.5, accuracyM: 10 },
        outsideReason: null,
      })
    })
  })
})

describe('SupervisionAttendancePage · fotos y videos (módulo H, P21.3)', () => {
  const profile = {
    id: 'user-1',
    firstName: 'Marta',
    lastName: 'Ríos',
    displayName: 'Marta Ríos',
    contactEmail: null,
    phone: null,
    avatarPath: null,
    locationConsentAt: '2026-09-01T00:00:00Z',
    highContrast: false,
  }

  it('con el inicio registrado ofrece el bloque con los contadores de la supervisión', () => {
    mockCommon()
    vi.spyOn(mySupervisionsModule, 'useMySupervisionQuery').mockReturnValue({
      data: supervision({
        status: 'in_progress',
        checkInAt: '2026-09-27T11:05:00Z',
        requiresPhotos: true,
        myPhotosCount: 4,
        myVideosCount: 1,
      }),
      isLoading: false,
      isError: false,
    } as never)
    vi.spyOn(authModule, 'useAuth').mockReturnValue(authValue({ profile }))

    renderPage()

    const section = screen.getByTestId('media-section')
    expect(section).toHaveAttribute('data-shift', 'sh1')
    expect(section).toHaveAttribute('data-photos', '4')
    expect(section).toHaveAttribute('data-videos', '1')
    expect(section).toHaveAttribute('data-requires', 'true')
  })

  it('antes del inicio no muestra el bloque: esa pantalla es solo registrar', () => {
    mockCommon()
    vi.spyOn(mySupervisionsModule, 'useMySupervisionQuery').mockReturnValue({
      data: supervision({}),
      isLoading: false,
      isError: false,
    } as never)
    vi.spyOn(authModule, 'useAuth').mockReturnValue(authValue({ profile }))

    renderPage()

    expect(screen.queryByTestId('media-section')).not.toBeInTheDocument()
  })
})

const PROFILE = {
  id: 'user-1',
  firstName: 'Marta',
  lastName: 'Ríos',
  displayName: 'Marta Ríos',
  contactEmail: null,
  phone: null,
  avatarPath: null,
  locationConsentAt: '2026-09-01T00:00:00Z',
  highContrast: false,
}

describe('SupervisionAttendancePage · geolocalización (módulo B1, P22.3)', () => {
  function mockSupervision(overrides: Partial<MySupervision> = {}) {
    vi.spyOn(mySupervisionsModule, 'useMySupervisionQuery').mockReturnValue({
      data: supervision(overrides),
      isLoading: false,
      isError: false,
    } as never)
    vi.spyOn(authModule, 'useAuth').mockReturnValue(
      authValue({ profile: PROFILE }),
    )
  }

  it('dentro de la sede: mini mapa verde y precisión en vivo', () => {
    mockCommon()
    mockWatchPosition({ latitude: -34.47, longitude: -58.5, accuracy: 35 })
    mockSupervision()

    renderPage()

    expect(screen.getByTestId('mini-map')).toHaveAttribute(
      'data-status',
      'valid',
    )
    expect(screen.getByTestId('geo-accuracy')).toHaveTextContent(
      'Precisión: 35 m',
    )
    expect(
      screen.queryByLabelText(/por qué estás fuera de la zona/i),
    ).not.toBeInTheDocument()
  })

  it('fuera de la zona: pide el motivo opcional y lo manda al registrar', async () => {
    mockCommon()
    mockWatchPosition({ latitude: -34.4, longitude: -58.5, accuracy: 20 })
    const mutateAsync = vi.fn().mockResolvedValue({
      recordedAt: '2026-09-27T11:00:00Z',
      geo: null,
    })
    vi.spyOn(
      mySupervisionsModule,
      'useSupervisionCheckInMutation',
    ).mockReturnValue({ mutateAsync, isPending: false } as never)
    mockSupervision()

    renderPage()

    expect(screen.getByTestId('mini-map')).toHaveAttribute(
      'data-status',
      'outside',
    )
    fireEvent.change(screen.getByLabelText(/por qué estás fuera de la zona/i), {
      target: { value: 'Estoy en la entrada de servicio' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar inicio' }))

    await vi.waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        supervisionId: 'sv1',
        coords: { lat: -34.4, lng: -58.5, accuracyM: 20 },
        outsideReason: 'Estoy en la entrada de servicio',
      })
    })
  })

  it('con la señal todavía imprecisa ofrece esperar y el botón dice «Fichar igual»', () => {
    mockCommon()
    mockWatchPosition({ latitude: -34.47, longitude: -58.5, accuracy: 400 })
    mockSupervision({ siteGeofenceRadiusM: 100 })

    renderPage()

    expect(
      screen.getByRole('button', { name: 'Esperar mejor señal' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fichar igual' })).toBeEnabled()
  })

  it('al registrar el fin con la señal imprecisa el botón dice «Finalizar igual»', () => {
    mockCommon()
    mockWatchPosition({ latitude: -34.47, longitude: -58.5, accuracy: 400 })
    mockSupervision({
      siteGeofenceRadiusM: 100,
      checkInAt: '2026-09-27T11:05:00Z',
    })

    renderPage()

    expect(
      screen.getByRole('button', { name: 'Finalizar igual' }),
    ).toBeEnabled()
  })

  it('sin consentimiento vigente no pide la ubicación y deja registrar sin validar', () => {
    mockCommon(consentState({ status: 'declined' }))
    mockSupervision()

    renderPage()

    expect(screen.queryByTestId('mini-map')).not.toBeInTheDocument()
    expect(screen.getByTestId('geo-message')).toHaveTextContent(
      /queda sin validar/,
    )
    expect(
      screen.getByRole('button', { name: 'Registrar inicio' }),
    ).toBeEnabled()
  })

  it('después de registrar el inicio muestra lo que devolvió la base, no lo calculado en el celular', async () => {
    mockCommon()
    // En el celular se ve «dentro», pero la base resolvió «Fuera de zona» (350 m).
    mockWatchPosition({ latitude: -34.47, longitude: -58.5, accuracy: 10 })
    const mutateAsync = vi.fn().mockResolvedValue({
      recordedAt: '2026-09-27T11:00:00Z',
      geo: {
        status: 'outside',
        reason: null,
        distanceM: 350,
        radiusM: 150,
        overridden: false,
      },
    })
    vi.spyOn(
      mySupervisionsModule,
      'useSupervisionCheckInMutation',
    ).mockReturnValue({ mutateAsync, isPending: false } as never)
    mockSupervision()

    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Registrar inicio' }))

    expect(await screen.findByText('Inicio registrado')).toBeInTheDocument()
    expect(screen.getByText(/Fuera de zona/)).toHaveTextContent('350 m')
    expect(screen.getByText('08:00')).toBeInTheDocument()
  })

  it('después de registrar el fin muestra el resultado y vuelve al detalle', async () => {
    mockCommon()
    const mutateAsync = vi.fn().mockResolvedValue({
      recordedAt: '2026-09-27T15:00:00Z',
      geo: {
        status: 'unvalidated',
        reason: 'no_location',
        distanceM: null,
        radiusM: 150,
        overridden: false,
      },
    })
    vi.spyOn(
      mySupervisionsModule,
      'useSupervisionCheckOutMutation',
    ).mockReturnValue({ mutateAsync, isPending: false } as never)
    mockSupervision({
      status: 'in_progress',
      checkInAt: '2026-09-27T11:05:00Z',
    })

    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Registrar fin' }))

    expect(await screen.findByText('Fin registrado')).toBeInTheDocument()
    expect(screen.getByText(/Sin validar/)).toHaveTextContent('sin ubicación')
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(
      await screen.findByText('Detalle de la supervisión'),
    ).toBeInTheDocument()
  })

  it('si el texto del consentimiento cambió, lo vuelve a mostrar aunque el inicio ya esté registrado (B-22)', () => {
    mockCommon(
      consentState({
        status: 'needs-consent',
        reconsent: true,
        consentUpdatedAt: '2026-10-14T12:00:00Z',
      }),
    )
    mockSupervision({
      status: 'in_progress',
      checkInAt: '2026-09-27T11:05:00Z',
    })

    renderPage()

    expect(screen.getByText('Tu ubicación al fichar')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Registrar fin' }),
    ).not.toBeInTheDocument()
  })

  it('con el inicio registrado y sin decisión previa no vuelve a preguntar: el fin va sin ubicación', () => {
    mockCommon(consentState({ status: 'needs-consent', reconsent: false }))
    mockSupervision({
      status: 'in_progress',
      checkInAt: '2026-09-27T11:05:00Z',
    })

    renderPage()

    expect(
      screen.getByRole('button', { name: 'Registrar fin' }),
    ).toBeInTheDocument()
  })
})
