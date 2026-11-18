import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useParams,
} from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ADM-07 alta de turno con «Repetir este turno» (AJ3-08): apagado usa
 * `create_shift`; encendido, el aviso en vivo de `preview_shift_series` y
 * `create_shift_series`.
 */

const {
  createShiftMock,
  createShiftSeriesMock,
  registerPastMock,
  fetchShiftDetailMock,
  authState,
  previewShiftSeriesMock,
  shiftOverlapsMock,
  datesOverlapsMock,
  toastSuccess,
  toastWarning,
  toastError,
} = vi.hoisted(() => ({
  createShiftMock: vi.fn(),
  createShiftSeriesMock: vi.fn(),
  registerPastMock: vi.fn(),
  fetchShiftDetailMock: vi.fn(),
  authState: {
    value: { roles: ['owner'], capabilities: new Array<string>() },
  },
  previewShiftSeriesMock: vi.fn(),
  shiftOverlapsMock: vi.fn(),
  datesOverlapsMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { success: toastSuccess, warning: toastWarning, error: toastError },
}))

vi.mock('@/api/shifts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/shifts')>()),
  createShift: createShiftMock,
  createShiftSeries: createShiftSeriesMock,
  registerPastShift: registerPastMock,
  previewShiftSeries: previewShiftSeriesMock,
}))

vi.mock('@/api/assignments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/assignments')>()),
  fetchShiftDetail: fetchShiftDetailMock,
}))

vi.mock('@/api/overlaps', () => ({
  fetchShiftOverlapsInSite: shiftOverlapsMock,
  fetchShiftOverlapsForDates: datesOverlapsMock,
  fetchServiceOverlaps: vi.fn(),
}))

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => authState.value,
}))

vi.mock('@/features/clients/queries', () => ({
  useClientsQuery: () => ({
    data: [{ id: 'c1', tradeName: 'Limpia Ya', legalName: 'L SRL' }],
  }),
  useClientSitesQuery: () => ({
    data: [{ id: 's1', name: 'Sede Centro', status: 'active' }],
  }),
}))

vi.mock('@/features/employees/queries', () => ({
  useActiveEmployeeOptionsQuery: () => ({ data: [], isLoading: false }),
  useLeavesInRangeQuery: () => ({ data: [] }),
}))

vi.mock('@/features/settings/queries', () => ({
  useHolidaysQuery: () => ({ data: [] }),
}))

vi.mock('@/features/planning/components/EmployeeMultiPicker', () => ({
  EmployeeMultiPicker: ({
    onValueChange,
  }: {
    onValueChange: (ids: string[]) => void
  }) => (
    <button type="button" onClick={() => onValueChange(['e1'])}>
      Elegir empleado
    </button>
  ),
}))

// Los selectores reales son popovers: acá alcanzan cajas simples.
vi.mock('@/components/Combobox', () => ({
  Combobox: ({
    'aria-label': label,
    onValueChange,
  }: {
    'aria-label': string
    onValueChange: (value: string) => void
  }) => (
    <button
      type="button"
      onClick={() => onValueChange(label === 'Cliente' ? 'c1' : 's1')}
    >
      Elegir {label}
    </button>
  ),
}))

vi.mock('@/components/DatePicker', () => ({
  DatePicker: ({
    'aria-label': label,
    value,
    onValueChange,
    minDate,
    maxDate,
  }: {
    'aria-label': string
    value?: Date
    onValueChange: (date: Date | undefined) => void
    minDate?: Date
    maxDate?: Date
  }) => (
    <input
      aria-label={label}
      data-min={minDate ? minDate.toDateString() : ''}
      data-max={maxDate ? maxDate.toDateString() : ''}
      defaultValue={value ? value.toDateString() : ''}
      onChange={(event) =>
        onValueChange(
          event.target.value
            ? new Date(`${event.target.value}T00:00:00`)
            : undefined,
        )
      }
    />
  ),
}))

