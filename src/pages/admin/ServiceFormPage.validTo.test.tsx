import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServiceDetail } from '@/api/services'

/**
 * ADM-25, OH-12: al borrar «Vigente hasta» el servicio queda «por tiempo
 * indeterminado» (`valid_to = null`) y la vista previa de cambios a los turnos
 * se pide con `createMissing = true` (la vigencia puede sumar días).
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
  DatePicker: ({
    'aria-label': label,
    value,
    clearable,
    onValueChange,
  }: {
    'aria-label': string
    value?: Date
    clearable?: boolean
    onValueChange: (date: Date | undefined) => void
  }) => (
    <>
      <input aria-label={label} readOnly value={value ? 'con fecha' : ''} />
      {clearable && value && (
        <button type="button" onClick={() => onValueChange(undefined)}>
          Borrar {label}
        </button>
      )}
    </>
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
  validTo: '2026-12-31',
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

describe('ServiceFormPage (OH-12)', () => {
  it('al borrar «Vigente hasta» guarda valid_to en null y pregunta por los turnos', async () => {
    updateServiceMock.mockResolvedValue({ ...SERVICE, validTo: null })
    renderEdit()
    const clear = await screen.findByRole('button', {
      name: 'Borrar Vigente hasta',
    })
    fireEvent.click(clear)
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    await waitFor(() => expect(updateServiceMock).toHaveBeenCalled())
    const input = updateServiceMock.mock.calls[0]?.[1] as { validTo: unknown }
    expect(input.validTo).toBeNull()
    // La vigencia puede agregar días con turno: se permite crear los que faltan.
    await waitFor(() =>
      expect(previewMock).toHaveBeenCalledWith(
        'svc-1',
        '2026-11-12',
        expect.any(Object),
        true,
      ),
    )
  })

  it('sin tocar la fecha de fin la conserva', async () => {
    updateServiceMock.mockResolvedValue({ ...SERVICE, name: 'Otro' })
    renderEdit()
    const name = await screen.findByLabelText<HTMLInputElement>('Nombre')
    await waitFor(() => expect(name.value).toBe('Tarde'))
    fireEvent.change(name, { target: { value: 'Otro' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(updateServiceMock).toHaveBeenCalled())
    const input = updateServiceMock.mock.calls[0]?.[1] as { validTo: unknown }
    expect(input.validTo).toBe('2026-12-31')
  })
})
