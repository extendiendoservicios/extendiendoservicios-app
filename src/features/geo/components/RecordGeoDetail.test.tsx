import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardAttendanceGeo } from '@/api/attendance'
import { ApiError } from '@/api/errors'

const { correctMock, overrideMock, toastError, toastSuccess } = vi.hoisted(
  () => ({
    correctMock: vi.fn(),
    overrideMock: vi.fn(),
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
  }),
)

vi.mock('@/api/geo', () => ({
  correctAttendanceTime: correctMock,
  overrideGeoValidation: overrideMock,
  fetchAttendanceLocation: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { error: toastError, success: toastSuccess },
}))

// Leaflet no corre en jsdom: el mini mapa se reemplaza por un marcador de prueba.
vi.mock('@/components/map', () => ({
  GeofenceMiniMap: () => <div data-testid="mini-map" />,
}))

const { RecordGeoDetail } = await import('./RecordGeoDetail')

function geo(overrides: Partial<BoardAttendanceGeo> = {}): BoardAttendanceGeo {
  return {
    recordId: 'r1',
    status: 'outside',
    reason: null,
    distanceM: 350,
    radiusM: 150,
    accuracyM: 20,
    outsideReason: null,
    overridden: false,
    timeCorrected: false,
    ...overrides,
  }
}

function renderDetail(
  props: Partial<React.ComponentProps<typeof RecordGeoDetail>> = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <RecordGeoDetail
        recordType="attendance"
        kind="check_in"
        recordedAt="2026-10-01T11:00:00Z"
        shiftDate="2026-10-01"
        geo={geo()}
        canManage
        {...props}
      />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  correctMock.mockReset()
  overrideMock.mockReset()
  toastError.mockReset()
  toastSuccess.mockReset()
})

