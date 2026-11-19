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
import { ApiError } from '@/api/errors'
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

/** Da a cada columna un rectángulo propio (jsdom no calcula layout). */
function layoutColumns() {
  const cells = document.querySelectorAll<HTMLElement>(
    '[data-testid^="columna-"]',
  )
  cells.forEach((cell, index) => {
    const left = index * 100
    cell.getBoundingClientRect = () =>
      ({ left, right: left + 100, top: 0, bottom: 300 }) as DOMRect
  })
}

function pointer(x: number, y: number) {
  return {
    pointerId: 1,
    button: 0,
    pointerType: 'mouse',
    clientX: x,
    clientY: y,
  }
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

describe('Cronograma semanal (OH-07)', () => {
  it('sin pizarra guardada se arma desde los fijos, de lunes a domingo y sin guardar', async () => {
    api.fetchEmployeeWeekBoard.mockResolvedValue(null)
    renderBoard()
    expect(
      await screen.findByText(/Armado desde los fijos/),
    ).toBeInTheDocument()
    expect(screen.getByText('Cronograma semanal')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Referencia de los turnos fijos. Los cambios no modifican el calendario.',
      ),
    ).toBeInTheDocument()
    const headers = screen
      .getAllByRole('columnheader')
      .map((header) => header.textContent)
    expect(headers).toEqual([
      'Lunes',
      'Martes',
      'Miércoles',
      'Jueves',
      'Viernes',
      'Sábado',
      'Domingo',
    ])
    // weekday 1 = lunes y 3 = miércoles.
    expect(
      within(screen.getByTestId('columna-1')).getByText('SEDE CENTRAL'),
    ).toBeInTheDocument()
    expect(
      within(screen.getByTestId('columna-3')).getByText('SEDE CENTRAL'),
    ).toBeInTheDocument()
    expect(
      within(screen.getByTestId('columna-2')).queryByTestId('bloque'),
    ).toBeNull()
    expect(api.saveEmployeeWeekBoard).not.toHaveBeenCalled()
  })

  it('con pizarra guardada la muestra y dice quién la editó', async () => {
    api.fetchEmployeeWeekBoard.mockResolvedValue(
      board([block({ weekday: 0, label: 'DOMINGO SEDE' })]),
    )
    renderBoard()
    expect(
      await within(await screen.findByTestId('columna-0')).findByText(
        'DOMINGO SEDE',
      ),
    ).toBeInTheDocument()
    expect(screen.getByTestId('cronograma-estado')).toHaveTextContent(
      /Editado por Laura Gómez el/,
    )
    expect(api.fetchEmployeeFixedPattern).not.toHaveBeenCalled()
  })

  it('«+» agrega un bloque en ese día', async () => {
    api.fetchEmployeeWeekBoard.mockResolvedValue(board([]))
    renderBoard()
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Agregar un bloque el martes',
      }),
    )
    await waitFor(
      () => expect(api.saveEmployeeWeekBoard).toHaveBeenCalled(),
      SAVE_WAIT,
    )
    const saved = api.saveEmployeeWeekBoard.mock
      .calls[0]?.[1] as WeekBoardBlock[]
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ weekday: 2, start: '08:00', end: '12:00' })
  })

  it('arrastrar un bloque a otro día lo mueve y guarda', async () => {
    api.fetchEmployeeWeekBoard.mockResolvedValue(board([block()]))
    renderBoard()
    const item = await screen.findByTestId('bloque')
    layoutColumns()
    // Lunes es la primera columna (0–100); jueves es la cuarta (300–400).
    fireEvent.pointerDown(item, pointer(50, 50))
    fireEvent.pointerMove(item, pointer(350, 50))
    fireEvent.pointerUp(item, pointer(350, 50))
    await waitFor(
      () => expect(api.saveEmployeeWeekBoard).toHaveBeenCalled(),
      SAVE_WAIT,
    )
    const saved = api.saveEmployeeWeekBoard.mock
      .calls[0]?.[1] as WeekBoardBlock[]
    expect(saved[0]?.weekday).toBe(4)
  })

  it('el arrastre táctil no mueve nada', async () => {
    api.fetchEmployeeWeekBoard.mockResolvedValue(board([block()]))
    renderBoard()
    const item = await screen.findByTestId('bloque')
    layoutColumns()
    const touch = (x: number) => ({ ...pointer(x, 50), pointerType: 'touch' })
    fireEvent.pointerDown(item, touch(50))
    fireEvent.pointerMove(item, touch(350))
    fireEvent.pointerUp(item, touch(350))
    await new Promise((resolve) => setTimeout(resolve, 800))
    expect(api.saveEmployeeWeekBoard).not.toHaveBeenCalled()
  })

  it('el menú duplica y borra', async () => {
    api.fetchEmployeeWeekBoard.mockResolvedValue(board([block()]))
    renderBoard()
    const trigger = await screen.findByRole('button', {
      name: /Opciones del bloque/,
    })
    openMenu(trigger)
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Duplicar' }, SAVE_WAIT),
    )
    await waitFor(
      () => expect(api.saveEmployeeWeekBoard).toHaveBeenCalledTimes(1),
      SAVE_WAIT,
    )
    expect(
      (api.saveEmployeeWeekBoard.mock.calls[0]?.[1] as WeekBoardBlock[]).length,
    ).toBe(2)

    await waitFor(() => expect(screen.getAllByTestId('bloque')).toHaveLength(2))
    openMenu(
      screen.getAllByRole('button', {
        name: /Opciones del bloque/,
      })[0] as HTMLElement,
    )
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Borrar' }, SAVE_WAIT),
    )
    await waitFor(
      () => expect(api.saveEmployeeWeekBoard).toHaveBeenCalledTimes(2),
      SAVE_WAIT,
    )
    expect(
      (api.saveEmployeeWeekBoard.mock.calls[1]?.[1] as WeekBoardBlock[]).length,
    ).toBe(1)
  })

  it('tocar el nombre lo edita en el lugar', async () => {
    api.fetchEmployeeWeekBoard.mockResolvedValue(board([block()]))
    renderBoard()
    fireEvent.click(
      await screen.findByRole('button', { name: /Editar el nombre/ }),
    )
    const input = screen.getByLabelText('Nombre del bloque')
    fireEvent.change(input, { target: { value: 'OFICINA' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(
      () => expect(api.saveEmployeeWeekBoard).toHaveBeenCalled(),
      SAVE_WAIT,
    )
    expect(
      (api.saveEmployeeWeekBoard.mock.calls[0]?.[1] as WeekBoardBlock[])[0]
        ?.label,
    ).toBe('OFICINA')
  })

  it('muestra el mensaje de INVALID_BOARD', async () => {
    api.fetchEmployeeWeekBoard.mockResolvedValue(board([]))
    api.saveEmployeeWeekBoard.mockRejectedValue(
      new ApiError('El bloque 1 no tiene un formato válido.', 'INVALID_BOARD'),
    )
    renderBoard()
    fireEvent.click(
      await screen.findByRole('button', { name: 'Agregar un bloque el lunes' }),
    )
    expect(
      await screen.findByText(
        'El bloque 1 no tiene un formato válido.',
        {},
        SAVE_WAIT,
      ),
    ).toBeInTheDocument()
  })

  it('«Volver a cargar desde los fijos» pide confirmación y reemplaza la pizarra', async () => {
    api.fetchEmployeeWeekBoard.mockResolvedValue(
      board([block({ id: 'viejo', weekday: 5, label: 'VIEJO' })]),
    )
    renderBoard()
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Volver a cargar desde los fijos',
      }),
    )
    expect(api.saveEmployeeWeekBoard).not.toHaveBeenCalled()
    fireEvent.click(
      await screen.findByRole('button', { name: 'Volver a cargar' }),
    )
    await waitFor(
      () => expect(api.saveEmployeeWeekBoard).toHaveBeenCalledTimes(1),
      SAVE_WAIT,
    )
    const saved = api.saveEmployeeWeekBoard.mock
      .calls[0]?.[1] as WeekBoardBlock[]
    expect(saved.map((b) => b.label)).toEqual(['SEDE CENTRAL', 'SEDE CENTRAL'])
    expect(saved.map((b) => b.weekday)).toEqual([1, 3])
  })

  it('sin permiso de edición no se pide la pizarra', () => {
    renderBoard(false)
    expect(api.fetchEmployeeWeekBoard).not.toHaveBeenCalled()
  })

  // Va al final: la casilla de hora enfocada deja a Radix sin abrir menús en la prueba que sigue.
  it('al editar una hora guarda toda la pizarra y pasa a «Editado por»', async () => {
    api.fetchEmployeeWeekBoard.mockResolvedValue(null)
    renderBoard()
    const name = /Hora de inicio de SEDE CENTRAL/
    const [startCell] = await screen.findAllByRole('button', { name })
    fireEvent.click(startCell as HTMLElement)
    const input = screen.getByRole('textbox', { name })
    fireEvent.change(input, { target: { value: '09:15' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(
      () => expect(api.saveEmployeeWeekBoard).toHaveBeenCalledTimes(1),
      SAVE_WAIT,
    )
    const [employeeId, saved] = api.saveEmployeeWeekBoard.mock.calls[0] as [
      string,
      WeekBoardBlock[],
    ]
    expect(employeeId).toBe('p1')
    expect(saved).toHaveLength(2)
    expect(saved.map((b) => b.start).sort()).toEqual(['08:00', '09:15'])
    await waitFor(
      () =>
        expect(screen.getByTestId('cronograma-estado')).toHaveTextContent(
          /Editado por Laura Gómez/,
        ),
      SAVE_WAIT,
    )
  })
})
