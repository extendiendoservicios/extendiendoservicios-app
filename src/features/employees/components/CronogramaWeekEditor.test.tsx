import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssignmentBoardRow } from '@/api/assignments'
import type { ShiftListRow } from '@/api/shifts'
import { ApiError, type ConflictDetail } from '@/api/errors'
import { localDateToIsoDate } from '@/features/settings/dateOnly'
import { CronogramaWeekEditor, mondayOfDate } from './CronogramaWeekEditor'

const { state, run, toastApi } = vi.hoisted(() => ({
  state: {
    assignments: [] as unknown[],
    shifts: [] as unknown[],
  },
  run: vi.fn(),
  toastApi: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
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
  useAssignmentsBoardRangeQuery: () => ({
    data: state.assignments,
    isLoading: false,
    isError: false,
  }),
  useShiftsBoardRangeQuery: () => ({
    data: state.shifts,
    isLoading: false,
    isError: false,
  }),
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

const monday = mondayOfDate(localDateToIsoDate(new Date()))

function shiftRow(over: Partial<ShiftListRow>): ShiftListRow {
  return {
    id: 's1',
    clientId: 'c1',
    clientName: 'Cliente',
    clientCalendarColor: 0,
    siteId: 'si1',
    siteName: 'Sede Central',
    siteCity: null,
    shiftDate: monday,
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
    shiftDate: monday,
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

function renderEditor() {
  const client = new QueryClient()
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CronogramaWeekEditor profileId="p1" personName="Ana Prueba" />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** Una pulsación de flecha abajo y Enter sobre el bloque: mueve 15 minutos. */
function moveWithKeyboard() {
  const block = screen.getByTestId('bloque')
  fireEvent.keyDown(block, { key: 'ArrowDown' })
  fireEvent.keyDown(block, { key: 'Enter' })
}

afterEach(() => {
  vi.useRealTimers()
})

beforeEach(() => {
  vi.clearAllMocks()
  state.assignments = [assignmentRow({})]
  state.shifts = [shiftRow({})]
  run.mockResolvedValue({
    warnings: [],
    undo: { kind: 'unassign', assignmentId: 'x' },
  })
})

describe('CronogramaWeekEditor', () => {
  it('dibuja el bloque del turno', () => {
    renderEditor()
    expect(screen.getByTestId('bloque')).toHaveTextContent('08:00–12:00')
    expect(screen.getByTestId('bloque')).toHaveTextContent('Sede Central')
  })

  it('con teclado: las flechas previsualizan y Enter mueve el turno entero si es el único', async () => {
    renderEditor()
    const block = screen.getByTestId('bloque')
    fireEvent.keyDown(block, { key: 'ArrowDown' })
    fireEvent.keyDown(block, { key: 'ArrowDown' })
    expect(screen.getByTestId('fantasma')).toHaveTextContent('08:30–12:30')
    fireEvent.keyDown(block, { key: 'Enter' })
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    expect(run.mock.calls[0]?.[0]).toMatchObject({
      kind: 'shift_time',
      shiftId: 's1',
      date: monday,
      start: '08:30',
      end: '12:30',
    })
  })

  it('Escape cancela la previsualización sin llamar al servidor', () => {
    renderEditor()
    const block = screen.getByTestId('bloque')
    fireEvent.keyDown(block, { key: 'ArrowDown' })
    fireEvent.keyDown(block, { key: 'Escape' })
    expect(screen.queryByTestId('fantasma')).toBeNull()
    expect(run).not.toHaveBeenCalled()
  })

  it('arrastrar con el puntero: 40 px son 1 hora', async () => {
    renderEditor()
    const block = screen.getByTestId('bloque')
    const pointer = { pointerId: 1, clientX: 100 }
    fireEvent.pointerDown(block, { ...pointer, button: 0, clientY: 100 })
    fireEvent.pointerMove(block, { ...pointer, clientY: 140 })
    expect(screen.getByTestId('fantasma')).toHaveTextContent('09:00–13:00')
    fireEvent.pointerUp(block, { ...pointer, clientY: 140 })
    await waitFor(() => expect(run).toHaveBeenCalled())
    expect(run.mock.calls[0]?.[0]).toMatchObject({
      kind: 'shift_time',
      start: '09:00',
    })
  })

  it('arrastrar el borde inferior cambia solo el fin', async () => {
    renderEditor()
    const edge = screen.getByTestId('borde-inferior')
    const pointer = { pointerId: 1, clientX: 10 }
    fireEvent.pointerDown(edge, { ...pointer, button: 0, clientY: 10 })
    fireEvent.pointerMove(edge, { ...pointer, clientY: 50 })
    fireEvent.pointerUp(edge, { ...pointer, clientY: 50 })
    await waitFor(() => expect(run).toHaveBeenCalled())
    expect(run.mock.calls[0]?.[0]).toMatchObject({
      kind: 'shift_time',
      start: '08:00',
      end: '13:00',
    })
  })

  it('con más personas pregunta y «Solo a» usa el horario propio del mismo turno', async () => {
    state.shifts = [shiftRow({ assignedCount: 2, requiredStaff: 2 })]
    renderEditor()
    moveWithKeyboard()
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

  it('OF-23: sin otro turno ese día ofrece crear el turno nuevo y pasar a la persona', async () => {
    state.shifts = [shiftRow({ assignedCount: 2, requiredStaff: 2 })]
    renderEditor()
    moveWithKeyboard()
    await screen.findByText(
      '¿Mover el turno para todos o pasar solo a Ana Prueba a otro horario?',
    )
    // jsdom no implementa estas APIs que usa el Select de Radix.
    Element.prototype.scrollIntoView = vi.fn()
    Element.prototype.hasPointerCapture = vi.fn(() => false)
    Element.prototype.releasePointerCapture = vi.fn()
    fireEvent.keyDown(screen.getByLabelText('Si pasás solo a Ana Prueba'), {
      key: 'Enter',
    })
    fireEvent.click(
      await screen.findByRole('option', {
        name: /Crear un turno nuevo en Sede Central el .* de 08:15 a 12:15 y pasar a Ana Prueba/,
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Solo a Ana Prueba' }))
    await waitFor(() => expect(run).toHaveBeenCalled())
    expect(run.mock.calls[0]?.[0]).toMatchObject({
      kind: 'move_new_shift',
      assignmentId: 'a1',
      date: monday,
      start: '08:15',
      end: '12:15',
      canUndo: true,
    })
  })

  it('«Mover para todos» mueve el turno entero', async () => {
    state.shifts = [shiftRow({ assignedCount: 2, requiredStaff: 2 })]
    renderEditor()
    moveWithKeyboard()
    fireEvent.click(
      await screen.findByRole('button', { name: 'Mover para todos' }),
    )
    await waitFor(() => expect(run).toHaveBeenCalled())
    expect(run.mock.calls[0]?.[0]).toMatchObject({ kind: 'shift_time' })
  })

  it('el panel lista los turnos sin cubrir y «Asignar» asigna', async () => {
    // Lunes de la semana a las 07:00 (Buenos Aires): el turno de 08 a 12 no terminó.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(`${monday}T10:00:00Z`))
    state.shifts = [
      shiftRow({}),
      shiftRow({
        id: 's9',
        requiredStaff: 2,
        assignedCount: 0,
        siteName: 'Otra sede',
      }),
    ]
    renderEditor()
    expect(screen.getAllByTestId('sin-cubrir')).toHaveLength(1)
    fireEvent.click(
      screen.getByRole('button', { name: /Asignar el turno de Otra sede/ }),
    )
    await waitFor(() => expect(run).toHaveBeenCalled())
    expect(run.mock.calls[0]?.[0]).toEqual({
      kind: 'assign',
      shiftId: 's9',
      employeeId: 'p1',
    })
  })

  it('el aviso de éxito trae «Deshacer», que ejecuta la acción inversa', async () => {
    renderEditor()
    moveWithKeyboard()
    await waitFor(() => expect(toastApi.success).toHaveBeenCalled())
    const options = toastApi.success.mock.calls[0]?.[1] as {
      action: { label: string; onClick: () => void }
    }
    expect(options.action.label).toBe('Deshacer')
    options.action.onClick()
    await waitFor(() => expect(run).toHaveBeenCalledTimes(2))
    expect(run.mock.calls[1]?.[0]).toEqual({
      kind: 'unassign',
      assignmentId: 'x',
    })
  })

  it('muestra el mensaje del servidor con «Ver turno» cuando hay choque', async () => {
    run.mockRejectedValue(
      new ApiError('Acosta ya está en otra sede.', 'ASSIGNMENT_OVERLAP', {
        conflictShiftId: 'sx',
      } as ConflictDetail),
    )
    renderEditor()
    moveWithKeyboard()
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
    renderEditor()
    moveWithKeyboard()
    await waitFor(() => expect(toastApi.warning).toHaveBeenCalled())
    expect(toastApi.warning.mock.calls[0]?.[0]).toContain('disponibilidad')
  })
})
