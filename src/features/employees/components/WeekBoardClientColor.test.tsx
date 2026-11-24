import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  FixedPatternRow,
  WeekBoard,
  WeekBoardBlock,
} from '@/api/employeeFixed'
import { clientChipColors } from '@/features/planning/clientColors'
import { WeekBoardPanel } from './WeekBoard'

/**
 * D-05 (P31.3): en la pizarra semanal el color de cada tarjeta es el de su
 * cliente y «Cambiar color del cliente» lo cambia para todos los calendarios.
 * Archivo aparte: Radix deja estado entre pruebas que abren menús.
 */

const { api, clientsApi } = vi.hoisted(() => ({
  api: {
    fetchEmployeeWeekBoard: vi.fn(),
    fetchEmployeeFixedPattern: vi.fn(),
    saveEmployeeWeekBoard: vi.fn(),
  },
  clientsApi: { setClientCalendarColor: vi.fn() },
}))

vi.mock('@/api/employeeFixed', () => api)
vi.mock('@/api/clients', () => clientsApi)
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ roles: ['owner'], capabilities: [], userId: 'u1' }),
}))

function pattern(over: Partial<FixedPatternRow> = {}): FixedPatternRow {
  return {
    serviceId: 'sv1',
    serviceName: 'Limpieza',
    clientId: 'c1',
    clientName: 'RAESA',
    siteId: 'si1',
    siteName: 'Sede Central',
    calendarColor: 3,
    weekdays: [1],
    weeksOfMonth: null,
    startTime: '08:00:00',
    endTime: '12:00:00',
    openEnded: false,
    validFrom: '2026-01-01',
    validTo: null,
    ...over,
  }
}

function block(over: Partial<WeekBoardBlock> = {}): WeekBoardBlock {
  return {
    id: 'b1',
    weekday: 1,
    start: '08:00',
    end: '12:00',
    label: 'SEDE CENTRAL',
    colorIndex: null,
    serviceId: 'sv1',
    ...over,
  }
}

function board(blocks: WeekBoardBlock[]): WeekBoard {
  return {
    employeeId: 'p1',
    blocks,
    updatedBy: 'u1',
    updatedByName: 'Laura Gómez',
    updatedAt: '2026-11-18T15:30:00Z',
  }
}

function renderBoard() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <WeekBoardPanel profileId="p1" canEdit />
    </QueryClientProvider>,
  )
}

/** Normaliza un color como lo hace el navegador (`#3f6fd8` → `rgb(63, 111, 216)`). */
function normalized(hex: string): string {
  const probe = document.createElement('div')
  probe.style.backgroundColor = hex
  return probe.style.backgroundColor
}

/** Abre el menú con el teclado; Radix deja estado entre pruebas, así que se repite hasta que aparece. */
async function openMenu(trigger: HTMLElement) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    fireEvent.keyDown(trigger, { key: 'Enter' })
    try {
      await screen.findByRole('menu', {}, { timeout: 400 })
      return
    } catch {
      // Se vuelve a intentar.
    }
  }
}

const WAIT = { timeout: 3000 }

beforeEach(() => {
  vi.clearAllMocks()
  api.fetchEmployeeFixedPattern.mockResolvedValue([pattern()])
  api.saveEmployeeWeekBoard.mockImplementation(
    (_id: string, blocks: WeekBoardBlock[]) => Promise.resolve(board(blocks)),
  )
  clientsApi.setClientCalendarColor.mockResolvedValue(undefined)
})

afterEach(() => {
  document.body.removeAttribute('style')
  document.body.removeAttribute('data-scroll-locked')
  ;(document.activeElement as HTMLElement | null)?.blur?.()
})

describe('Cronograma semanal: color único del cliente (D-05)', () => {
  it('la tarjeta se pinta con el color del cliente, aunque la pizarra guardada tenga otro', async () => {
    api.fetchEmployeeWeekBoard.mockResolvedValue(
      board([block({ colorIndex: 9 })]),
    )
    renderBoard()
    const card = await screen.findByTestId('bloque')
    await waitFor(
      () =>
        expect(card.style.backgroundColor).toBe(
          normalized(clientChipColors(3)?.background ?? ''),
        ),
      WAIT,
    )
  })

  it('«Cambiar color del cliente» pide confirmación y cambia el color del cliente, no el de la tarjeta', async () => {
    api.fetchEmployeeWeekBoard.mockResolvedValue(board([block()]))
    renderBoard()
    await openMenu(
      await screen.findByRole('button', { name: /Opciones del bloque/ }),
    )
    const main = await screen.findByRole('menu', {}, WAIT)
    expect(
      within(main).queryByRole('menuitem', { name: 'Cambiar color' }),
    ).toBeNull()
    const trigger = within(main).getByRole('menuitem', {
      name: 'Cambiar color del cliente',
    })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowRight' })
    await waitFor(
      () => expect(screen.getAllByRole('menu')).toHaveLength(2),
      WAIT,
    )
    const sub = screen
      .getAllByRole('menu')
      .find((menu) => menu !== main) as HTMLElement
    fireEvent.click(within(sub).getByRole('menuitem', { name: /Naranja/ }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(
      'Cambia el color de RAESA en todos los calendarios.',
    )
    // Todavía no cambió nada.
    expect(clientsApi.setClientCalendarColor).not.toHaveBeenCalled()
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Cambiar color' }),
    )
    await waitFor(
      () =>
        expect(clientsApi.setClientCalendarColor).toHaveBeenCalledWith(
          'c1',
          2,
          'u1',
        ),
      WAIT,
    )
    // La pizarra no guardó ningún color por tarjeta.
    expect(api.saveEmployeeWeekBoard).not.toHaveBeenCalled()
  })

  it('una tarjeta sin cliente (texto libre) conserva su color propio y su «Cambiar color»', async () => {
    api.fetchEmployeeWeekBoard.mockResolvedValue(
      board([block({ serviceId: null, label: 'LIBRE', colorIndex: 2 })]),
    )
    renderBoard()
    await openMenu(
      await screen.findByRole('button', { name: /Opciones del bloque/ }),
    )
    const main = await screen.findByRole('menu', {}, WAIT)
    expect(
      within(main).getByRole('menuitem', { name: 'Cambiar color' }),
    ).toBeInTheDocument()
    expect(
      within(main).queryByRole('menuitem', {
        name: 'Cambiar color del cliente',
      }),
    ).toBeNull()
  })
})
