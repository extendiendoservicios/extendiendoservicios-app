import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServiceDetail } from '@/api/services'

/**
 * ADM-25 edición y alta: OF-05 (los cambios llegan a los turnos, un solo
 * diálogo junto con los fijos) y OF-02 (aviso de servicio duplicado).
 */

const {
  fetchDetailMock,
  fetchFixedMock,
  updateServiceMock,
  createServiceMock,
  setFixedMock,
  previewMock,
  applyChangesMock,
  applyFixedMock,
  serviceOverlapsMock,
  leaveFormMock,
} = vi.hoisted(() => ({
  fetchDetailMock: vi.fn(),
  fetchFixedMock: vi.fn(),
  updateServiceMock: vi.fn(),
  createServiceMock: vi.fn(),
  setFixedMock: vi.fn(),
  previewMock: vi.fn(),
  applyChangesMock: vi.fn(),
  applyFixedMock: vi.fn(),
  serviceOverlapsMock: vi.fn(),
  leaveFormMock: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))

vi.mock('@/api/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/services')>()),
  fetchServiceDetail: fetchDetailMock,
  fetchServiceFixedEmployees: fetchFixedMock,
  updateService: updateServiceMock,
  createService: createServiceMock,
  setServiceFixedEmployees: setFixedMock,
  previewServiceChanges: previewMock,
  applyServiceChanges: applyChangesMock,
  applyServiceFixedEmployees: applyFixedMock,
}))

vi.mock('@/api/overlaps', () => ({
  fetchServiceOverlaps: serviceOverlapsMock,
  fetchShiftOverlapsInSite: vi.fn(),
}))

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ roles: ['owner'], capabilities: [], userId: 'u1' }),
}))

vi.mock('@/app/shells/backNavigation', () => ({
  useLeaveForm: () => leaveFormMock,
}))

vi.mock('@/features/employees/employeeLeaveStatus', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/features/employees/employeeLeaveStatus')
  >()),
  todayInBuenosAires: () => '2026-11-12',
}))

vi.mock('@/features/clients/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/clients/queries')>()),
  useClientsQuery: () => ({
    data: [{ id: 'c1', tradeName: 'Limpia Ya', legalName: 'L SRL' }],
  }),
  useClientSitesQuery: () => ({
    data: [{ id: 'site1', name: 'Sede Centro', status: 'active' }],
  }),
}))

vi.mock('@/features/sites/queries', () => ({
  useSiteDetailQuery: () => ({ data: undefined }),
}))

vi.mock('@/features/employees/queries', () => ({
  useActiveEmployeeOptionsQuery: () => ({ data: [], isLoading: false }),
}))

// El selector real es un popover: acá alcanza un botón que elige a «e1».
vi.mock('@/features/planning/components/EmployeeMultiPicker', () => ({
  EmployeeMultiPicker: ({
    onValueChange,
  }: {
    onValueChange: (ids: string[]) => void
  }) => (
    <button type="button" onClick={() => onValueChange(['e1'])}>
      Elegir fijo
    </button>
  ),
}))

vi.mock('@/components/Combobox', () => ({
  Combobox: ({ 'aria-label': label }: { 'aria-label': string }) => (
    <div>{label}</div>
  ),
}))

vi.mock('@/components/DatePicker', () => ({
  DatePicker: ({ 'aria-label': label }: { 'aria-label': string }) => (
    <input aria-label={label} readOnly />
  ),
}))

const { default: ServiceFormPage } = await import('./ServiceFormPage')

const SERVICE: ServiceDetail = {
  id: 'svc-1',
  clientId: 'c1',
  clientName: 'Limpia Ya',
  siteId: 'site1',
  siteName: 'Sede Centro',
  name: 'Tarde',
  weekdays: [1, 2],
  weeksOfMonth: null,
  startTime: '15:00:00',
  endTime: '17:00:00',
  openEnded: false,
  requiredStaff: 1,
  validFrom: '2026-01-01',
  validTo: null,
  worksOnHolidays: true,
  requiresPhotos: false,
  minHoursMonth: null,
  maxHoursMonth: null,
  status: 'active',
  notes: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: null,
}

