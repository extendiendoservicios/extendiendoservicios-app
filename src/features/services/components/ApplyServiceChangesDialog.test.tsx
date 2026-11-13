import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServiceChangesResult, ServicePrevious } from '@/api/services'
import { ApiError } from '@/api/errors'

const { previewMock, applyMock, applyFixedMock, toastInfo } = vi.hoisted(
  () => ({
    previewMock: vi.fn(),
    applyMock: vi.fn(),
    applyFixedMock: vi.fn(),
    toastInfo: vi.fn(),
  }),
)

vi.mock('sonner', () => ({ toast: { info: toastInfo } }))

vi.mock('@/api/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/services')>()),
  previewServiceChanges: previewMock,
  applyServiceChanges: applyMock,
  applyServiceFixedEmployees: applyFixedMock,
}))

vi.mock('@/features/employees/employeeLeaveStatus', () => ({
  todayInBuenosAires: () => '2026-11-12',
}))

const { ApplyServiceChangesDialog } =
  await import('./ApplyServiceChangesDialog')

const PREVIOUS: ServicePrevious = {
  start_time: '12:00:00',
  end_time: '14:00:00',
  open_ended: false,
  required_staff: 1,
  requires_photos: false,
}

const BASE: ServiceChangesResult = {
  preview: true,
  fromDate: '2026-11-12',
  deletedCount: 0,
  updatedCount: 0,
  createdCount: 0,
  unchangedCount: 0,
  skippedCount: 0,
  assignmentsRemoved: 0,
  assignmentsAdded: 0,
  deleted: [],
  updated: [],
  created: [],
  skipped: [],
  unassigned: [],
  months: [],
}

const WITH_CHANGES: ServiceChangesResult = {
  ...BASE,
  deletedCount: 2,
  updatedCount: 1,
  createdCount: 3,
  skippedCount: 1,
  deleted: [
    {
      shiftId: 'd1',
      shiftDate: '2026-12-08',
      reason: 'HOLIDAY',
      message: 'Es feriado y el servicio no trabaja feriados.',
      assignments: 1,
    },
  ],
  updated: [
    {
      shiftId: 'u1',
      shiftDate: '2026-11-17',
      time: {
        from: { startTime: '12:00:00', endTime: '14:00:00', openEnded: false },
        to: { startTime: '12:30:00', endTime: '14:30:00', openEnded: false },
      },
      requiredStaff: { from: 1, to: 3 },
      requiresPhotos: null,
      removed: [],
      kept: [],
    },
  ],
  skipped: [
    {
      scope: 'shift',
      shiftId: 'k1',
      shiftDate: '2026-11-13',
      code: 'MANUAL_SHIFT',
      message: 'El turno se creó a mano, no desde el servicio.',
      wanted: 'update',
    },
  ],
}

function renderDialog(props: {
  previous?: ServicePrevious | null
  includeFixed?: boolean
  createMissing?: boolean
  onFinish?: () => void
}) {
  const onFinish = props.onFinish ?? vi.fn()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <ApplyServiceChangesDialog
        serviceId="svc-1"
        previous={props.previous === undefined ? PREVIOUS : props.previous}
        includeFixed={props.includeFixed}
        createMissing={props.createMissing}
        onFinish={onFinish}
      />
    </QueryClientProvider>,
  )
  return onFinish
}

beforeEach(() => {
  previewMock.mockReset().mockResolvedValue(WITH_CHANGES)
  applyMock.mockReset().mockResolvedValue({ ...WITH_CHANGES, preview: false })
  applyFixedMock.mockReset().mockResolvedValue({
    fromDate: '2026-11-12',
    updatedCount: 4,
    unchangedCount: 0,
    skippedCount: 0,
    assignmentsRemoved: 1,
    assignmentsAdded: 1,
    updated: [],
    skipped: [],
  })
  toastInfo.mockReset()
})

