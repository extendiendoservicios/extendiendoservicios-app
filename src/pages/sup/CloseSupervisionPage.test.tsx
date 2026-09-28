import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CloseSupervisionPage from './CloseSupervisionPage'
import * as mySupervisionsModule from '@/api/mySupervisions'
import type { MySupervision } from '@/api/mySupervisions'
import * as authModule from '@/features/auth/AuthProvider'
import type { AuthContextValue } from '@/features/auth/AuthProvider'
import * as onlineModule from '@/features/employee/useOnlineStatus'

/**
 * SUP-06 (MOB-SUP-007): "Completar" exige fin registrado (si falta, ofrece
 * ir a registrarlo en vez del botón) y avisa si faltan empleados por
 * calificar sin bloquear; "No se pudo realizar" pide motivo obligatorio y
 * no exige fin registrado (`06` sección 12).
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
    endsAt: '2030-01-01T12:00:00Z',
    status: 'in_progress',
    assignedAt: '2026-09-20T10:00:00Z',
    notDoneReason: null,
    cancelReason: null,
    generalNotes: null,
    criteriaSnapshot: null,
    checkInAt: '2026-09-27T11:00:00Z',
    checkOutAt: null,
    assignedEmployees: [
      {
        employeeId: 'e1',
        firstName: 'Ana',
        lastName: 'Gómez',
        status: 'present',
        checkInAt: '2026-09-27T11:05:00Z',
      },
    ],
    ...overrides,
  }
}

function authValue(overrides: Partial<AuthContextValue>): AuthContextValue {
  return {
    status: 'authenticated',
    userId: 'sup-1',
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
    <MemoryRouter initialEntries={['/sup/supervisiones/sv1/cerrar']}>
      <Routes>
        <Route
          path="/sup/supervisiones/:id/cerrar"
          element={<CloseSupervisionPage />}
        />
      </Routes>
    </MemoryRouter>,
  )
}

function mockCommon() {
  vi.spyOn(onlineModule, 'useOnlineStatus').mockReturnValue(true)
  vi.spyOn(authModule, 'useAuth').mockReturnValue(authValue({}))
  vi.spyOn(mySupervisionsModule, 'useSupervisionRatingsQuery').mockReturnValue({
    data: [],
  } as never)
  vi.spyOn(
    mySupervisionsModule,
    'useCompleteSupervisionMutation',
  ).mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  } as never)
  vi.spyOn(
    mySupervisionsModule,
    'useMarkSupervisionNotDoneMutation',
  ).mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  } as never)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('CloseSupervisionPage (SUP-06)', () => {
  it('sin fin registrado, ofrece ir a registrarlo en vez de "Completar supervisión"', () => {
    mockCommon()
    vi.spyOn(mySupervisionsModule, 'useMySupervisionQuery').mockReturnValue({
      data: supervision({ checkOutAt: null }),
      isLoading: false,
      isError: false,
    } as never)

    renderPage()
    // Sin fin registrado la pestaña inicial es "No se pudo realizar" (la
    // alternativa que no lo exige): se elige "Completar" a propósito para
    // este caso.
    fireEvent.click(screen.getByRole('radio', { name: 'Completar' }))

    expect(
      screen.getByText(/Todavía no registraste el fin de la supervisión/),
    ).toBeInTheDocument()
    const link = screen.getByText('Registrar fin de supervisión').closest('a')
    expect(link).toHaveAttribute('href', '/sup/supervisiones/sv1/registro')
    expect(
      screen.getByRole('button', { name: 'Completar supervisión' }),
    ).toBeDisabled()
  })

  it('con fin registrado y empleados sin calificar, avisa pero permite completar igual', () => {
    mockCommon()
    const mutateAsync = vi.fn().mockResolvedValue({})
    vi.spyOn(
      mySupervisionsModule,
      'useCompleteSupervisionMutation',
    ).mockReturnValue({ mutateAsync, isPending: false } as never)
    vi.spyOn(mySupervisionsModule, 'useMySupervisionQuery').mockReturnValue({
      data: supervision({ checkOutAt: '2026-09-27T12:00:00Z' }),
      isLoading: false,
      isError: false,
    } as never)

    renderPage()

    expect(
      screen.getByText('Calificaste a 0 de 1 empleado.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Faltan 1 empleado por calificar/),
    ).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: 'Completar supervisión' }),
    )
    expect(mutateAsync).toHaveBeenCalledWith({
      supervisionId: 'sv1',
      generalNotes: undefined,
    })
  })

  it('"No se pudo realizar" exige el motivo antes de guardar', () => {
    mockCommon()
    const mutateAsync = vi.fn().mockResolvedValue({})
    vi.spyOn(
      mySupervisionsModule,
      'useMarkSupervisionNotDoneMutation',
    ).mockReturnValue({ mutateAsync, isPending: false } as never)
    vi.spyOn(mySupervisionsModule, 'useMySupervisionQuery').mockReturnValue({
      data: supervision({ checkInAt: null, checkOutAt: null }),
      isLoading: false,
      isError: false,
    } as never)

    renderPage()

    fireEvent.click(
      screen.getByRole('button', { name: 'Marcar como no realizada' }),
    )
    expect(screen.getByText('Indicá el motivo.')).toBeInTheDocument()
    expect(mutateAsync).not.toHaveBeenCalled()

    fireEvent.change(screen.getByPlaceholderText('Motivo…'), {
      target: { value: 'El cliente cerró la sede' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Marcar como no realizada' }),
    )
    expect(mutateAsync).toHaveBeenCalledWith({
      supervisionId: 'sv1',
      reason: 'El cliente cerró la sede',
    })
  })

  it('no ofrece nada para cerrar cuando la supervisión ya está completada', () => {
    mockCommon()
    vi.spyOn(mySupervisionsModule, 'useMySupervisionQuery').mockReturnValue({
      data: supervision({ status: 'completed' }),
      isLoading: false,
      isError: false,
    } as never)

    renderPage()

    expect(
      screen.queryByRole('button', { name: 'Completar supervisión' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Marcar como no realizada' }),
    ).not.toBeInTheDocument()
  })
})
