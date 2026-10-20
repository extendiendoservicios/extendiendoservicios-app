import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AttendanceBoardRow } from '@/api/attendance'
import { AssignmentAttendanceDetail } from './AssignmentAttendanceDetail'

/**
 * P19.11d: botón «Ausente» del detalle del turno y estado de la ausencia con
 * su certificado. Se mockean las mutaciones y las consultas (sin red).
 */
const { notifyAbsenceMock, setCertificateMock } = vi.hoisted(() => ({
  notifyAbsenceMock: vi.fn().mockResolvedValue(undefined),
  setCertificateMock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/features/attendance/queries', () => ({
  useAdminRecordAttendanceMutation: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useCloseAssignmentMutation: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useAdminNotifyDelayMutation: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useAdminNotifyAbsenceMutation: () => ({
    mutateAsync: notifyAbsenceMock,
    isPending: false,
  }),
  useSetAbsenceCertificateMutation: () => ({
    mutateAsync: setCertificateMock,
    isPending: false,
  }),
}))

vi.mock('@/features/geo/queries', () => ({
  useAttendanceCorrectionsQuery: () => ({ data: [] }),
}))

function makeRow(overrides: Partial<AttendanceBoardRow>): AttendanceBoardRow {
  return {
    id: 'a1',
    shiftStatus: 'assigned',
    status: 'expected',
    checkInAt: null,
    checkOutAt: null,
    startsAt: '2099-01-01T11:00:00Z',
    lastNoticeKind: null,
    lastNoticeHasCertificate: null,
    ...overrides,
  } as AttendanceBoardRow
}

function renderDetail(
  attendance: AttendanceBoardRow | undefined,
  canManage = true,
) {
  render(
    <AssignmentAttendanceDetail
      assignmentId="a1"
      employeeName="Ana Gómez"
      shiftDate="2099-01-01"
      attendance={attendance}
      events={[]}
      peopleNames={new Map()}
      canManage={canManage}
    />,
  )
}

describe('AssignmentAttendanceDetail: Ausente', () => {
  it('ofrece «Ausente» si no hay inicio ni ausencia avisada', () => {
    renderDetail(makeRow({}))
    expect(screen.getByRole('button', { name: 'Ausente' })).toBeInTheDocument()
  })

  it('no lo ofrece si el turno está cancelado, ya hay inicio o falta el permiso', () => {
    renderDetail(makeRow({ shiftStatus: 'cancelled' }))
    expect(
      screen.queryByRole('button', { name: 'Ausente' }),
    ).not.toBeInTheDocument()
  })

  it('no lo ofrece con fichaje de inicio', () => {
    renderDetail(
      makeRow({ status: 'present', checkInAt: '2099-01-01T11:02:00Z' }),
    )
    expect(
      screen.queryByRole('button', { name: 'Ausente' }),
    ).not.toBeInTheDocument()
  })

  it('no lo ofrece sin manage_attendance', () => {
    renderDetail(makeRow({}), false)
    expect(
      screen.queryByRole('button', { name: 'Ausente' }),
    ).not.toBeInTheDocument()
  })

  it('obliga a elegir el certificado y llama a notify_absence', async () => {
    notifyAbsenceMock.mockClear()
    renderDetail(makeRow({}))
    fireEvent.click(screen.getByRole('button', { name: 'Ausente' }))

    fireEvent.click(screen.getByRole('button', { name: 'Marcar ausente' }))
    expect(
      await screen.findByText('Indicá si la ausencia tiene certificado.'),
    ).toBeInTheDocument()
    expect(notifyAbsenceMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('radio', { name: 'Con certificado' }))
    fireEvent.click(screen.getByRole('button', { name: 'Marcar ausente' }))
    await waitFor(() => expect(notifyAbsenceMock).toHaveBeenCalled())
    expect(notifyAbsenceMock).toHaveBeenCalledWith(
      expect.objectContaining({ assignmentId: 'a1', hasCertificate: true }),
    )
  })
})

describe('AssignmentAttendanceDetail: ausencia ya avisada', () => {
  it('muestra «con certificado» y la acción «Cambiar» en lugar de «Ausente»', () => {
    renderDetail(
      makeRow({
        status: 'absence_notified',
        lastNoticeKind: 'absence',
        lastNoticeHasCertificate: true,
      }),
    )
    expect(screen.getByText('Ausente · con certificado')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cambiar' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Ausente' }),
    ).not.toBeInTheDocument()
  })

  it('con certificado sin indicar ofrece «Marcar certificado» y llama a set_absence_certificate', async () => {
    setCertificateMock.mockClear()
    renderDetail(
      makeRow({
        status: 'absence_notified',
        lastNoticeKind: 'absence',
        lastNoticeHasCertificate: null,
      }),
    )
    expect(
      screen.getByText('Ausente · certificado sin indicar'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Marcar certificado' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Sin certificado' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(setCertificateMock).toHaveBeenCalled())
    expect(setCertificateMock).toHaveBeenCalledWith({
      assignmentId: 'a1',
      hasCertificate: false,
    })
  })
})
