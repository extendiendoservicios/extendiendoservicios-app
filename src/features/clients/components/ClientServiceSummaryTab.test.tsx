import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/errors'
import type { ClientServiceSummary } from '@/api/clients'
import { ClientServiceSummaryTab } from './ClientServiceSummaryTab'

const { summaryQueryMock } = vi.hoisted(() => ({
  summaryQueryMock: vi.fn(),
}))

vi.mock('@/features/attendance/queries', () => ({
  useClientUnstartedAssignmentsQuery: () => ({
    data: [],
    isLoading: false,
    isSuccess: true,
    isError: false,
  }),
}))

vi.mock('@/features/employees/queries', () => ({
  useEmployeeDnisQuery: () => ({
    data: new Map([['e1', '30111222']]),
    isLoading: false,
    isError: false,
  }),
}))

vi.mock('@/features/clients/queries', () => ({
  useClientServiceSummaryQuery: summaryQueryMock,
}))

vi.mock('@/features/settings/queries', () => ({
  useCompanySettingsQuery: () => ({
    data: { name: 'Extendiendo Servicios', logoPath: null, supportPhone: null },
  }),
}))

vi.mock('@/features/employees/employeeLeaveStatus', () => ({
  todayInBuenosAires: () => '2026-10-07',
}))

const summary: ClientServiceSummary = {
  clientId: 'c1',
  from: '2026-10-01',
  to: '2026-10-07',
  totals: {
    shiftsDone: 3,
    employeesCount: 2,
    workedMinutes: 750,
    plannedMinutes: 780,
  },
  shifts: [
    {
      shiftId: 's1',
      shiftDate: '2026-10-05',
      siteId: 'site1',
      siteName: 'Munro',
      startTime: '08:00:00',
      endTime: '12:00:00',
      status: 'completed',
      workedMinutes: 240,
      plannedMinutes: 240,
      employees: [
        {
          assignmentId: 'a1',
          employeeId: 'e1',
          firstName: 'Carlos',
          lastName: 'Medina',
          status: 'finished',
          checkInAt: '2026-10-05T11:00:00Z',
          checkOutAt: '2026-10-05T15:00:00Z',
          plannedMinutes: 240,
          workedMinutes: 240,
        },
      ],
    },
  ],
}

function renderTab() {
  render(
    <ClientServiceSummaryTab
      clientId="c1"
      clientName="Logística Central"
      cuit={null}
    />,
  )
}

beforeEach(() => {
  summaryQueryMock.mockReset()
  // `DataTable` decide tabla o tarjetas con `useMediaQuery`.
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
})

describe('ClientServiceSummaryTab (AJ-09)', () => {
  it('pide el mes en curso, muestra las tres tarjetas y el detalle por turno', () => {
    summaryQueryMock.mockReturnValue({ data: summary, isLoading: false })
    renderTab()

    expect(summaryQueryMock).toHaveBeenCalledWith(
      'c1',
      '2026-10-01',
      '2026-10-07',
      true,
    )
    expect(screen.getByText('Turnos realizados')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('Empleados distintos')).toBeInTheDocument()
    expect(screen.getByText('Horas totales')).toBeInTheDocument()
    expect(screen.getByText('12 h 30 min')).toBeInTheDocument()
    expect(screen.getByText('Munro')).toBeInTheDocument()
    expect(screen.getByText('Medina, Carlos')).toBeInTheDocument()
  })

  it('«Descargar resumen» abre la hoja con una sola firma', () => {
    summaryQueryMock.mockReturnValue({ data: summary, isLoading: false })
    renderTab()

    fireEvent.click(screen.getByRole('button', { name: 'Descargar resumen' }))

    expect(
      screen.getByRole('heading', { name: 'Resumen de servicios' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Responsable (administración)')).toBeInTheDocument()
    expect(screen.queryByText('Empleado', { selector: 'p' })).toBeNull()
    // AJ2-16: columnas «Nombre y Apellido» y «DNI» en la hoja.
    expect(
      screen.getByRole('columnheader', { name: 'Nombre y Apellido' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: 'DNI' }),
    ).toBeInTheDocument()
    expect(screen.getByText('30111222')).toBeInTheDocument()
  })

  it('muestra el mensaje del servidor si el resumen falla (CLIENT_NOT_FOUND)', () => {
    summaryQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError('No encontramos a ese cliente.', 'CLIENT_NOT_FOUND'),
    })
    renderTab()

    expect(
      screen.getByText('No encontramos a ese cliente.'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Descargar resumen' }),
    ).toBeDisabled()
  })
})