const PREVIEW = {
  preview: true,
  fromDate: '2026-11-12',
  deletedCount: 0,
  updatedCount: 3,
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

function renderEdit() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/admin/servicios/svc-1/editar']}>
        <Routes>
          <Route
            path="/admin/servicios/:id/editar"
            element={<ServiceFormPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function changeStartTime(value: string) {
  const input = await screen.findByLabelText<HTMLInputElement>('Desde', {
    selector: '#service-start-time',
  })
  await waitFor(() => expect(input.value).toBe('15:00'))
  fireEvent.change(input, { target: { value } })
}

beforeEach(() => {
  fetchDetailMock.mockReset().mockResolvedValue(SERVICE)
  fetchFixedMock.mockReset().mockResolvedValue([])
  updateServiceMock
    .mockReset()
    .mockResolvedValue({ ...SERVICE, startTime: '16:00:00' })
  createServiceMock.mockReset()
  setFixedMock.mockReset().mockResolvedValue(['e1'])
  previewMock.mockReset().mockResolvedValue(PREVIEW)
  applyChangesMock.mockReset().mockResolvedValue({ ...PREVIEW, preview: false })
  applyFixedMock.mockReset().mockResolvedValue({
    fromDate: '2026-11-12',
    updatedCount: 2,
    unchangedCount: 0,
    skippedCount: 0,
    assignmentsRemoved: 0,
    assignmentsAdded: 2,
    updated: [],
    skipped: [],
  })
  serviceOverlapsMock.mockReset().mockResolvedValue([])
  leaveFormMock.mockReset()
})

describe('ServiceFormPage (OF-05)', () => {
  it('ya no dice que los turnos generados no cambian', async () => {
    renderEdit()
    await screen.findByText(/Al guardar, si cambian los días/)
    expect(
      screen.queryByText(/Los turnos ya generados no cambian/),
    ).not.toBeInTheDocument()
  })

  it('al cambiar el horario pregunta, y «Aplicar» manda p_previous con los valores de antes de guardar', async () => {
    renderEdit()
    await changeStartTime('16:00')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    expect(
      await screen.findByText(
        '¿Aplicar los cambios a los turnos desde el jue 12 nov?',
      ),
    ).toBeInTheDocument()
    const previous = {
      start_time: '15:00:00',
      end_time: '17:00:00',
      open_ended: false,
      required_staff: 1,
      requires_photos: false,
    }
    expect(previewMock).toHaveBeenCalledWith('svc-1', '2026-11-12', previous)
    fireEvent.click(await screen.findByRole('button', { name: 'Aplicar' }))
    await waitFor(() =>
      expect(applyChangesMock).toHaveBeenCalledWith(
        'svc-1',
        '2026-11-12',
        previous,
      ),
    )
    expect(applyFixedMock).not.toHaveBeenCalled()
  })

  it('«No aplicar» deja los turnos como están y vuelve al listado', async () => {
    renderEdit()
    await changeStartTime('16:00')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    fireEvent.click(await screen.findByRole('button', { name: 'No aplicar' }))
    expect(applyChangesMock).not.toHaveBeenCalled()
    expect(leaveFormMock).toHaveBeenCalledWith(
      '/admin/clientes/c1?pestana=servicios',
      'edit',
    )
  })

  it('si cambian el horario y los fijos hay un solo diálogo (servicio primero, fijos después)', async () => {
    renderEdit()
    await changeStartTime('16:00')
    await waitFor(() => expect(fetchFixedMock).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Elegir fijo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    await screen.findByText(/¿Aplicar los cambios a los turnos desde el/)
    // No aparece el diálogo de fijos aparte.
    expect(screen.queryByText('¿Aplicar a los turnos?')).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Aplicar' }))
    await screen.findByText('Empleados fijos')
    expect(applyChangesMock.mock.invocationCallOrder[0]).toBeLessThan(
      applyFixedMock.mock.invocationCallOrder[0] as number,
    )
  })

  it('si solo cambian los fijos queda el diálogo de fijos de siempre', async () => {
    updateServiceMock.mockResolvedValue(SERVICE)
    renderEdit()
    await screen.findByText(/Al guardar, si cambian los días/)
    await waitFor(() => expect(fetchFixedMock).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Elegir fijo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(
      await screen.findByText('¿Aplicar a los turnos?'),
    ).toBeInTheDocument()
    expect(previewMock).not.toHaveBeenCalled()
  })

  it('si solo cambia el nombre no pregunta nada', async () => {
    updateServiceMock.mockResolvedValue({ ...SERVICE, name: 'Otro' })
    renderEdit()
    const name = await screen.findByLabelText<HTMLInputElement>('Nombre')
    await waitFor(() => expect(name.value).toBe('Tarde'))
    fireEvent.change(name, { target: { value: 'Otro' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(leaveFormMock).toHaveBeenCalled())
    expect(previewMock).not.toHaveBeenCalled()
  })

  it('«Actualizar turnos desde…» corre sin p_previous (fuerza los valores del servicio)', async () => {
    renderEdit()
    const button = await screen.findByRole('button', {
      name: 'Actualizar turnos desde…',
    })
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)
    await waitFor(() =>
      expect(previewMock).toHaveBeenCalledWith('svc-1', '2026-11-12', null),
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Aplicar' }))
    await waitFor(() =>
      expect(applyChangesMock).toHaveBeenCalledWith(
        'svc-1',
        '2026-11-12',
        null,
      ),
    )
  })

  it('«Actualizar turnos desde…» se desactiva si hay cambios sin guardar', async () => {
    renderEdit()
    await changeStartTime('16:00')
    expect(
      screen.getByRole('button', { name: 'Actualizar turnos desde…' }),
    ).toBeDisabled()
  })
})

describe('ServiceFormPage (OF-02)', () => {
  const OVERLAP = {
    serviceId: 'otro',
    serviceName: 'YPF RUTA TURNO TARDE',
    commonWeekdays: [1, 2],
    startTime: '15:00:00',
    endTime: '17:00:00',
    openEnded: false,
  }

  it('avisa del duplicado y recién guarda al confirmar «Guardar igual»', async () => {
    serviceOverlapsMock.mockResolvedValue([OVERLAP])
    renderEdit()
    await changeStartTime('16:00')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    expect(
      await screen.findByText(
        'Ya existe “YPF RUTA TURNO TARDE” en esta sede los lunes y martes de 15:00 a 17:00. ¿Guardar igual?',
      ),
    ).toBeInTheDocument()
    expect(serviceOverlapsMock).toHaveBeenCalledWith({
      siteId: 'site1',
      weekdays: [1, 2],
      start: '16:00',
      end: '17:00',
      exceptServiceId: 'svc-1',
    })
    expect(updateServiceMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Guardar igual' }))
    await waitFor(() => expect(updateServiceMock).toHaveBeenCalledTimes(1))
  })

  it('«Volver» no guarda', async () => {
    serviceOverlapsMock.mockResolvedValue([OVERLAP])
    renderEdit()
    await changeStartTime('16:00')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await screen.findByText(/¿Guardar igual\?/)
    fireEvent.click(screen.getByRole('button', { name: 'Volver' }))
    await waitFor(() =>
      expect(screen.queryByText(/¿Guardar igual\?/)).not.toBeInTheDocument(),
    )
    expect(updateServiceMock).not.toHaveBeenCalled()
  })

  it('si la consulta falla no bloquea el guardado', async () => {
    serviceOverlapsMock.mockRejectedValue(new Error('sin red'))
    renderEdit()
    await changeStartTime('16:00')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(updateServiceMock).toHaveBeenCalledTimes(1))
  })
})