describe('RecordGeoDetail (ADM-06, B-09, B-28)', () => {
  it('muestra la validación, la distancia, la precisión y el motivo del empleado', () => {
    renderDetail({
      geo: geo({ outsideReason: 'El GPS no anda en el subsuelo' }),
    })

    expect(screen.getByText('Inicio 08:00')).toBeInTheDocument()
    expect(screen.getByText('Fuera de zona')).toBeInTheDocument()
    expect(screen.getByText(/350 m/)).toBeInTheDocument()
    expect(screen.getByText(/radio 150 m/)).toBeInTheDocument()
    expect(screen.getByText('20 m')).toBeInTheDocument()
    expect(
      screen.getByText(/El GPS no anda en el subsuelo/),
    ).toBeInTheDocument()
  })

  it('con rojo o gris sin corregir ofrece «Corregir hora» y «Marcar como válido»', () => {
    renderDetail()
    expect(
      screen.getByRole('button', { name: 'Corregir hora' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Marcar como válido' }),
    ).toBeInTheDocument()
  })

  it('el gris también se puede marcar como válido y muestra el motivo', () => {
    renderDetail({
      geo: geo({
        status: 'unvalidated',
        reason: 'low_accuracy',
        distanceM: null,
      }),
    })
    expect(
      screen.getByText('Sin validar (precisión insuficiente)'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Marcar como válido' }),
    ).toBeInTheDocument()
  })

  it('un fichaje validado no ofrece «Marcar como válido»', () => {
    renderDetail({ geo: geo({ status: 'valid', distanceM: 10 }) })
    expect(screen.getByText('Validado')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Marcar como válido' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Corregir hora' }),
    ).toBeInTheDocument()
  })

  it('uno ya corregido se ve «Validado (corregido)» y no se puede volver a marcar', () => {
    renderDetail({ geo: geo({ status: 'outside', overridden: true }) })
    expect(screen.getByText('Validado (corregido)')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Marcar como válido' }),
    ).not.toBeInTheDocument()
  })

  it('marca «Corregido» junto a la hora corregida', () => {
    renderDetail({ geo: geo({ timeCorrected: true }) })
    expect(screen.getByText('Corregido')).toBeInTheDocument()
  })

  it('sin capacidad de asistencia no hay acciones de corrección', () => {
    renderDetail({ canManage: false })
    expect(
      screen.queryByRole('button', { name: 'Corregir hora' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Marcar como válido' }),
    ).not.toBeInTheDocument()
    // La lectura sigue: el mapa se puede ver.
    expect(
      screen.getByRole('button', { name: 'Ver en el mapa' }),
    ).toBeInTheDocument()
  })

  it('en una supervisión no se corrige la hora, pero sí la validación', () => {
    renderDetail({ recordType: 'supervision' })
    expect(
      screen.queryByRole('button', { name: 'Corregir hora' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Marcar como válido' }),
    ).toBeInTheDocument()
  })

  it('el mini mapa solo aparece si el fichaje tiene posición, y recién al pedirlo', () => {
    const { unmount } = renderDetail({ geo: geo({ accuracyM: null }) })
    expect(
      screen.queryByRole('button', { name: 'Ver en el mapa' }),
    ).not.toBeInTheDocument()
    unmount()

    renderDetail()
    expect(screen.queryByTestId('mini-map')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ver en el mapa' }))
    expect(
      screen.getByRole('button', { name: 'Ocultar mapa' }),
    ).toBeInTheDocument()
  })

  it('«Marcar como válido» exige motivo y llama a override_geo_validation', async () => {
    overrideMock.mockResolvedValue(undefined)
    renderDetail({ recordType: 'supervision' })

    fireEvent.click(screen.getByRole('button', { name: 'Marcar como válido' }))
    const confirm = screen
      .getAllByRole('button', { name: 'Marcar como válido' })
      .pop()!
    expect(confirm).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Motivo'), {
      target: { value: 'Subsuelo sin GPS' },
    })
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)

    await waitFor(() =>
      expect(overrideMock).toHaveBeenCalledWith(
        'supervision',
        'r1',
        'Subsuelo sin GPS',
      ),
    )
    expect(toastSuccess).toHaveBeenCalledWith(
      'Marcamos el fichaje como válido.',
    )
  })

  it('un error del servidor se muestra con su mensaje en español', async () => {
    overrideMock.mockRejectedValue(
      new ApiError('mensaje crudo', 'GEO_ALREADY_OVERRIDDEN'),
    )
    renderDetail()

    fireEvent.click(screen.getByRole('button', { name: 'Marcar como válido' }))
    fireEvent.change(screen.getByLabelText('Motivo'), {
      target: { value: 'x' },
    })
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Marcar como válido' }).pop()!,
    )

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'Este fichaje ya fue marcado como válido.',
      ),
    )
  })

  it('«Corregir hora» pide hora y motivo y llama a correct_attendance_time con -03:00', async () => {
    correctMock.mockResolvedValue(undefined)
    renderDetail()

    fireEvent.click(screen.getByRole('button', { name: 'Corregir hora' }))
    const dialog = screen.getByRole('dialog')
    expect(
      screen.getByRole('heading', { name: 'Corregir hora de inicio' }),
    ).toBeInTheDocument()

    // Sin motivo no se envía.
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Corregir hora' }),
    )
    expect(correctMock).not.toHaveBeenCalled()
    expect(await screen.findByText('Escribí el motivo.')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Hora nueva'), {
      target: { value: '2026-10-01T08:30' },
    })
    fireEvent.change(screen.getByLabelText('Motivo'), {
      target: { value: 'Fichó tarde por falta de señal' },
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Corregir hora' }),
    )

    await waitFor(() =>
      expect(correctMock).toHaveBeenCalledWith(
        'r1',
        '2026-10-01T08:30:00-03:00',
        'Fichó tarde por falta de señal',
      ),
    )
  })

  it('«Corregir hora» rechaza una hora anterior al día del turno', async () => {
    renderDetail()

    fireEvent.click(screen.getByRole('button', { name: 'Corregir hora' }))
    fireEvent.change(screen.getByLabelText('Hora nueva'), {
      target: { value: '2026-09-30T23:00' },
    })
    fireEvent.change(screen.getByLabelText('Motivo'), {
      target: { value: 'x' },
    })
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Corregir hora',
      }),
    )

    expect(
      await screen.findByText(
        'La hora tiene que estar entre las 0:00 del día del turno y este momento.',
      ),
    ).toBeInTheDocument()
    expect(correctMock).not.toHaveBeenCalled()
  })
})
