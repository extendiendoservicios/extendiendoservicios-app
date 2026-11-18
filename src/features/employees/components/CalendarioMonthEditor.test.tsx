import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssignmentBoardRow } from '@/api/assignments'
import type { ShiftListRow } from '@/api/shifts'
import { ApiError, type ConflictDetail } from '@/api/errors'
import { clientChipColors } from '@/features/planning/clientColors'
import { buildCronogramaMonth } from '@/features/employees/cronograma'
import { buildWeekBlocks } from '@/features/employees/cronogramaWeek'
import { CalendarioMonthEditor } from './CalendarioMonthEditor'

const { run, toastApi } = vi.hoisted(() => ({
  run: vi.fn(),
  toastApi: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))

vi.mock('sonner', () => ({ toast: toastApi }))
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ roles: ['owner'], capabilities: [] }),
}))
vi.mock('@/features/employees/cronogramaCommands', () => ({
  runCronogramaCommand: run,
}))
vi.mock('@/features/planning/queries', () => ({
  planningKeys: { all: ['planning'] },
  useAssignEmployeeMutation: () => ({ mutateAsync: vi.fn() }),
  useRemoveAssignmentMutation: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useAssignCandidatesQuery: () => ({ data: [] }),
}))
vi.mock('@/features/shifts/queries', () => ({
  shiftsKeys: { all: ['shifts'] },
}))

const DAY = '2026-11-03'
const OTHER_DAY = '2026-11-10'

function shiftRow(over: Partial<ShiftListRow>): ShiftListRow {
  return {
    id: 's1',
    clientId: 'c1',
    clientName: 'Cliente',
    clientCalendarColor: 0,
    siteId: 'si1',
    siteName: 'Sede Central',
    siteCity: null,
    shiftDate: DAY,
    startTime: '08:00:00',
    endTime: '12:00:00',
    requiredStaff: 1,
    status: 'assigned',
    displayStatus: 'assigned',
    assignedCount: 1,
    openEnded: false,
    ...over,
  } as ShiftListRow
}

function assignmentRow(over: Partial<AssignmentBoardRow>): AssignmentBoardRow {
  return {
    id: 'a1',
    shiftId: 's1',
    shiftDate: DAY,
    shiftStatus: 'assigned',
    employeeId: 'e1',
    employeeFirstName: 'Ana',
    employeeLastName: 'Prueba',
    siteId: 'si1',
    siteName: 'Sede Central',
    clientName: 'Cliente',
    clientId: 'c1',
    clientCalendarColor: 0,
    startTime: '08:00:00',
    endTime: '12:00:00',
    openEnded: false,
    status: 'expected',
    notes: null,
    ...over,
  }
}

function LocationProbe() {
  const location = useLocation()
  return <span data-testid="ruta">{location.pathname}</span>
}

interface RenderState {
  assignments: AssignmentBoardRow[]
  shifts: ShiftListRow[]
  leaves?: {
    id: string
    startsOn: string
    endsOn: string | null
    reason: string | null
    deletedAt: null
  }[]
  holidays?: { holidayDate: string; deletedAt: null }[]
}

