import { fireEvent, screen, waitFor } from '@testing-library/react'
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkdayBar } from './WorkdayBar'
import * as workdaysModule from '@/api/myWorkdays'
import { ApiError } from '@/api/errors'
import * as geolocationModule from '@/lib/geolocation'
import { makeWorkday, makeWorkdaySupervision } from '../fixtures'
import { mockCommonHooks, renderRoute } from '../testUtils'

vi.mock('@/features/settings/queries', () => ({
  useCompanySettingsQuery: () => ({
    data: { locationConsentText: 'Texto de consentimiento de la empresa' },
  }),
}))

/**
 * Barra de jornada de SUP-02 (P24.2): cómo se ve cada estado, qué botones
 * ofrece y que cada botón pide la posición con el flujo de consentimiento
 * pero registra igual sin ella (CJ-21).
 */
function mockWorkday(
  workday: ReturnType<typeof makeWorkday> | null,
  mutateAsync = vi.fn().mockResolvedValue({}),
) {
  vi.spyOn(workdaysModule, 'useTodayWorkdayQuery').mockReturnValue({
    data: workday,
    isLoading: false,
    isError: false,
    dataUpdatedAt: Date.now(),
  } as never)
  vi.spyOn(workdaysModule, 'useWorkdayActionMutation').mockReturnValue({
    mutateAsync,
    isPending: false,
  } as never)
  return mutateAsync
}

function renderBar() {
  return renderRoute(<WorkdayBar />, { path: '/sup', entry: '/sup' })
}

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('WorkdayBar: contador con segundos', () => {
  function mockFixedRead(workday: ReturnType<typeof makeWorkday>) {
    vi.spyOn(workdaysModule, 'useTodayWorkdayQuery').mockReturnValue({
      data: workday,
      isLoading: false,
      isError: false,
      dataUpdatedAt: Date.now(),
    } as never)
    vi.spyOn(workdaysModule, 'useWorkdayActionMutation').mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as never)
  }

  afterEach(() => {
    vi.useRealTimers()
  })

  it('en marcha corre segundo a segundo y rotula por minuto', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    mockCommonHooks()
    mockFixedRead(makeWorkday({ workedMinutes: 95 }))
    renderBar()

    const counter = screen.getByTestId('workday-counter')
    expect(counter).toHaveTextContent('1:35:00')
    act(() => {
      vi.advanceTimersByTime(7_000)
    })
    expect(counter).toHaveTextContent('1:35:07')
    expect(counter).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByTestId('workday-counter-label')).toHaveTextContent(
      '1 h 35 min trabajados',
    )
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(counter).toHaveTextContent('1:36:07')
  })

  it('en pausa queda fijo y no arma el tic de un segundo', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    const spy = vi.spyOn(globalThis, 'setInterval')
    mockCommonHooks()
    mockFixedRead(makeWorkday({ state: 'paused', workedMinutes: 95 }))
    renderBar()
    const ticks = spy.mock.calls.filter(([, ms]) => ms === 1000)
    expect(ticks).toHaveLength(0)

    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(screen.getByTestId('workday-counter')).toHaveTextContent('1:35:00')
  })
})