describe('ApplyServiceChangesDialog (OF-05)', () => {
  it('pregunta desde la fecha de hoy y muestra la vista previa con el detalle', async () => {
    renderDialog({})
    expect(
      screen.getByText(
        '¿Aplicar los cambios a los turnos desde el jue 12 nov?',
      ),
    ).toBeInTheDocument()
    expect(
      await screen.findByText(
        'Se borran 2 turnos; se actualiza 1 turno; se crean 3 turnos; se saltea 1 turno.',
      ),
    ).toBeInTheDocument()
    expect(previewMock).toHaveBeenCalledWith(
      'svc-1',
      '2026-11-12',
      PREVIOUS,
      true,
    )
    // Detalle con los motivos en lenguaje claro.
    expect(
      screen.getByText(/Es feriado y el servicio no trabaja feriados\./),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Horario: 12:00 a 14:00 → 12:30 a 14:30'),
    ).toBeInTheDocument()
    expect(screen.getByText('Dotación: 1 → 3')).toBeInTheDocument()
    expect(
      screen.getByText(/El turno se creó a mano, no desde el servicio\./),
    ).toBeInTheDocument()
  })

  it('«Aplicar» llama a apply_service_changes con p_previous y muestra el resumen', async () => {
    renderDialog({})
    await screen.findByText(/Se borran 2 turnos/)
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }))
    await waitFor(() =>
      expect(applyMock).toHaveBeenCalledWith(
        'svc-1',
        '2026-11-12',
        PREVIOUS,
        true,
      ),
    )
    expect(
      await screen.findByText(
        'Borramos 2 turnos; actualizamos 1 turno; creamos 3 turnos; salteamos 1 turno.',
      ),
    ).toBeInTheDocument()
    expect(applyFixedMock).not.toHaveBeenCalled()
  })

  it('«No aplicar» cierra sin tocar los turnos', async () => {
    const onFinish = renderDialog({})
    await screen.findByText(/Se borran 2 turnos/)
    fireEvent.click(screen.getByRole('button', { name: 'No aplicar' }))
    expect(onFinish).toHaveBeenCalled()
    expect(applyMock).not.toHaveBeenCalled()
    expect(applyFixedMock).not.toHaveBeenCalled()
  })

  it('si también cambiaron los fijos, un solo diálogo: primero el servicio y después los fijos, con la misma fecha', async () => {
    const order: string[] = []
    applyMock.mockImplementation(() => {
      order.push('servicio')
      return Promise.resolve({ ...WITH_CHANGES, preview: false })
    })
    applyFixedMock.mockImplementation(() => {
      order.push('fijos')
      return Promise.resolve({
        fromDate: '2026-11-12',
        updatedCount: 4,
        unchangedCount: 0,
        skippedCount: 0,
        assignmentsRemoved: 1,
        assignmentsAdded: 2,
        updated: [],
        skipped: [],
      })
    })
    renderDialog({ includeFixed: true })
    await screen.findByText(/Se borran 2 turnos/)
    expect(
      screen.getByText(/Después se aplican los cambios de los empleados fijos/),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }))
    expect(await screen.findByText('Empleados fijos')).toBeInTheDocument()
    expect(order).toEqual(['servicio', 'fijos'])
    expect(applyFixedMock).toHaveBeenCalledWith('svc-1', '2026-11-12')
    expect(screen.getByText('Actualizamos 4 turnos.')).toBeInTheDocument()
  })

  it('si fallan los fijos informa que lo del servicio sí se aplicó', async () => {
    applyFixedMock.mockRejectedValue(
      new ApiError('No se puede asignar a Ana.', 'EMPLOYEE_NOT_ACTIVE'),
    )
    renderDialog({ includeFixed: true })
    await screen.findByText(/Se borran 2 turnos/)
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }))
    expect(
      await screen.findByText(
        /Se aplicaron los cambios del servicio, pero no los empleados fijos: No se puede asignar a Ana\./,
      ),
    ).toBeInTheDocument()
  })

  it('si el servidor rechaza la aplicación muestra su mensaje y deja reintentar', async () => {
    applyMock.mockRejectedValue(
      new ApiError('Indicá desde qué fecha.', 'FROM_DATE_REQUIRED'),
    )
    renderDialog({})
    await screen.findByText(/Se borran 2 turnos/)
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }))
    expect(
      await screen.findByText('Indicá desde qué fecha.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aplicar' })).toBeEnabled()
  })

  it('un cambio que no toca ningún turno no deja un diálogo vacío: avisa y sigue', async () => {
    previewMock.mockResolvedValue(BASE)
    const onFinish = renderDialog({})
    await waitFor(() => expect(onFinish).toHaveBeenCalledTimes(1))
    expect(toastInfo).toHaveBeenCalled()
  })

  it('sin turnos para cambiar pero con fijos cambiados, el diálogo se queda para aplicar los fijos', async () => {
    previewMock.mockResolvedValue(BASE)
    const onFinish = renderDialog({ includeFixed: true })
    await screen.findByText(/ya están al día/)
    expect(onFinish).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Aplicar' })).toBeEnabled()
  })

  it('«Actualizar turnos desde…» (sin p_previous) pide la vista previa sin valores anteriores y no se cierra sola si está al día', async () => {
    previewMock.mockResolvedValue(BASE)
    const onFinish = renderDialog({ previous: null })
    await screen.findByText(/ya están al día/)
    expect(previewMock).toHaveBeenCalledWith('svc-1', '2026-11-12', null, true)
    expect(onFinish).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Aplicar' })).toBeDisabled()
  })

  it('«Actualizar turnos desde…» aplica forzando los valores del servicio (previous null)', async () => {
    renderDialog({ previous: null })
    await screen.findByText(/Se borran 2 turnos/)
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }))
    await waitFor(() =>
      expect(applyMock).toHaveBeenCalledWith('svc-1', '2026-11-12', null, true),
    )
  })
  it('OF-05b: sin días nuevos manda p_create_missing en falso y no promete turnos nuevos', async () => {
    renderDialog({ createMissing: false })
    await screen.findByText(/Se borran 2 turnos/)
    expect(previewMock).toHaveBeenCalledWith(
      'svc-1',
      '2026-11-12',
      PREVIOUS,
      false,
    )
    expect(screen.getByText(/No se crean turnos nuevos\./)).toBeInTheDocument()
    expect(screen.queryByText(/y se crean los que faltan/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }))
    await waitFor(() =>
      expect(applyMock).toHaveBeenCalledWith(
        'svc-1',
        '2026-11-12',
        PREVIOUS,
        false,
      ),
    )
  })
})