function renderEditor(state: RenderState, canEdit = true) {
  const month = buildCronogramaMonth({
    year: 2026,
    month: 11,
    assignments: state.assignments,
    leaves: state.leaves ?? [],
    holidays: state.holidays ?? [],
  })
  const blocks = buildWeekBlocks(state.assignments, state.shifts)
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/']}>
        <LocationProbe />
        <Routes>
          <Route
            path="*"
            element={
              <CalendarioMonthEditor
                profileId="p1"
                personName="Ana Prueba"
                month={month}
                blocks={blocks}
                allShifts={state.shifts}
                canEdit={canEdit}
              />
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

let assignments: AssignmentBoardRow[]
let shifts: ShiftListRow[]

/** Edita una hora en el lugar: toca la casilla, escribe y confirma con Enter. */
function editTime(name: RegExp, value: string) {
  fireEvent.click(screen.getByRole('button', { name }))
  const input = screen.getByLabelText(name)
  fireEvent.change(input, { target: { value } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

/** Da a cada celda de día un rectángulo propio (jsdom no calcula layout). */
function layoutCells() {
  const cells = document.querySelectorAll<HTMLElement>('[data-testid^="dia-"]')
  cells.forEach((cell, index) => {
    const left = (index % 7) * 100
    const top = Math.floor(index / 7) * 100
    cell.getBoundingClientRect = () =>
      ({ left, right: left + 100, top, bottom: top + 100 }) as DOMRect
  })
}

function center(date: string): { x: number; y: number } {
  const rect = screen.getByTestId(`dia-${date}`).getBoundingClientRect()
  return { x: rect.left + 50, y: rect.top + 50 }
}

function pointer(x: number, y: number, pointerType = 'mouse') {
  return { pointerId: 1, button: 0, pointerType, clientX: x, clientY: y }
}

/** Arrastra el bloque desde un día hasta un punto cualquiera. */
function dragBlock(
  block: HTMLElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
  pointerType = 'mouse',
) {
  fireEvent.pointerDown(block, pointer(from.x, from.y, pointerType))
  fireEvent.pointerMove(block, pointer(to.x, to.y, pointerType))
  fireEvent.pointerUp(block, pointer(to.x, to.y, pointerType))
}

function openBlockMenu() {
  const trigger = screen.getByRole('button', { name: /Opciones del turno/ })
  fireEvent.pointerDown(trigger, pointer(0, 0))
}

afterEach(() => {
  vi.useRealTimers()
  // Un diálogo de Radix abierto en una prueba deja el cuerpo sin eventos de puntero.
  document.body.removeAttribute('style')
  document.body.removeAttribute('data-scroll-locked')
  ;(document.activeElement as HTMLElement | null)?.blur?.()
})

beforeEach(() => {
  vi.clearAllMocks()
  assignments = [assignmentRow({})]
  shifts = [shiftRow({})]
  run.mockResolvedValue({
    warnings: [],
    undo: { kind: 'unassign', assignmentId: 'x' },
  })
})

describe('CalendarioMonthEditor: el bloque (OH-05)', () => {
  it('cada turno es un bloque con inicio, fin y cliente, con el color del cliente en todo el bloque', () => {
    renderEditor({ assignments, shifts })
    const block = screen.getByTestId('turno')
    expect(within(block).getByText('08:00')).toBeInTheDocument()
    expect(within(block).getByText('12:00')).toBeInTheDocument()
    expect(within(block).getByTestId('sede')).toHaveTextContent('SEDE CENTRAL')
    expect(block).toHaveStyle({
      backgroundColor: clientChipColors(0)!.background,
    })
  })

  it('dos turnos del mismo día son dos bloques separados', () => {
    assignments = [
      assignmentRow({}),
      assignmentRow({
        id: 'a2',
        shiftId: 's2',
        startTime: '14:00:00',
        endTime: '18:00:00',
      }),
    ]
    shifts = [
      shiftRow({}),
      shiftRow({ id: 's2', startTime: '14:00:00', endTime: '18:00:00' }),
    ]
    renderEditor({ assignments, shifts })
    const cell = screen.getByTestId(`dia-${DAY}`)
    expect(within(cell).getAllByTestId('turno')).toHaveLength(2)
  })

  it('feriados y licencias se pintan como en la hoja', () => {
    renderEditor({
      assignments: [],
      shifts: [],
      leaves: [
        {
          id: 'l1',
          startsOn: '2026-11-09',
          endsOn: '2026-11-09',
          reason: 'Franco',
          deletedAt: null,
        },
      ],
      holidays: [{ holidayDate: '2026-11-23', deletedAt: null }],
    })
    expect(screen.getByTestId('dia-2026-11-09')).toHaveTextContent('FRANCO')
    expect(screen.getByTestId('dia-2026-11-23')).toHaveTextContent('FERIADO')
  })

  it('sin permiso de edición no hay casillas editables, menú ni panel', () => {
    renderEditor({ assignments, shifts }, false)
    expect(screen.queryByRole('button', { name: /Hora de inicio/ })).toBeNull()
    expect(
      screen.queryByRole('button', { name: /Opciones del turno/ }),
    ).toBeNull()
    expect(screen.queryByLabelText(/Turnos sin cubrir/)).toBeNull()
  })
})

describe('CalendarioMonthEditor: menú del bloque', () => {
  // Van antes que las pruebas que editan una hora: en jsdom, tras montar un
  // TimeInput el menú de Radix deja de abrirse con fireEvent en la misma corrida.
  it('el menú «Mover o cambiar horario…» es la vía sin arrastre', async () => {
    renderEditor({ assignments, shifts })
    openBlockMenu()
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Mover o cambiar horario…' }),
    )
    expect(
      await screen.findByText('Mover o cambiar horario'),
    ).toBeInTheDocument()
  })

  it('el menú ofrece «Quitar de este turno»', async () => {
    renderEditor({ assignments, shifts })
    openBlockMenu()
    expect(
      await screen.findByRole('menuitem', { name: 'Quitar de este turno' }),
    ).toBeInTheDocument()
  })
})

describe('CalendarioMonthEditor: edición de la hora en el lugar', () => {
  it('Enter confirma y, si es la única persona, cambia el turno entero', async () => {
    renderEditor({ assignments, shifts })
    editTime(/Hora de inicio/, '09:00')
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    expect(run.mock.calls[0]?.[0]).toMatchObject({
      kind: 'shift_time',
      shiftId: 's1',
      date: DAY,
      start: '09:00',
      end: '12:00',
    })
    expect(toastApi.success.mock.calls[0]?.[0]).toBe(
      'Cambiamos el horario del turno.',
    )
  })

  it('editar el fin deja el inicio igual', async () => {
    renderEditor({ assignments, shifts })
    editTime(/Hora de fin/, '13:30')
    await waitFor(() => expect(run).toHaveBeenCalled())
    expect(run.mock.calls[0]?.[0]).toMatchObject({
      start: '08:00',
      end: '13:30',
    })
  })

  it('salir de la casilla también confirma', async () => {
    renderEditor({ assignments, shifts })
    fireEvent.click(screen.getByRole('button', { name: /Hora de inicio/ }))
    const input = screen.getByLabelText(/Hora de inicio/)
    fireEvent.change(input, { target: { value: '07:30' } })
    fireEvent.blur(input)
    await waitFor(() => expect(run).toHaveBeenCalled())
    expect(run.mock.calls[0]?.[0]).toMatchObject({ start: '07:30' })
  })

  it('Escape cancela: no llama al servidor y la casilla vuelve a la hora de antes', () => {
    renderEditor({ assignments, shifts })
    fireEvent.click(screen.getByRole('button', { name: /Hora de inicio/ }))
    const input = screen.getByLabelText(/Hora de inicio/)
    fireEvent.change(input, { target: { value: '09:00' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    fireEvent.blur(input)
    expect(run).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: /Hora de inicio/ }),
    ).toHaveTextContent('08:00')
  })

  it('una hora sin cambios no llama al servidor', () => {
    renderEditor({ assignments, shifts })
    editTime(/Hora de inicio/, '08:00')
    expect(run).not.toHaveBeenCalled()
  })

  it('un fin anterior al inicio muestra el error y no llama al servidor', () => {
    renderEditor({ assignments, shifts })
    editTime(/Hora de fin/, '07:00')
    expect(toastApi.error).toHaveBeenCalledWith(
      'La hora de fin tiene que ser posterior a la de inicio.',
    )
    expect(run).not.toHaveBeenCalled()
  })

  it('un turno «A terminar» no deja editar el fin', () => {
    assignments = [assignmentRow({ openEnded: true })]
    shifts = [shiftRow({ openEnded: true })]
    renderEditor({ assignments, shifts })
    expect(screen.queryByRole('button', { name: /Hora de fin/ })).toBeNull()
    expect(screen.getByText('A terminar')).toBeInTheDocument()
  })
})

describe('CalendarioMonthEditor: alcance con más de una persona', () => {
  beforeEach(() => {
    shifts = [shiftRow({ assignedCount: 2, requiredStaff: 2 })]
  })

  it('pregunta y «Solo a» usa el horario propio del mismo turno', async () => {
    renderEditor({ assignments, shifts })
    editTime(/Hora de inicio/, '08:15')
    expect(
      await screen.findByText(
        '¿Mover el turno para todos o pasar solo a Ana Prueba a otro horario?',
      ),
    ).toBeInTheDocument()
    expect(run).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Solo a Ana Prueba' }))
    await waitFor(() => expect(run).toHaveBeenCalled())
    expect(run.mock.calls[0]?.[0]).toMatchObject({
      kind: 'assignment_time',
      assignmentId: 'a1',
      start: '08:15',
    })
  })

  it('«Mover para todos» cambia el turno entero', async () => {
    renderEditor({ assignments, shifts })
    editTime(/Hora de fin/, '13:00')
    fireEvent.click(
      await screen.findByRole('button', { name: 'Mover para todos' }),
    )
    await waitFor(() => expect(run).toHaveBeenCalled())
    expect(run.mock.calls[0]?.[0]).toMatchObject({
      kind: 'shift_time',
      end: '13:00',
    })
  })

  it('al editar una hora no se ofrece pasar a otro turno del día', async () => {
    shifts = [
      shiftRow({ assignedCount: 2, requiredStaff: 2 }),
      shiftRow({ id: 's5', startTime: '14:00:00', endTime: '18:00:00' }),
    ]
    renderEditor({ assignments, shifts })
    editTime(/Hora de inicio/, '08:15')
    await screen.findByRole('button', { name: 'Solo a Ana Prueba' })
    expect(screen.queryByText(/Turno de 14:00/)).toBeNull()
  })
})

describe('CalendarioMonthEditor: arrastrar a otro día', () => {
  it('mueve el bloque de día con el mismo horario', async () => {
    renderEditor({ assignments, shifts })
    layoutCells()
    const block = screen.getByTestId('turno')
    const from = center(DAY)
    const to = center(OTHER_DAY)
    fireEvent.pointerDown(block, pointer(from.x, from.y))
    fireEvent.pointerMove(block, pointer(to.x, to.y))
    expect(screen.getByTestId(`dia-${OTHER_DAY}`)).toHaveAttribute(
      'data-drop-target',
      'true',
    )
    fireEvent.pointerUp(block, pointer(to.x, to.y))
    await waitFor(() => expect(run).toHaveBeenCalled())
    expect(run.mock.calls[0]?.[0]).toMatchObject({
      kind: 'shift_time',
      shiftId: 's1',
      date: OTHER_DAY,
      start: '08:00',
      end: '12:00',
    })
  })

  it('con más personas pregunta el alcance también al mover de día (OF-23)', async () => {
    shifts = [shiftRow({ assignedCount: 2, requiredStaff: 2 })]
    renderEditor({ assignments, shifts })
    layoutCells()
    dragBlock(screen.getByTestId('turno'), center(DAY), center(OTHER_DAY))
    expect(
      await screen.findByText(
        '¿Mover el turno para todos o pasar solo a Ana Prueba a otro horario?',
      ),
    ).toBeInTheDocument()
    expect(run).not.toHaveBeenCalled()
  })

  it('soltar sobre el mismo día o fuera del calendario no hace nada', () => {
    renderEditor({ assignments, shifts })
    layoutCells()
    const block = screen.getByTestId('turno')
    const from = center(DAY)
    dragBlock(block, from, { x: from.x + 10, y: from.y })
    dragBlock(block, from, { x: 9000, y: 9000 })
    expect(run).not.toHaveBeenCalled()
  })

  it('con el dedo no hay arrastre: los cambios se hacen tocando', () => {
    renderEditor({ assignments, shifts })
    layoutCells()
    dragBlock(
      screen.getByTestId('turno'),
      center(DAY),
      center(OTHER_DAY),
      'touch',
    )
    expect(run).not.toHaveBeenCalled()
  })
})

describe('CalendarioMonthEditor: abrir el turno y quitar', () => {
  it('tocar el nombre del cliente abre el detalle del turno', () => {
    renderEditor({ assignments, shifts })
    fireEvent.click(
      screen.getByRole('button', { name: /Abrir el turno de SEDE CENTRAL/ }),
    )
    expect(screen.getByTestId('ruta')).toHaveTextContent('/admin/turnos/s1')
  })
})

describe('CalendarioMonthEditor: turnos sin cubrir del mes', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-02T12:00:00Z'))
  })

  it('el panel lista los turnos sin cubrir de todo el mes y «Asignar» asigna', async () => {
    shifts = [
      shiftRow({}),
      shiftRow({
        id: 's9',
        requiredStaff: 2,
        assignedCount: 0,
        siteName: 'Otra sede',
      }),
      shiftRow({
        id: 's10',
        requiredStaff: 2,
        assignedCount: 0,
        siteName: 'Sede lejana',
        shiftDate: '2026-11-27',
      }),
    ]
    renderEditor({ assignments, shifts })
    expect(
      screen.getByLabelText('Turnos sin cubrir del mes'),
    ).toBeInTheDocument()
    expect(screen.getAllByTestId('sin-cubrir')).toHaveLength(2)
    fireEvent.click(
      screen.getByRole('button', { name: /Asignar el turno de Sede lejana/ }),
    )
    await waitFor(() => expect(run).toHaveBeenCalled())
    expect(run.mock.calls[0]?.[0]).toEqual({
      kind: 'assign',
      shiftId: 's10',
      employeeId: 'p1',
    })
  })

  it('arrastrar un turno sin cubrir al calendario lo asigna', async () => {
    shifts = [
      shiftRow({}),
      shiftRow({
        id: 's9',
        requiredStaff: 2,
        assignedCount: 0,
        siteName: 'Otra sede',
      }),
    ]
    renderEditor({ assignments, shifts })
    const grid = screen
      .getByTestId('calendario-mes')
      .querySelector('.overflow-x-auto') as HTMLElement
    grid.getBoundingClientRect = () =>
      ({ left: 0, right: 700, top: 0, bottom: 600 }) as DOMRect
    const item = screen.getByTestId('sin-cubrir')
    fireEvent.pointerDown(item, pointer(900, 50))
    fireEvent.pointerMove(item, pointer(300, 200))
    fireEvent.pointerUp(item, pointer(300, 200))
    await waitFor(() => expect(run).toHaveBeenCalled())
    expect(run.mock.calls[0]?.[0]).toMatchObject({
      kind: 'assign',
      shiftId: 's9',
    })
  })
})

describe('CalendarioMonthEditor: avisos', () => {
  it('el aviso de éxito trae «Deshacer», que ejecuta la acción inversa', async () => {
    renderEditor({ assignments, shifts })
    editTime(/Hora de inicio/, '09:00')
    await waitFor(() => expect(toastApi.success).toHaveBeenCalled())
    const options = toastApi.success.mock.calls[0]?.[1] as {
      action: { label: string; onClick: () => void }
      duration: number
    }
    expect(options.action.label).toBe('Deshacer')
    // DEF-P30-08: da tiempo a deshacer.
    expect(options.duration).toBe(10_000)
    options.action.onClick()
    await waitFor(() => expect(run).toHaveBeenCalledTimes(2))
    expect(run.mock.calls[1]?.[0]).toEqual({
      kind: 'unassign',
      assignmentId: 'x',
    })
  })

  it('acepta la hora escrita con el teclado («0930») y la confirma (DEF-P30-05)', async () => {
    renderEditor({ assignments, shifts })
    fireEvent.click(screen.getByRole('button', { name: /Hora de inicio/ }))
    const input = screen.getByRole('textbox', { name: /Hora de inicio/ })
    let acc = ''
    for (const char of '0930') {
      acc += char
      fireEvent.change(input, { target: { value: acc } })
    }
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(run).toHaveBeenCalled())
    expect(run.mock.calls[0]?.[0]).toMatchObject({
      kind: 'shift_time',
      start: '09:30',
    })
  })

  it('muestra el mensaje del servidor con «Ver turno» cuando hay choque', async () => {
    run.mockRejectedValue(
      new ApiError('Acosta ya está en otra sede.', 'ASSIGNMENT_OVERLAP', {
        conflictShiftId: 'sx',
      } as ConflictDetail),
    )
    renderEditor({ assignments, shifts })
    editTime(/Hora de inicio/, '09:00')
    await waitFor(() => expect(toastApi.error).toHaveBeenCalled())
    expect(toastApi.error.mock.calls[0]?.[0]).toBe(
      'Acosta ya está en otra sede.',
    )
    expect(toastApi.error.mock.calls[0]?.[1]).toMatchObject({
      action: { label: 'Ver turno' },
    })
  })

  it('las advertencias se muestran como aviso', async () => {
    run.mockResolvedValue({ warnings: ['OUTSIDE_AVAILABILITY'], undo: null })
    renderEditor({ assignments, shifts })
    editTime(/Hora de inicio/, '09:00')
    await waitFor(() => expect(toastApi.warning).toHaveBeenCalled())
    expect(toastApi.warning.mock.calls[0]?.[0]).toContain('disponibilidad')
  })
})
