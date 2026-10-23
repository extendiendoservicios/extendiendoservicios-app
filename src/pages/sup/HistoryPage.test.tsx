import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import HistoryPage from './HistoryPage'
import * as workdaysModule from '@/api/myWorkdays'
import {
  makeWorkday,
  makeWorkdaySupervision,
} from '@/features/coordinator/fixtures'

/**
 * SUP-08 (P24.2): jornadas por día, con horas netas, pausas y supervisiones.
 * El tiempo de cada supervisión es informativo (CJ-14).
 */
function mockHistory(data: workdaysModule.MyWorkday[] | undefined) {
  vi.spyOn(workdaysModule, 'useMyWorkdaysHistoryQuery').mockReturnValue({
    data,
    isLoading: false,
    isError: data === undefined,
  } as never)
}

function renderPage() {
  return render(
    <MemoryRouter>
      <HistoryPage />
    </MemoryRouter>,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('HistoryPage (SUP-08)', () => {
  it('lista cada jornada con las horas netas, el horario y las pausas', () => {
    mockHistory([
      makeWorkday({
        state: 'ended',
        startedAt: '2026-10-22T11:00:00Z',
        endedAt: '2026-10-22T20:30:00Z',
        workDate: '2026-10-22',
        workedMinutes: 480,
        pauseMinutes: 60,
        pauses: [
          {
            type: 'pause',
            startsAt: '2026-10-22T15:00:00Z',
            endsAt: '2026-10-22T16:00:00Z',
            minutes: 60,
            reason: null,
          },
        ],
      }),
    ])
    renderPage()

    expect(screen.getByText('8 h')).toBeInTheDocument()
    expect(screen.getByText('08:00 a 17:30')).toBeInTheDocument()
    expect(screen.getByText('1 pausa · 1 h')).toBeInTheDocument()
    expect(screen.getByText('Finalizada')).toBeInTheDocument()
  })

  it('muestra las supervisiones de la jornada con su duración informativa y un enlace a cada una', () => {
    mockHistory([
      makeWorkday({
        id: 'wd2',
        state: 'ended',
        endedAt: '2026-10-23T20:00:00Z',
        supervisions: [
          makeWorkdaySupervision({
            status: 'completed',
            checkOutAt: '2026-10-23T12:45:00Z',
            durationMinutes: 45,
          }),
        ],
      }),
    ])
    renderPage()

    const link = screen.getByText('Limpiadora SRL · Sede Centro').closest('a')
    expect(link).toHaveAttribute('href', '/sup/supervisiones/sv1')
    expect(screen.getByText(/45 min/)).toBeInTheDocument()
  })

  it('marca la jornada cerrada automáticamente y la supervisión «Sin cerrar» (CJ-31)', () => {
    mockHistory([
      makeWorkday({
        state: 'ended',
        autoClosed: true,
        autoCloseWarning: true,
        endedAt: '2026-10-24T02:55:00Z',
        supervisions: [
          makeWorkdaySupervision({
            checkOutAt: '2026-10-24T02:55:00Z',
            unclosed: true,
          }),
        ],
      }),
    ])
    renderPage()

    expect(screen.getByText('Cerrada automáticamente')).toBeInTheDocument()
    expect(
      screen.getByText(/Se cerró sola porque no la finalizaste/),
    ).toBeInTheDocument()
    expect(screen.getByText('Sin cerrar')).toBeInTheDocument()
  })

  it('indica si la administración corrigió la jornada', () => {
    mockHistory([makeWorkday({ state: 'ended', corrected: true })])
    renderPage()

    expect(
      screen.getByText('Corregida por la administración.'),
    ).toBeInTheDocument()
  })

  it('sin jornadas muestra el estado vacío', () => {
    mockHistory([])
    renderPage()

    expect(screen.getByText('Todavía no tenés jornadas')).toBeInTheDocument()
  })

  it('si falla la carga, avisa', () => {
    mockHistory(undefined)
    renderPage()

    expect(
      screen.getByText(/No pudimos cargar tu historial/),
    ).toBeInTheDocument()
  })
})
