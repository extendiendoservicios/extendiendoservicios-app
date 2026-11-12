import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { ServiceSummary } from '@/api/services'
import type { ServiceCoverage } from '@/api/serviceCoverage'
import { ServiceList } from './ServiceList'

const SERVICES: ServiceSummary[] = [
  {
    id: 'sv1',
    clientId: 'c1',
    siteId: 'si1',
    siteName: 'Sede Norte',
    name: 'Limpieza',
    weekdays: [1, 3],
    weeksOfMonth: null,
    startTime: '08:00:00',
    endTime: '12:00:00',
    openEnded: false,
    requiredStaff: 2,
    validFrom: '2026-01-01',
    validTo: null,
    status: 'active',
  },
]

const COVERAGE: Record<string, ServiceCoverage> = {
  sv1: {
    fixedEmployees: [
      { employeeId: 'e1', name: 'Ana Gómez' },
      { employeeId: 'e2', name: 'Luis Díaz' },
    ],
    nextShift: {
      id: 'sh1',
      shiftDate: '2099-11-16',
      startTime: '08:00:00',
      endTime: '12:00:00',
      openEnded: false,
      status: 'scheduled',
      requiredStaff: 2,
      assignedCount: 1,
      assignments: [
        { employeeId: 'e1', name: 'Ana Gómez', status: 'expected' },
      ],
    },
  },
}

const coverageMock = vi.hoisted(() => vi.fn())

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ roles: ['admin'], capabilities: [] }),
}))
vi.mock('@/features/services/queries', () => ({
  useServicesByClientQuery: () => ({ data: SERVICES, isLoading: false }),
  useServicesBySiteQuery: () => ({ data: undefined, isLoading: false }),
}))
vi.mock('@/features/services/coverageQueries', () => ({
  useServicesCoverageQuery: coverageMock,
}))

describe('ServiceList: fijos y próximo turno (OF-04)', () => {
  it('muestra los fijos, quién está asignado y marca «Sin cubrir»', () => {
    coverageMock.mockReturnValue({ data: COVERAGE })
    render(
      <MemoryRouter>
        <ServiceList clientId="c1" />
      </MemoryRouter>,
    )
    expect(coverageMock).toHaveBeenCalledWith(['sv1'])
    expect(screen.getByText('Ana Gómez, Luis Díaz')).toBeInTheDocument()
    expect(screen.getByText(/Próximo/)).toBeInTheDocument()
    expect(screen.getByText('Sin cubrir')).toBeInTheDocument()
    expect(screen.getByText('Faltan 1 de 2.')).toBeInTheDocument()
    expect(screen.getByText('Esperado')).toBeInTheDocument()
  })

  it('sin turno cercano avisa que no hay turnos', () => {
    coverageMock.mockReturnValue({
      data: { sv1: { fixedEmployees: [], nextShift: null } },
    })
    render(
      <MemoryRouter>
        <ServiceList clientId="c1" />
      </MemoryRouter>,
    )
    expect(screen.getByText('Fijos:')).toBeInTheDocument()
    expect(
      screen.getByText('Sin turnos en los próximos 35 días.'),
    ).toBeInTheDocument()
  })
})