const { default: ShiftFormPage } = await import('./ShiftFormPage')
const { ApiError, parseConflictDetail } = await import('@/api/errors')

function Destino() {
  const location = useLocation()
  return <p>Calendario {location.search}</p>
}

function EditarTurno() {
  return <p>Editar turno {useParams().id}</p>
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/admin/turnos/nuevo']}>
        <Routes>
          <Route path="/admin/turnos/nuevo" element={<ShiftFormPage />} />
          <Route path="/admin/planificacion" element={<Destino />} />
          <Route path="/admin/turnos/:id/editar" element={<EditarTurno />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function fillBasics() {
  fireEvent.click(screen.getByRole('button', { name: 'Elegir Cliente' }))
  fireEvent.click(screen.getByRole('button', { name: 'Elegir Sede' }))
  fireEvent.change(screen.getByLabelText('Fecha del turno'), {
    target: { value: '2026-10-13' },
  })
  fireEvent.change(document.getElementById('shift-start-time') as Element, {
    target: { value: '08:00' },
  })
  fireEvent.change(document.getElementById('shift-end-time') as Element, {
    target: { value: '12:00' },
  })
}

const SINGLE_RESULT = {
  shiftId: 'sh1',
  warnings: [],
  assigned: [],
  rejected: [],
}

beforeEach(() => {
  // Hoy es el 1 de octubre de 2026: las fechas de estas pruebas son futuras
  // salvo las de «Registrar como realizado» (OH-09), que mueven el reloj.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-01T12:00:00-03:00'))
  authState.value = { roles: ['owner'], capabilities: [] }
  registerPastMock.mockReset().mockResolvedValue({
    shiftId: 'sh-past',
    warnings: [],
    warningsDetail: [],
    assigned: [{ employeeId: 'e1', assignmentId: 'as1', warnings: [] }],
    attendance: [],
  })
  fetchShiftDetailMock.mockReset().mockResolvedValue({
    id: 'x1',
    clientName: 'Limpia Ya',
    siteName: 'Sede Centro',
    shiftDate: '2026-10-13',
    startTime: '12:30:00',
    endTime: '14:30:00',
    openEnded: false,
    assignments: [
      { employeeFirstName: 'Ana', employeeLastName: 'Gómez' },
      { employeeFirstName: 'Luis', employeeLastName: 'Paz' },
    ],
  })
  createShiftMock.mockReset().mockResolvedValue(SINGLE_RESULT)
  createShiftSeriesMock.mockReset().mockResolvedValue({
    seriesId: 'ser1',
    created: [
      {
        shiftId: 'a',
        shiftDate: '2026-10-13',
        warnings: [],
        assigned: [],
        rejected: [],
      },
      {
        shiftId: 'b',
        shiftDate: '2026-10-20',
        warnings: [],
        assigned: [],
        rejected: [],
      },
    ],
    holidaysSkipped: [],
  })
  previewShiftSeriesMock.mockReset().mockResolvedValue({
    dates: ['2026-10-13', '2026-10-20'],
    holidaysSkipped: [],
    count: 2,
  })
  shiftOverlapsMock.mockReset().mockResolvedValue([])
  datesOverlapsMock.mockReset().mockResolvedValue([])
  toastSuccess.mockReset()
  toastWarning.mockReset()
  toastError.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ShiftFormPage — repetir el turno', () => {
  it('con el conmutador apagado crea un solo turno con create_shift', async () => {
    renderPage()
    fillBasics()
    expect(
      screen.getByRole('switch', { name: 'Repetir este turno' }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Crear turno' }))

    await waitFor(() => expect(createShiftMock).toHaveBeenCalledTimes(1))
    expect(createShiftSeriesMock).not.toHaveBeenCalled()
    expect(previewShiftSeriesMock).not.toHaveBeenCalled()
  })

  it('al encender tilda el día de la fecha elegida y pide la fecha «hasta»', async () => {
    renderPage()
    fillBasics()
    fireEvent.click(screen.getByRole('switch', { name: 'Repetir este turno' }))

    // 13/10/2026 es martes.
    expect(screen.getByRole('checkbox', { name: 'Martes' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Lunes' })).not.toBeChecked()
    expect(screen.getByText('Crear también en feriados')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Crear turnos' }))
    expect(
      await screen.findByText('Elegí hasta qué fecha se repite.'),
    ).toBeInTheDocument()
    expect(createShiftSeriesMock).not.toHaveBeenCalled()
  })

  it('limita la fecha «hasta» a 3 meses desde «Desde»', () => {
    renderPage()
    fillBasics()
    fireEvent.click(screen.getByRole('switch', { name: 'Repetir este turno' }))
    const hasta = screen.getByLabelText('Repetir hasta')
    expect(hasta.getAttribute('data-min')).toContain('Oct 13 2026')
    expect(hasta.getAttribute('data-max')).toContain('Jan 13 2027')
  })

  it('muestra el aviso en vivo y crea la serie con create_shift_series', async () => {
    renderPage()
    fillBasics()
    fireEvent.click(screen.getByRole('switch', { name: 'Repetir este turno' }))
    fireEvent.change(screen.getByLabelText('Repetir hasta'), {
      target: { value: '2026-11-17' },
    })

    expect(
      await screen.findByText('Se van a crear 2 turnos.'),
    ).toBeInTheDocument()
    expect(previewShiftSeriesMock).toHaveBeenCalledWith({
      from: '2026-10-13',
      to: '2026-11-17',
      weekdays: [2],
      weeksOfMonth: null,
      worksOnHolidays: false,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Crear turnos' }))
    await waitFor(() => expect(createShiftSeriesMock).toHaveBeenCalledTimes(1))
    expect(createShiftMock).not.toHaveBeenCalled()
    expect(createShiftSeriesMock.mock.calls[0]?.[0]).toMatchObject({
      clientId: 'c1',
      siteId: 's1',
      start: '08:00',
      end: '12:00',
      from: '2026-10-13',
      to: '2026-11-17',
      weekdays: [2],
      weeksOfMonth: null,
      worksOnHolidays: false,
    })
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Se crearon 2 turnos.'),
    )
    expect(
      await screen.findByText(/Calendario \?vista=dia&fecha=2026-10-13/),
    ).toBeInTheDocument()
  })

  it('con 0 fechas avisa y deshabilita el botón de crear', async () => {
    previewShiftSeriesMock.mockResolvedValue({
      dates: [],
      holidaysSkipped: [],
      count: 0,
    })
    renderPage()
    fillBasics()
    fireEvent.click(screen.getByRole('switch', { name: 'Repetir este turno' }))
    fireEvent.change(screen.getByLabelText('Repetir hasta'), {
      target: { value: '2026-10-14' },
    })

    expect(
      await screen.findByText('Ninguna fecha cumple la regla elegida.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Crear turnos' })).toBeDisabled()
  })

  it('informa los feriados que se saltean', async () => {
    previewShiftSeriesMock.mockResolvedValue({
      dates: ['2026-10-13'],
      holidaysSkipped: ['2026-10-20'],
      count: 1,
    })
    renderPage()
    fillBasics()
    fireEvent.click(screen.getByRole('switch', { name: 'Repetir este turno' }))
    fireEvent.change(screen.getByLabelText('Repetir hasta'), {
      target: { value: '2026-10-27' },
    })

    expect(
      await screen.findByText('Se saltea 1 feriado: mar 20 oct.'),
    ).toBeInTheDocument()
  })

  it('muestra por fecha los empleados rechazados antes de volver', async () => {
    createShiftSeriesMock.mockResolvedValue({
      seriesId: 'ser1',
      created: [
        {
          shiftId: 'a',
          shiftDate: '2026-10-13',
          warnings: [],
          assigned: [],
          rejected: [
            {
              employeeId: 'e1',
              employeeName: 'Ana Gómez',
              code: 'ASSIGNMENT_OVERLAP',
              message: 'Ya tiene otro turno en ese horario.',
            },
          ],
        },
      ],
      holidaysSkipped: [],
    })
    renderPage()
    fillBasics()
    fireEvent.click(screen.getByRole('switch', { name: 'Repetir este turno' }))
    fireEvent.change(screen.getByLabelText('Repetir hasta'), {
      target: { value: '2026-11-17' },
    })
    await screen.findByText('Se van a crear 2 turnos.')
    fireEvent.click(screen.getByRole('button', { name: 'Crear turnos' }))

    await waitFor(() => expect(toastWarning).toHaveBeenCalledTimes(1))
    expect(toastWarning.mock.calls[0]?.[0]).toBe(
      'Se creó 1 turno, pero a algunas personas no se las pudo asignar:',
    )
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('muestra el message del servidor si falla la creación', async () => {
    const { ApiError } = await import('@/api/errors')
    createShiftSeriesMock.mockRejectedValue(
      new ApiError(
        'La sede no está activa. (turno del 20/10/2026)',
        'SITE_NOT_ACTIVE',
      ),
    )
    renderPage()
    fillBasics()
    fireEvent.click(screen.getByRole('switch', { name: 'Repetir este turno' }))
    fireEvent.change(screen.getByLabelText('Repetir hasta'), {
      target: { value: '2026-11-17' },
    })
    await screen.findByText('Se van a crear 2 turnos.')
    fireEvent.click(screen.getByRole('button', { name: 'Crear turnos' }))

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'La sede no está activa. (turno del 20/10/2026)',
      ),
    )
  })
})

describe('ShiftFormPage: casilla «Pide fotos» (módulo H)', () => {
  it('viene apagada y create_shift recibe requiresPhotos false', async () => {
    renderPage()
    fillBasics()
    expect(
      screen.getByRole('checkbox', { name: 'Pide fotos' }),
    ).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Crear turno' }))
    await waitFor(() => expect(createShiftMock).toHaveBeenCalledTimes(1))
    expect(createShiftMock.mock.calls[0]?.[0]).toMatchObject({
      requiresPhotos: false,
    })
  })

  it('tildada, create_shift recibe requiresPhotos true', async () => {
    renderPage()
    fillBasics()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pide fotos' }))
    fireEvent.click(screen.getByRole('button', { name: 'Crear turno' }))
    await waitFor(() => expect(createShiftMock).toHaveBeenCalledTimes(1))
    expect(createShiftMock.mock.calls[0]?.[0]).toMatchObject({
      requiresPhotos: true,
    })
  })

  it('en una repetición, create_shift_series también la recibe', async () => {
    renderPage()
    fillBasics()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pide fotos' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Repetir este turno' }))
    fireEvent.change(screen.getByLabelText('Repetir hasta'), {
      target: { value: '2026-11-17' },
    })
    await screen.findByText('Se van a crear 2 turnos.')
    fireEvent.click(screen.getByRole('button', { name: 'Crear turnos' }))
    await waitFor(() => expect(createShiftSeriesMock).toHaveBeenCalledTimes(1))
    expect(createShiftSeriesMock.mock.calls[0]?.[0]).toMatchObject({
      requiresPhotos: true,
    })
  })
})

describe('ShiftFormPage — aviso de turno superpuesto en la sede (OF-02)', () => {
  const OVERLAP = {
    shiftId: 'x1',
    serviceName: 'Limpieza almuerzo',
    shiftDate: '2026-10-13',
    startTime: '12:30:00',
    endTime: '14:30:00',
    openEnded: false,
  }

  it('avisa, no crea hasta que se confirma y entonces crea', async () => {
    shiftOverlapsMock.mockResolvedValue([OVERLAP])
    renderPage()
    fillBasics()
    fireEvent.click(screen.getByRole('button', { name: 'Crear turno' }))

    expect(
      await screen.findByText(
        'Esta sede ya tiene el turno “Limpieza almuerzo” ese día de 12:30 a 14:30. ¿Crear igual o editar ese turno?',
      ),
    ).toBeInTheDocument()
    // OH-10: muestra el turno que ya existe, con sus asignados.
    const existing = await screen.findByTestId('existing-shift')
    expect(existing).toHaveTextContent('Limpia Ya · Sede Centro')
    expect(existing).toHaveTextContent('12:30–14:30')
    expect(existing).toHaveTextContent('Asignados: Ana Gómez, Luis Paz')
    expect(shiftOverlapsMock).toHaveBeenCalledWith({
      siteId: 's1',
      date: '2026-10-13',
      start: '08:00',
      end: '12:00',
    })
    expect(createShiftMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Crear igual' }))
    await waitFor(() => expect(createShiftMock).toHaveBeenCalledTimes(1))
  })

  it('«Cancelar» deja el formulario sin crear nada', async () => {
    shiftOverlapsMock.mockResolvedValue([OVERLAP])
    renderPage()
    fillBasics()
    fireEvent.click(screen.getByRole('button', { name: 'Crear turno' }))
    await screen.findByText(/¿Crear igual o editar ese turno\?/)
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    await waitFor(() =>
      expect(
        screen.queryByText(/¿Crear igual o editar ese turno\?/),
      ).not.toBeInTheDocument(),
    )
    expect(createShiftMock).not.toHaveBeenCalled()
  })

  it('«Editar ese turno» abre la edición del turno existente sin crear nada (OH-10)', async () => {
    shiftOverlapsMock.mockResolvedValue([OVERLAP])
    renderPage()
    fillBasics()
    fireEvent.click(screen.getByRole('button', { name: 'Crear turno' }))
    await screen.findByText(/¿Crear igual o editar ese turno\?/)
    fireEvent.click(screen.getByRole('button', { name: 'Editar ese turno' }))
    expect(await screen.findByText('Editar turno x1')).toBeInTheDocument()
    expect(createShiftMock).not.toHaveBeenCalled()
  })

  it('si no hay superposición crea directo', async () => {
    renderPage()
    fillBasics()
    fireEvent.click(screen.getByRole('button', { name: 'Crear turno' }))
    await waitFor(() => expect(createShiftMock).toHaveBeenCalledTimes(1))
  })

  it('con la consulta caída igual crea el turno', async () => {
    shiftOverlapsMock.mockRejectedValue(new Error('sin red'))
    renderPage()
    fillBasics()
    fireEvent.click(screen.getByRole('button', { name: 'Crear turno' }))
    await waitFor(() => expect(createShiftMock).toHaveBeenCalledTimes(1))
  })
})

describe('ShiftFormPage — repetir el turno avisa duplicados (OF-21)', () => {
  const DUP = [
    {
      date: '2026-10-20',
      overlaps: [
        {
          shiftId: 'x',
          serviceName: 'Limpieza mañana',
          shiftDate: '2026-10-20',
          startTime: '08:00:00',
          endTime: '12:00:00',
          openEnded: false,
        },
      ],
    },
  ]

  async function repetir() {
    renderPage()
    fillBasics()
    fireEvent.click(screen.getByRole('switch', { name: 'Repetir este turno' }))
    fireEvent.change(screen.getByLabelText('Repetir hasta'), {
      target: { value: '2026-11-17' },
    })
    await screen.findByText('Se van a crear 2 turnos.')
    fireEvent.click(screen.getByRole('button', { name: 'Crear turnos' }))
  }

  it('sin coincidencias sigue como siempre', async () => {
    await repetir()
    await waitFor(() => expect(createShiftSeriesMock).toHaveBeenCalledTimes(1))
    expect(datesOverlapsMock).toHaveBeenCalledWith({
      siteId: 's1',
      dates: ['2026-10-13', '2026-10-20'],
      start: '08:00',
      end: '12:00',
    })
  })

  it('con coincidencias las lista y «Repetir igual» crea toda la serie', async () => {
    datesOverlapsMock.mockResolvedValue(DUP)
    await repetir()
    expect(
      await screen.findByText(
        'El mar 20/10 ya hay “Limpieza mañana” de 08:00 a 12:00',
      ),
    ).toBeInTheDocument()
    expect(createShiftSeriesMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Repetir igual' }))
    await waitFor(() => expect(createShiftSeriesMock).toHaveBeenCalledTimes(1))
    expect(createShiftSeriesMock.mock.calls[0]?.[0]).toMatchObject({
      from: '2026-10-13',
      to: '2026-11-17',
    })
  })

  it('«Sacar esas fechas» crea la serie en una sola llamada con excludeDates', async () => {
    datesOverlapsMock.mockResolvedValue(DUP)
    await repetir()
    fireEvent.click(
      await screen.findByRole('button', { name: 'Sacar esas fechas' }),
    )
    await waitFor(() => expect(createShiftSeriesMock).toHaveBeenCalledTimes(1))
    expect(createShiftSeriesMock.mock.calls[0]?.[0]).toMatchObject({
      from: '2026-10-13',
      to: '2026-11-17',
      excludeDates: ['2026-10-20'],
    })
  })

  it('«Cancelar» no crea nada', async () => {
    datesOverlapsMock.mockResolvedValue(DUP)
    await repetir()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }))
    expect(createShiftSeriesMock).not.toHaveBeenCalled()
  })
})

describe('ShiftFormPage — servicio con turno ese día (OH-10, SHIFT_DATE_TAKEN)', () => {
  it('muestra el turno que ya existe, sin «Crear igual», y deja editarlo', async () => {
    createShiftMock.mockRejectedValue(
      new ApiError(
        'Ese servicio ya tiene un turno el mar 13 oct de 08:00 a 12:00.',
        'SHIFT_DATE_TAKEN',
        parseConflictDetail(
          JSON.stringify({
            shift_id: 'sh9',
            conflict_shift_id: 'sh9',
            client_name: 'Limpia Ya',
            site_name: 'Sede Centro',
            service_name: 'Limpieza mañana',
            shift_date: '2026-10-13',
            start_time: '08:00:00',
            end_time: '12:00:00',
            open_ended: false,
            status: 'assigned',
            assigned: [
              {
                employee_id: 'e1',
                employee_name: 'Ana Gómez',
                start_time: '08:00:00',
                end_time: '12:00:00',
              },
            ],
          }),
        ),
      ),
    )
    renderPage()
    fillBasics()
    fireEvent.click(screen.getByRole('button', { name: 'Crear turno' }))

    const existing = await screen.findByTestId('existing-shift')
    expect(existing).toHaveTextContent('Limpieza mañana')
    expect(existing).toHaveTextContent('Asignado: Ana Gómez')
    expect(
      screen.getByText(
        'Ese servicio ya tiene un turno el mar 13 oct de 08:00 a 12:00.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Crear igual' })).toBeNull()
    expect(toastError).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Editar ese turno' }))
    expect(await screen.findByText('Editar turno sh9')).toBeInTheDocument()
  })
})

describe('ShiftFormPage — turno pasado: «Registrar como realizado» (OH-09)', () => {
  beforeEach(() => {
    vi.setSystemTime(new Date('2026-11-01T12:00:00-03:00'))
  })

  it('avisa que el turno ya pasó y cambia el botón principal', () => {
    renderPage()
    expect(
      screen.getByRole('button', { name: 'Crear turno' }),
    ).toBeInTheDocument()
    fillBasics()
    expect(screen.getByText('Este turno ya pasó')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Registrar como realizado' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Crear turno' })).toBeNull()
    // Sin repetición ni «A terminar» en este modo, con explicación.
    expect(
      screen.getByRole('switch', { name: 'Repetir este turno' }),
    ).toBeDisabled()
    expect(
      screen.getByText(/Un turno ya realizado no se puede repetir/),
    ).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /A terminar/ })).toBeDisabled()
  })

  it('con la fecha de hoy y el fin todavía sin llegar sigue siendo un alta común', () => {
    vi.setSystemTime(new Date('2026-10-13T10:00:00-03:00'))
    renderPage()
    fillBasics()
    expect(screen.queryByText('Este turno ya pasó')).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Crear turno' }),
    ).toBeInTheDocument()
  })

  it('exige al menos una persona', async () => {
    renderPage()
    fillBasics()
    fireEvent.click(
      screen.getByRole('button', { name: 'Registrar como realizado' }),
    )
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'Elegí al menos una persona: sin asistencia no hay nada que registrar.',
      ),
    )
    expect(registerPastMock).not.toHaveBeenCalled()
    expect(createShiftMock).not.toHaveBeenCalled()
  })

  it('registra con register_past_shift y vuelve al día del turno', async () => {
    renderPage()
    fillBasics()
    fireEvent.click(screen.getByRole('button', { name: 'Elegir empleado' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Registrar como realizado' }),
    )
    await waitFor(() => expect(registerPastMock).toHaveBeenCalledTimes(1))
    expect(registerPastMock.mock.calls[0]?.[0]).toMatchObject({
      clientId: 'c1',
      siteId: 's1',
      date: '2026-10-13',
      start: '08:00',
      end: '12:00',
      employeeIds: ['e1'],
    })
    expect(createShiftMock).not.toHaveBeenCalled()
    expect(toastSuccess).toHaveBeenCalledWith(
      'Registramos el turno como realizado, con la asistencia de 1 persona.',
    )
    expect(
      await screen.findByText('Calendario ?vista=dia&fecha=2026-10-13'),
    ).toBeInTheDocument()
  })

  it('muestra las advertencias (feriado, licencia) en un aviso', async () => {
    registerPastMock.mockResolvedValue({
      shiftId: 'sh-past',
      warnings: ['HOLIDAY', 'ON_LEAVE'],
      warningsDetail: [
        {
          code: 'ON_LEAVE',
          employeeId: 'e1',
          message: 'Ana Gómez tiene licencia el 13 oct.',
        },
      ],
      assigned: [{ employeeId: 'e1', assignmentId: 'as1', warnings: [] }],
      attendance: [],
    })
    renderPage()
    fillBasics()
    fireEvent.click(screen.getByRole('button', { name: 'Elegir empleado' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Registrar como realizado' }),
    )
    await waitFor(() => expect(toastWarning).toHaveBeenCalledTimes(1))
    expect(toastWarning.mock.calls[0]?.[0]).toBe(
      'Registramos el turno como realizado, con advertencias:',
    )
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('si una persona falla muestra el mensaje del servidor y no navega', async () => {
    registerPastMock.mockRejectedValue(
      new ApiError(
        'Gómez: ya está asignada a otro turno en ese horario.',
        'ASSIGNMENT_OVERLAP',
      ),
    )
    renderPage()
    fillBasics()
    fireEvent.click(screen.getByRole('button', { name: 'Elegir empleado' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Registrar como realizado' }),
    )
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'Gómez: ya está asignada a otro turno en ese horario.',
        undefined,
      ),
    )
    expect(screen.queryByText(/^Calendario/)).toBeNull()
  })

  it('sin «Gestionar asistencia» lo explica y no ofrece registrarlo', () => {
    authState.value = { roles: ['admin'], capabilities: [] }
    renderPage()
    fillBasics()
    expect(
      screen.getByText(/hace falta ser de la dirección o de la administración/),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Registrar como realizado' }),
    ).toBeDisabled()
  })

  it('un administrador con «Gestionar asistencia» puede registrarlo', () => {
    authState.value = { roles: ['admin'], capabilities: ['manage_attendance'] }
    renderPage()
    fillBasics()
    expect(
      screen.getByRole('button', { name: 'Registrar como realizado' }),
    ).toBeEnabled()
  })
})
