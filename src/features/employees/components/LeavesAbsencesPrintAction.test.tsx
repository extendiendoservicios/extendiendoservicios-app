import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LeavesAbsencesPrintAction } from './LeavesAbsencesPrintAction'

/**
 * P19.11d: desde la ficha se elige el período y se abre la hoja imprimible con
 * las licencias y las ausencias. Se mockean las consultas (sin red).
 */

vi.mock('@/features/employees/queries', () => ({
  useEmployeeLeavesQuery: () => ({
    isLoading: false,
    isError: false,
    data: [
      {
        id: 'l1',
        startsOn: '2026-03-02',
        endsOn: '2026-03-06',
        reason: 'Vacaciones',
        deletedAt: null,
      },
    ],
  }),
}))

vi.mock('@/features/attendance/queries', () => ({
  useEmployeeAttendanceHistoryQuery: () => ({
    isLoading: false,
    isError: false,
    data: [
      {
        id: 'a1',
        shiftId: 'sh1',
        shiftDate: '2026-05-12',
        shiftStatus: 'completed',
        clientName: 'Limpia Ya SRL',
        siteName: 'Sede Centro',
        startTime: '08:00:00',
        endTime: '12:00:00',
        openEnded: false,
        status: 'absence_notified',
        removedAt: null,
        lastNoticeKind: 'absence',
        lastNoticeReasonCode: 'illness',
        lastNoticeReasonText: null,
        lastNoticeHasCertificate: true,
        lastNoticeSource: 'employee_app',
        lastNoticeReportedBy: 'e1',
      },
    ],
  }),
  usePeopleNamesQuery: () => ({ isLoading: false, data: new Map() }),
}))

vi.mock('@/features/settings/queries', () => ({
  useCompanySettingsQuery: () => ({
    data: { name: 'Extendiendo Servicios', logoPath: null, supportPhone: null },
  }),
}))

vi.mock('@/features/employees/employeeLeaveStatus', () => ({
  todayInBuenosAires: () => '2026-10-20',
}))

vi.mock('@/components/DatePicker', () => ({
  DatePicker: ({
    'aria-label': label,
    value,
  }: {
    'aria-label': string
    value?: Date
  }) => (
    <input
      readOnly
      aria-label={label}
      value={value ? value.toLocaleDateString('es-AR') : ''}
    />
  ),
}))

describe('LeavesAbsencesPrintAction', () => {
  it('abre el período del año en curso y muestra la hoja con licencias y ausencias', () => {
    render(
      <LeavesAbsencesPrintAction
        profileId="e1"
        person={{
          name: 'Ana Gómez',
          dni: '30111222',
          employeeNumber: 7,
          roleLabels: ['Empleado'],
          signerLabel: 'Empleado',
        }}
      />,
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Imprimir licencias y ausencias' }),
    )
    expect(screen.getByLabelText('Desde')).toHaveValue('1/1/2026')
    expect(screen.getByLabelText('Hasta')).toHaveValue('31/12/2026')

    fireEvent.click(screen.getByRole('button', { name: 'Ver hoja' }))

    expect(
      screen.getByRole('dialog', { name: /Licencias y ausencias/ }),
    ).toBeInTheDocument()
    expect(screen.getByText('Vacaciones')).toBeInTheDocument()
    expect(screen.getByText('Con certificado')).toBeInTheDocument()
    expect(screen.getByText('Limpia Ya SRL')).toBeInTheDocument()
    expect(screen.getByText('Editar texto')).toBeInTheDocument()
    expect(screen.getByText('El propio empleado')).toBeInTheDocument()
    // Mismo bloque de conformidad y firmas que el detalle de asistencia.
    expect(screen.getByText('Rol:')).toBeInTheDocument()
    expect(screen.getByText(/prestan conformidad/)).toBeInTheDocument()
    expect(screen.getByText('Responsable (administración)')).toBeInTheDocument()
    expect(screen.getAllByText('Aclaración')).toHaveLength(2)
  })
})
