import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServiceDeletePreview } from '@/api/services'
import { ApiError } from '@/api/errors'
import {
  DeleteServiceDialog,
  describeBlockingReasons,
} from './DeleteServiceDialog'

const { previewMock, mutateAsyncMock, toastSuccess, toastError } = vi.hoisted(
  () => ({
    previewMock: vi.fn(),
    mutateAsyncMock: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
  }),
)

vi.mock('@/features/services/queries', () => ({
  useServiceDeletePreviewQuery: previewMock,
  useDeleteServiceMutation: () => ({
    mutateAsync: mutateAsyncMock,
    isPending: false,
  }),
}))

vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: toastError },
}))

const service = { id: 's1', name: 'Limpieza mañana' }

function preview(overrides: Partial<ServiceDeletePreview>) {
  previewMock.mockReturnValue({
    data: {
      serviceId: 's1',
      serviceName: 'Limpieza mañana',
      shiftsToDelete: 12,
      assignmentsToDelete: 20,
      blockingShifts: [],
      canDelete: true,
      ...overrides,
    },
    isLoading: false,
    isError: false,
  })
}

beforeEach(() => {
  previewMock.mockReset()
  mutateAsyncMock.mockReset()
  toastSuccess.mockReset()
  toastError.mockReset()
})

describe('DeleteServiceDialog', () => {
  it('si se puede, cuenta turnos y asignaciones y elimina al confirmar', async () => {
    preview({})
    mutateAsyncMock.mockResolvedValue({})
    const onDeleted = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <DeleteServiceDialog
        service={service}
        open
        onOpenChange={onOpenChange}
        onDeleted={onDeleted}
        onDeactivate={vi.fn()}
      />,
    )

    expect(
      screen.getByText(
        'Se van a eliminar el servicio, 12 turnos y 20 asignaciones. No se puede deshacer.',
      ),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Dar de baja' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar servicio' }))

    await waitFor(() => expect(onDeleted).toHaveBeenCalled())
    expect(mutateAsyncMock).toHaveBeenCalledWith('s1')
    expect(toastSuccess).toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('muestra el mensaje del servidor si falla al eliminar', async () => {
    preview({})
    mutateAsyncMock.mockRejectedValue(
      new ApiError('No se puede eliminar', 'SERVICE_HAS_ATTENDANCE'),
    )
    const onDeleted = vi.fn()
    render(
      <DeleteServiceDialog
        service={service}
        open
        onOpenChange={vi.fn()}
        onDeleted={onDeleted}
        onDeactivate={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar servicio' }))
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('No se puede eliminar'),
    )
    expect(onDeleted).not.toHaveBeenCalled()
  })

  it('si hay bloqueos, explica los motivos, lista hasta 5 fechas y ofrece dar de baja', () => {
    preview({
      canDelete: false,
      blockingShifts: Array.from({ length: 7 }, (_, index) => ({
        shiftId: `sh${index}`,
        shiftDate: `2026-10-0${index + 1}`,
        reasons:
          index === 0
            ? ['ATTENDANCE_RECORDS' as const, 'SUPERVISIONS' as const]
            : ['ATTENDANCE_NOTICES' as const],
      })),
    })
    const onDeactivate = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <DeleteServiceDialog
        service={service}
        open
        onOpenChange={onOpenChange}
        onDeactivate={onDeactivate}
      />,
    )

    expect(
      screen.queryByRole('button', { name: 'Eliminar servicio' }),
    ).toBeNull()
    expect(
      screen.getByText(
        /Hay 7 turnos con fichajes registrados, avisos de asistencia/,
      ),
    ).toBeTruthy()
    expect(screen.getByText(/y 2 más/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Dar de baja' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onDeactivate).toHaveBeenCalled()
  })
})

describe('describeBlockingReasons', () => {
  it('une los motivos con coma y «y», en orden fijo', () => {
    expect(describeBlockingReasons(['SUPERVISIONS'])).toBe('supervisiones')
    expect(
      describeBlockingReasons(['SUPERVISIONS', 'ATTENDANCE_RECORDS']),
    ).toBe('fichajes registrados y supervisiones')
  })
})
