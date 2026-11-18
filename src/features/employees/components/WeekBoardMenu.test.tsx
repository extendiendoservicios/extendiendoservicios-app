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
import { WeekBoardPanel } from './WeekBoard'

const { api } = vi.hoisted(() => ({
  api: {
    fetchEmployeeWeekBoard: vi.fn(),
    fetchEmployeeFixedPattern: vi.fn(),
    saveEmployeeWeekBoard: vi.fn(),
  },
}))

vi.mock('@/api/employeeFixed', () => api)

function pattern(over: Partial<FixedPatternRow> = {}): FixedPatternRow {
  return {
    serviceId: 'sv1',
    serviceName: 'Limpieza',
    clientId: 'c1',
    clientName: 'Cliente',
    siteId: 'si1',
    siteName: 'Sede Central',
    calendarColor: 3,
    weekdays: [1, 3],
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
    label: 'SEDE',
    colorIndex: 2,
    serviceId: null,
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

function renderBoard(canEdit = true) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <WeekBoardPanel profileId="p1" canEdit={canEdit} />
    </QueryClientProvider>,
  )
}

const SAVE_WAIT = { timeout: 3000 }

/** Abre el menú de un bloque con el teclado (más estable que el puntero entre pruebas). */
function openMenu(trigger: HTMLElement) {
  fireEvent.keyDown(trigger, { key: 'Enter' })
}

beforeEach(() => {
  vi.clearAllMocks()
  api.fetchEmployeeFixedPattern.mockResolvedValue([pattern()])
  api.saveEmployeeWeekBoard.mockImplementation(
    (_id: string, blocks: WeekBoardBlock[]) => Promise.resolve(board(blocks)),
  )
})

afterEach(() => {
  document.body.removeAttribute('style')
  document.body.removeAttribute('data-scroll-locked')
  ;(document.activeElement as HTMLElement | null)?.blur?.()
})

// Archivo aparte: Radix deja estado entre pruebas que abren menús.
describe('Cronograma semanal: submenús del bloque (DEF-P30-09)', () => {
  it('DEF-P30-09: los submenús «Cambiar color» y «Mover a» se ven fuera del menú principal y funcionan', async () => {
    api.fetchEmployeeWeekBoard.mockResolvedValue(
      board([block({ colorIndex: 0 })]),
    )
    renderBoard()
    openMenu(await screen.findByRole('button', { name: /Opciones del bloque/ }))
    const main = await screen.findByRole('menu', {}, SAVE_WAIT)
    const trigger = within(main).getByRole('menuitem', {
      name: 'Cambiar color',
    })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowRight' })
    await waitFor(
      () => expect(screen.getAllByRole('menu')).toHaveLength(2),
      SAVE_WAIT,
    )
    const sub = screen
      .getAllByRole('menu')
      .find((menu) => menu !== main) as HTMLElement
    // En un portal: no queda recortado por el overflow del menú principal.
    expect(main.contains(sub)).toBe(false)
    fireEvent.click(within(sub).getAllByRole('menuitem')[2] as HTMLElement)
    await waitFor(
      () => expect(api.saveEmployeeWeekBoard).toHaveBeenCalledTimes(1),
      SAVE_WAIT,
    )
    expect(
      (api.saveEmployeeWeekBoard.mock.calls[0]?.[1] as WeekBoardBlock[])[0]
        ?.colorIndex,
    ).toBe(2)

    openMenu(await screen.findByRole('button', { name: /Opciones del bloque/ }))
    const main2 = await screen.findByRole('menu', {}, SAVE_WAIT)
    const moveTrigger = within(main2).getByRole('menuitem', { name: 'Mover a' })
    moveTrigger.focus()
    fireEvent.keyDown(moveTrigger, { key: 'ArrowRight' })
    await waitFor(
      () => expect(screen.getAllByRole('menu')).toHaveLength(2),
      SAVE_WAIT,
    )
    const sub2 = screen
      .getAllByRole('menu')
      .find((menu) => menu !== main2) as HTMLElement
    fireEvent.click(within(sub2).getByRole('menuitem', { name: /Martes/ }))
    await waitFor(
      () => expect(api.saveEmployeeWeekBoard).toHaveBeenCalledTimes(2),
      SAVE_WAIT,
    )
    expect(
      (api.saveEmployeeWeekBoard.mock.calls[1]?.[1] as WeekBoardBlock[])[0]
        ?.weekday,
    ).toBe(2)
    // Que no quede ningún menú abierto para las pruebas que siguen.
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })
})