describe('WorkdayBar: estados', () => {
  it('sin iniciar: ofrece solo «Iniciar jornada»', () => {
    mockCommonHooks()
    mockWorkday(null)
    renderBar()

    expect(screen.getByText('Sin iniciar')).toBeInTheDocument()
    expect(
      screen.getByText('Todavía no iniciaste la jornada.'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Iniciar jornada' }),
    ).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Pausar' })).toBeNull()
  })

  it('en actividad: muestra las horas netas y ofrece Pausar y Finalizar', () => {
    mockCommonHooks()
    mockWorkday(makeWorkday({ workedMinutes: 125 }))
    renderBar()

    expect(screen.getByText('En actividad')).toBeInTheDocument()
    expect(screen.getByTestId('workday-counter')).toHaveTextContent('2:05:00')
    expect(screen.getByRole('button', { name: 'Pausar' })).toBeEnabled()
    expect(
      screen.getByRole('button', { name: 'Finalizar jornada' }),
    ).toBeEnabled()
  })

  it('supervisando: dice dónde y deshabilita Pausar y Finalizar con su motivo (CJ-29)', () => {
    mockCommonHooks()
    mockWorkday(makeWorkday({ supervisions: [makeWorkdaySupervision()] }))
    renderBar()

    expect(screen.getByText('Supervisando')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Limpiadora SRL · Sede Centro' }),
    ).toHaveAttribute('href', '/sup/supervisiones/sv1')
    expect(screen.getByRole('button', { name: 'Pausar' })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Finalizar jornada' }),
    ).toBeDisabled()
    expect(
      screen.getByText(/Cerrá o descartá tu supervisión/),
    ).toBeInTheDocument()
  })

  it('en pausa: ofrece Reanudar y Finalizar, y muestra desde cuándo y el motivo', () => {
    mockCommonHooks()
    mockWorkday(
      makeWorkday({
        state: 'paused',
        pauseMinutes: 10,
        pauses: [
          {
            type: 'pause',
            startsAt: '2026-10-23T15:00:00Z',
            endsAt: null,
            minutes: 10,
            reason: 'Almuerzo',
          },
        ],
      }),
    )
    renderBar()

    expect(screen.getByText('En pausa')).toBeInTheDocument()
    expect(
      screen.getByText(/En pausa desde las 12:00 · Almuerzo/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reanudar' })).toBeEnabled()
    expect(
      screen.getByRole('button', { name: 'Finalizar jornada' }),
    ).toBeEnabled()
  })

  it('finalizada: muestra el horario y ofrece Reabrir jornada', () => {
    mockCommonHooks()
    mockWorkday(
      makeWorkday({ state: 'ended', endedAt: '2026-10-23T20:00:00Z' }),
    )
    renderBar()

    expect(screen.getByText('Finalizada')).toBeInTheDocument()
    expect(screen.getByText(/Finalizada a las 17:00/)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Reabrir jornada' }),
    ).toBeEnabled()
  })

  it('cerrada automáticamente: avisa que se cerró sola y deja reabrirla (CJ-31)', () => {
    mockCommonHooks()
    mockWorkday(
      makeWorkday({
        state: 'ended',
        endedAt: '2026-10-24T02:55:00Z',
        autoClosed: true,
        autoCloseWarning: true,
      }),
    )
    renderBar()

    expect(
      screen.getAllByText('Cerrada automáticamente').length,
    ).toBeGreaterThan(0)
    expect(
      screen.getByText(/Tu jornada se cerró sola a las 23:55/),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Reabrir jornada' }),
    ).toBeEnabled()
  })

  it('sin conexión deshabilita los botones y avisa', () => {
    mockCommonHooks({ online: false })
    mockWorkday(null)
    renderBar()

    expect(screen.getByText(/Estás sin conexión/)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Iniciar jornada' }),
    ).toBeDisabled()
  })
})

describe('WorkdayBar: posición y consentimiento (CJ-20, CJ-21)', () => {
  it('sin consentimiento aceptado registra igual, sin coordenadas', async () => {
    mockCommonHooks({ consent: 'declined' })
    const mutateAsync = mockWorkday(null)
    const position = vi.spyOn(geolocationModule, 'getCurrentPositionSafe')
    renderBar()

    fireEvent.click(screen.getByRole('button', { name: 'Iniciar jornada' }))

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        action: 'start',
        coords: null,
        reason: null,
      }),
    )
    expect(position).not.toHaveBeenCalled()
  })

  it('con consentimiento pide la posición y la manda', async () => {
    mockCommonHooks({ consent: 'granted' })
    const mutateAsync = mockWorkday(null)
    const coords = { lat: -34.47, lng: -58.5, accuracyM: 10 }
    vi.spyOn(geolocationModule, 'getCurrentPositionSafe').mockResolvedValue(
      coords,
    )
    renderBar()

    fireEvent.click(screen.getByRole('button', { name: 'Iniciar jornada' }))

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        action: 'start',
        coords,
        reason: null,
      }),
    )
  })

  it('con consentimiento pero sin señal (la posición no llega) registra igual sin coordenadas', async () => {
    mockCommonHooks({ consent: 'granted' })
    const mutateAsync = mockWorkday(makeWorkday())
    vi.spyOn(geolocationModule, 'getCurrentPositionSafe').mockResolvedValue(
      null,
    )
    renderBar()

    fireEvent.click(screen.getByRole('button', { name: 'Finalizar jornada' }))

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        action: 'end',
        coords: null,
        reason: null,
      }),
    )
  })

  it('si falta el consentimiento muestra el texto de la empresa antes y, al seguir sin ubicación, registra igual', async () => {
    mockCommonHooks({ consent: 'needs-consent' })
    const mutateAsync = mockWorkday(null)
    renderBar()

    fireEvent.click(screen.getByRole('button', { name: 'Iniciar jornada' }))

    expect(
      await screen.findByText('Texto de consentimiento de la empresa'),
    ).toBeInTheDocument()
    expect(mutateAsync).not.toHaveBeenCalled()

    fireEvent.click(
      screen.getByRole('button', { name: 'Continuar sin ubicación' }),
    )

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        action: 'start',
        coords: null,
        reason: null,
      }),
    )
  })
})

