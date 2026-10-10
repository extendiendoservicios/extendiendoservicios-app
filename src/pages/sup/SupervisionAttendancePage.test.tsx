import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SupervisionAttendancePage from './SupervisionAttendancePage'
import * as mySupervisionsModule from '@/api/mySupervisions'
import type { MySupervision } from '@/api/mySupervisions'
import * as authModule from '@/features/auth/AuthProvider'
import type { AuthContextValue } from '@/features/auth/AuthProvider'
import * as settingsModule from '@/features/settings/queries'
import * as onlineModule from '@/features/employee/useOnlineStatus'
import * as locationChoiceModule from '@/features/employee/locationChoice'
import * as geolocationModule from '@/lib/geolocation'

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
  return render(
    <MemoryRouter initialEntries={['/sup/supervisiones/sv1/registro']}>
      <Routes>
        <Route
          path="/sup/supervisiones/:id/registro"
          element={<SupervisionAttendancePage />}
        />
      </Routes>
    </MemoryRouter>,
  )
}

function mockCommon() {
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
    mockCommon()
    vi.spyOn(mySupervisionsModule, 'useMySupervisionQuery').mockReturnValue({
      data: supervision({}),
      isLoading: false,
      isError: false,
    } as never)
    vi.spyOn(authModule, 'useAuth').mockReturnValue(
      authValue({ profile: null }),
    )
    vi.spyOn(locationChoiceModule, 'hasDeclinedLocation').mockReturnValue(false)

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
    vi.spyOn(geolocationModule, 'getCurrentPositionSafe').mockResolvedValue({
      lat: -34.47,
      lng: -58.5,
      accuracyM: 10,
    })
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
        },
      }),
    )

    renderPage()
    screen.getByRole('button', { name: 'Registrar inicio' }).click()

    await vi.waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        supervisionId: 'sv1',
        coords: { lat: -34.47, lng: -58.5, accuracyM: 10 },
      })
    })
  })
})
