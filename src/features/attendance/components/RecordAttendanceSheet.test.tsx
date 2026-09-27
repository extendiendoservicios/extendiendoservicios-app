import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RecordAttendanceSheet } from './RecordAttendanceSheet'

/**
 * ADM-11 (ATT-010, ABS-008): mismo patrón que
 * `src/features/planning/components/AdminTaskList.test.tsx` -- se mockean
 * las mutaciones de `@/features/attendance/queries` (sin red, sin
 * `QueryClientProvider`).
 */
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => {}
}
if (typeof Element.prototype.hasPointerCapture !== 'function') {
  Element.prototype.hasPointerCapture = () => false
}

const {
  adminRecordAttendanceMock,
  closeAssignmentMock,
  notifyDelayMock,
  notifyAbsenceMock,
} = vi.hoisted(() => ({
  adminRecordAttendanceMock: vi.fn().mockResolvedValue(undefined),
  closeAssignmentMock: vi.fn().mockResolvedValue(undefined),
  notifyDelayMock: vi.fn().mockResolvedValue(undefined),
  notifyAbsenceMock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/features/attendance/queries', () => ({
  useAdminRecordAttendanceMutation: () => ({
    mutateAsync: adminRecordAttendanceMock,
    isPending: false,
  }),
  useCloseAssignmentMutation: () => ({
    mutateAsync: closeAssignmentMock,
    isPending: false,
  }),
  useAdminNotifyDelayMutation: () => ({
    mutateAsync: notifyDelayMock,
    isPending: false,
  }),
  useAdminNotifyAbsenceMutation: () => ({
    mutateAsync: notifyAbsenceMock,
    isPending: false,
  }),
}))

describe('RecordAttendanceSheet', () => {
  it('el selector de acción solo ofrece las acciones habilitadas para la asignación', () => {
    render(
      <RecordAttendanceSheet
        assignmentId="a1"
        employeeName="Ana Gómez"
        shiftDate="2026-09-26"
        actions={['check_in', 'delay', 'absence']}
        open
        onOpenChange={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('combobox', { name: 'Elegir acción' }))
    expect(screen.getByRole('option', { name: 'Inicio' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Demora' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Ausencia' })).toBeInTheDocument()
    expect(
      screen.queryByRole('option', { name: 'Fin' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('option', { name: 'Cierre manual' }),
    ).not.toBeInTheDocument()
  })

  it('inicio: exige motivo y llama admin_record_attendance con la hora y el motivo', async () => {
    render(
      <RecordAttendanceSheet
        assignmentId="a1"
        employeeName="Ana Gómez"
        shiftDate="2026-09-26"
        actions={['check_in']}
        open
        onOpenChange={() => {}}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Registrar inicio' }))
    expect(await screen.findByText('Indicá el motivo.')).toBeInTheDocument()
    expect(adminRecordAttendanceMock).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Motivo'), {
      target: { value: 'Se olvidó de fichar' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar inicio' }))

    await waitFor(() => expect(adminRecordAttendanceMock).toHaveBeenCalled())
    expect(adminRecordAttendanceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assignmentId: 'a1',
        kind: 'check_in',
        reason: 'Se olvidó de fichar',
      }),
    )
  })

  it('demora: exige minutos entre 1 y 600', async () => {
    render(
      <RecordAttendanceSheet
        assignmentId="a1"
        employeeName="Ana Gómez"
        shiftDate="2026-09-26"
        actions={['delay']}
        open
        onOpenChange={() => {}}
      />,
    )

    fireEvent.change(screen.getByLabelText('Minutos de demora estimados'), {
      target: { value: '900' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Avisar demora' }))

    expect(
      await screen.findByText('Los minutos tienen que ser de 1 a 600.'),
    ).toBeInTheDocument()
    expect(notifyDelayMock).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Minutos de demora estimados'), {
      target: { value: '15' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Avisar demora' }))

    await waitFor(() => expect(notifyDelayMock).toHaveBeenCalled())
    expect(notifyDelayMock).toHaveBeenCalledWith(
      expect.objectContaining({ assignmentId: 'a1', minutes: 15 }),
    )
  })

  it('ausencia: exige el detalle cuando el motivo es "Otro"', async () => {
    render(
      <RecordAttendanceSheet
        assignmentId="a1"
        employeeName="Ana Gómez"
        shiftDate="2026-09-26"
        actions={['absence']}
        open
        onOpenChange={() => {}}
      />,
    )

    fireEvent.click(screen.getByRole('combobox', { name: 'Elegir motivo' }))
    fireEvent.click(screen.getByRole('option', { name: 'Otro' }))
    fireEvent.click(screen.getByRole('button', { name: 'Avisar ausencia' }))

    expect(
      await screen.findByText('Indicá el motivo de la ausencia.'),
    ).toBeInTheDocument()
    expect(notifyAbsenceMock).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText(/^Detalle/), {
      target: { value: 'Turno médico de urgencia' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Avisar ausencia' }))

    await waitFor(() => expect(notifyAbsenceMock).toHaveBeenCalled())
    expect(notifyAbsenceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assignmentId: 'a1',
        reasonCode: 'other',
        reasonText: 'Turno médico de urgencia',
      }),
    )
  })
})