describe('WorkdayBar: pausa y errores', () => {
  it('el cartel de pausa apila los botones a lo ancho, con Pausar arriba (P24.7a)', () => {
    mockCommonHooks()
    mockWorkday(makeWorkday())
    renderBar()

    fireEvent.click(screen.getByRole('button', { name: 'Pausar' }))
    const footer = document.querySelector('[data-slot="dialog-footer"]')
    expect(footer).toHaveClass('flex-col', 'sm:flex-col')
    const buttons = footer?.querySelectorAll('button') ?? []
    expect(buttons[0]).toHaveTextContent('Pausar')
    expect(buttons[1]).toHaveTextContent('Cancelar')
  })

  it('Pausar abre el motivo (opcional) y lo manda con la acción', async () => {
    mockCommonHooks()
    const mutateAsync = mockWorkday(makeWorkday())
    renderBar()

    fireEvent.click(screen.getByRole('button', { name: 'Pausar' }))
    fireEvent.change(screen.getByLabelText('Motivo de la pausa'), {
      target: { value: ' Almuerzo ' },
    })
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Pausar' }).at(-1) as HTMLElement,
    )

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        action: 'pause',
        coords: null,
        reason: 'Almuerzo',
      }),
    )
  })

  it('se puede pausar sin motivo', async () => {
    mockCommonHooks()
    const mutateAsync = mockWorkday(makeWorkday())
    renderBar()

    fireEvent.click(screen.getByRole('button', { name: 'Pausar' }))
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Pausar' }).at(-1) as HTMLElement,
    )

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        action: 'pause',
        coords: null,
        reason: null,
      }),
    )
  })

  it('el motivo no puede pasar de 300 caracteres y no se manda', () => {
    mockCommonHooks()
    const mutateAsync = mockWorkday(makeWorkday())
    renderBar()

    fireEvent.click(screen.getByRole('button', { name: 'Pausar' }))
    fireEvent.change(screen.getByLabelText('Motivo de la pausa'), {
      target: { value: 'a'.repeat(301) },
    })
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Pausar' }).at(-1) as HTMLElement,
    )

    expect(
      screen.getByText('El motivo puede tener hasta 300 caracteres.'),
    ).toBeInTheDocument()
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('traduce el error de la base a un mensaje claro', async () => {
    mockCommonHooks()
    const mutateAsync = mockWorkday(
      null,
      vi.fn().mockRejectedValue(new ApiError('texto crudo', 'ON_LEAVE')),
    )
    renderBar()

    fireEvent.click(screen.getByRole('button', { name: 'Iniciar jornada' }))

    expect(
      await screen.findByText(
        'Tenés licencia hoy: no podés iniciar la jornada.',
      ),
    ).toBeInTheDocument()
    expect(mutateAsync).toHaveBeenCalledTimes(1)
  })
})
