import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssignmentBoardRow } from '@/api/assignments'
import type { CalendarNote } from '@/api/employeeCalendarNotes'
import type { FixedGap } from '@/api/employeeFixed'
import type { ShiftListRow } from '@/api/shifts'
import { buildCronogramaMonth } from '@/features/employees/cronograma'
import {
  COMPLETED_DATE_MESSAGE,
  buildWeekBlocks,
} from '@/features/employees/cronogramaWeek'
import { CalendarioMonthEditor } from './CalendarioMonthEditor'

/**
 * P31.3: color único del cliente (D-05), eliminar turno (D-06), horario de un
 * turno finalizado (D-07) y observaciones del día (D-08) en el calendario del mes.
 */

const { run, toastApi, auth, setColor, saveNote, deleteNote } = vi.hoisted(
  () => ({
    run: vi.fn(),
    toastApi: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
    auth: { roles: ['owner'] as string[] },
    setColor: vi.fn(),
    saveNote: vi.fn(),
    deleteNote: vi.fn(),
  }),
)

vi.mock('sonner', () => ({ toast: toastApi }))
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ roles: auth.roles, capabilities: [], userId: 'u1' }),
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
  useSetClientCalendarColorMutation: () => ({
    mutateAsync: setColor,
    isPending: false,
  }),
}))
vi.mock('@/features/shifts/queries', () => ({
  shiftsKeys: { all: ['shifts'] },
}))
vi.mock('@/api/employeeCalendarNotes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/employeeCalendarNotes')>()),
  saveEmployeeCalendarNote: saveNote,
  deleteEmployeeCalendarNote: deleteNote,
}))
vi.mock('@/features/ownerDelete/components/OwnerDeleteDialog', () => ({
  OwnerDeleteDialog: ({ id, kind }: { id: string; kind: string }) => (
    <div data-testid="owner-delete" data-id={id} data-kind={kind} />
  ),
}))

/** P33.1: abre el menú del «+» del día 10 y elige «Agregar observación». */
async function addNoteFromPlus() {
  await openMenu(/Agregar un turno o una observación el .*10/)
  fireEvent.click(
    await screen.findByRole('menuitem', { name: 'Agregar observación' }),
  )
}

const DAY = '2026-11-03'
const OTHER_DAY = '2026-11-10'

function shiftRow(over: Partial<ShiftListRow> = {}): ShiftListRow {
  return {
    id: 's1',
    clientId: 'c1',
    clientName: 'RAESA',
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

function assignmentRow(
  over: Partial<AssignmentBoardRow> = {},
): AssignmentBoardRow {
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
    clientName: 'RAESA',
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

function gap(over: Partial<FixedGap> = {}): FixedGap {
  return {
    shiftId: 'sg1',
    shiftDate: OTHER_DAY,
    startTime: '08:00:00',
    endTime: '12:00:00',
    openEnded: false,
    clientId: 'c1',
    clientName: 'RAESA',
    siteId: 'si1',
    siteName: 'Sede Central',
    serviceId: 'sv1',
    serviceName: 'Limpieza',
    calendarColor: 0,
    reason: 'NOT_ASSIGNED',
    detail: null,
    shiftStatus: 'scheduled',
    ...over,
  }
}

function note(over: Partial<CalendarNote> = {}): CalendarNote {
  return {
    id: 'n1',
    employeeId: 'p1',
    date: OTHER_DAY,
    body: 'Sin turnos por la obra',
    color: null,
    createdAt: '2026-11-09T10:00:00Z',
    createdByName: 'Laura Gómez',
    updatedAt: '2026-11-09T10:00:00Z',
    updatedByName: 'Laura Gómez',
    ...over,
  }
}

function LocationProbe() {
  const location = useLocation()
  return <span data-testid="ruta">{location.pathname + location.search}</span>
}

function renderEditor(
  options: {
    entry?: string
    assignments?: AssignmentBoardRow[]
    shifts?: ShiftListRow[]
    gaps?: FixedGap[]
    notes?: CalendarNote[]
  } = {},
) {
  const assignments = options.assignments ?? [assignmentRow()]
  const shifts = options.shifts ?? [shiftRow()]
  const month = buildCronogramaMonth({
    year: 2026,
    month: 11,
    assignments,
    leaves: [],
    holidays: [],
  })
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[options.entry ?? '/']}>
        <LocationProbe />
        <CalendarioMonthEditor
          profileId="p1"
          personName="Ana Prueba"
          month={month}
          blocks={buildWeekBlocks(assignments, shifts)}
          allShifts={shifts}
          canEdit
          gaps={options.gaps}
          notes={options.notes}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  )
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

/**
 * Abre un menú con el teclado. Radix deja estado entre pruebas: el primer
 * intento después de cerrar un diálogo a veces se pierde, así que se repite
 * hasta que el menú aparece.
 */
async function openMenu(name: RegExp) {
  const trigger = screen.getByRole('button', { name })
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

function openBlockMenu() {
  return openMenu(/Opciones del turno/)
}

function openNoteMenu() {
  return openMenu(/Opciones de la observación/)
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.roles = ['owner']
  run.mockResolvedValue({ warnings: [], undo: null })
  setColor.mockResolvedValue(undefined)
  saveNote.mockResolvedValue(undefined)
  deleteNote.mockResolvedValue(undefined)
})

afterEach(() => {
  document.body.removeAttribute('style')
  document.body.removeAttribute('data-scroll-locked')
  ;(document.activeElement as HTMLElement | null)?.blur?.()
})

describe('D-05: «Cambiar color del cliente» en el menú de la tarjeta del mes', () => {
  it('elige un color, pide confirmación con el nombre del cliente y cambia el color del cliente', async () => {
    renderEditor()
    await openBlockMenu()
    const main = await screen.findByRole('menu')
    const trigger = within(main).getByRole('menuitem', {
      name: 'Cambiar color del cliente',
    })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowRight' })
    await waitFor(() => expect(screen.getAllByRole('menu')).toHaveLength(2))
    const sub = screen
      .getAllByRole('menu')
      .find((menu) => menu !== main) as HTMLElement
    fireEvent.click(within(sub).getByRole('menuitem', { name: /Naranja/ }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(
      'Cambia el color de RAESA en todos los calendarios.',
    )
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Cambiar color' }),
    )
    await waitFor(() =>
      expect(setColor).toHaveBeenCalledWith({
        clientId: 'c1',
        calendarColor: 2,
        updatedBy: 'u1',
      }),
    )
    await waitFor(() => expect(toastApi.success).toHaveBeenCalled())
  })
})

describe('D-06: «Eliminar turno» en la tarjeta del mes y en el fijo sin asignar', () => {
  it('la dirección ve «Eliminar turno» en el menú de la tarjeta y se abre el borrado del turno', async () => {
    renderEditor()
    await openBlockMenu()
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Eliminar turno' }),
    )
    const dialog = await screen.findByTestId('owner-delete')
    expect(dialog).toHaveAttribute('data-kind', 'shift')
    expect(dialog).toHaveAttribute('data-id', 's1')
  })

  it('un administrador no ve «Eliminar turno» en el menú (OD-22)', async () => {
    auth.roles = ['admin']
    renderEditor()
    await openBlockMenu()
    await screen.findByRole('menuitem', { name: 'Quitar de este turno' })
    expect(
      screen.queryByRole('menuitem', { name: 'Eliminar turno' }),
    ).toBeNull()
  })

  it('la tarjeta punteada del fijo sin asignar ofrece «Eliminar turno» a la dirección', () => {
    renderEditor({ gaps: [gap()] })
    fireEvent.click(
      screen.getByRole('button', { name: /^Eliminar el turno de/ }),
    )
    expect(screen.getByTestId('owner-delete')).toHaveAttribute('data-id', 'sg1')
  })

  it('la tarjeta punteada no ofrece eliminar a un administrador', () => {
    auth.roles = ['admin']
    renderEditor({ gaps: [gap()] })
    expect(
      screen.queryByRole('button', { name: /^Eliminar el turno de/ }),
    ).toBeNull()
  })
})

describe('D-07: horario de un turno finalizado en el calendario del empleado', () => {
  const completed = () => ({
    assignments: [assignmentRow({ shiftStatus: 'completed' })],
    shifts: [shiftRow({ status: 'completed', displayStatus: 'completed' })],
  })

  it('se puede cambiar la hora de fin: cambia el horario del turno en el mismo día', async () => {
    renderEditor(completed())
    fireEvent.click(
      screen.getByRole('button', { name: /Hora de fin del turno de/ }),
    )
    const input = screen.getByLabelText(/Hora de fin del turno de/)
    fireEvent.change(input, { target: { value: '1500' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    expect(run.mock.calls[0]?.[0]).toMatchObject({
      kind: 'shift_time',
      shiftId: 's1',
      date: DAY,
      start: '08:00',
      end: '15:00',
    })
  })

  it('moverlo de día muestra el mensaje claro y no llama al servidor', async () => {
    renderEditor(completed())
    const cells = document.querySelectorAll<HTMLElement>(
      '[data-testid^="dia-"]',
    )
    cells.forEach((cell, index) => {
      const left = (index % 7) * 100
      const top = Math.floor(index / 7) * 100
      cell.getBoundingClientRect = () =>
        ({ left, right: left + 100, top, bottom: top + 100 }) as DOMRect
    })
    const from = screen.getByTestId(`dia-${DAY}`).getBoundingClientRect()
    const to = screen.getByTestId(`dia-${OTHER_DAY}`).getBoundingClientRect()
    const block = screen.getByTestId('turno')
    fireEvent.pointerDown(block, pointer(from.left + 50, from.top + 50))
    fireEvent.pointerMove(block, pointer(to.left + 50, to.top + 50))
    fireEvent.pointerUp(block, pointer(to.left + 50, to.top + 50))
    await waitFor(() =>
      expect(toastApi.error).toHaveBeenCalledWith(COMPLETED_DATE_MESSAGE),
    )
    expect(run).not.toHaveBeenCalled()
  })
})

describe('D-08: observaciones del día', () => {
  it('sin permiso para verlas (sin `notes`) no hay botón «+»', () => {
    renderEditor()
    expect(screen.queryByRole('button', { name: /Agregar un/ })).toBeNull()
  })

  it('cada día del mes tiene su «+» y las observaciones se ven en su día, varias por día', () => {
    renderEditor({
      notes: [
        note(),
        note({ id: 'n2', body: 'Llega más tarde', color: 3 }),
        note({ id: 'n3', date: DAY, body: 'Otro día' }),
      ],
    })
    const cell = screen.getByTestId(`dia-${OTHER_DAY}`)
    expect(within(cell).getAllByTestId('observacion')).toHaveLength(2)
    expect(within(cell).getByText('Llega más tarde')).toBeInTheDocument()
    expect(
      within(screen.getByTestId(`dia-${DAY}`)).getAllByTestId('observacion'),
    ).toHaveLength(1)
    // 30 días de noviembre, uno «+» por día.
    expect(
      screen.getAllByRole('button', {
        name: /Agregar un turno o una observación el/,
      }),
    ).toHaveLength(30)
  })

  it('el «+» ofrece «Agregar turno» y «Agregar observación» (P33.1)', async () => {
    renderEditor({ notes: [] })
    await openMenu(/Agregar un turno o una observación el .*10/)
    expect(
      await screen.findByRole('menuitem', { name: 'Agregar turno' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('menuitem', { name: 'Agregar observación' }),
    ).toBeInTheDocument()
  })

  it('«Agregar turno» va al alta con fecha, empleado y la vuelta a la ficha con el mes (P33.1)', async () => {
    renderEditor({
      notes: [],
      entry: '/admin/empleados/p1?pestana=calendario&mes=2026-11',
    })
    await openMenu(/Agregar un turno o una observación el .*10/)
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Agregar turno' }),
    )
    const route = await screen.findByTestId('ruta')
    await waitFor(() =>
      expect(route.textContent).toMatch(/^\/admin\/turnos\/nuevo\?/),
    )
    const params = new URLSearchParams(route.textContent.split('?')[1])
    expect(params.get('fecha')).toBe(OTHER_DAY)
    expect(params.get('empleado')).toBe('p1')
    expect(params.get('volver')).toBe(
      '/admin/empleados/p1?pestana=calendario&mes=2026-11',
    )
  })

  it('«Agregar turno» agrega el mes mostrado si la dirección no lo trae', async () => {
    renderEditor({ notes: [], entry: '/admin/empleados/p1?pestana=calendario' })
    await openMenu(/Agregar un turno o una observación el .*10/)
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Agregar turno' }),
    )
    const route = await screen.findByTestId('ruta')
    await waitFor(() =>
      expect(route.textContent).toMatch(/^\/admin\/turnos\/nuevo\?/),
    )
    const params = new URLSearchParams(route.textContent.split('?')[1])
    expect(params.get('volver')).toBe(
      '/admin/empleados/p1?pestana=calendario&mes=2026-11',
    )
  })

  it('sin permiso para crear turnos el «+» abre la observación directo (P33.1, D-07)', async () => {
    auth.roles = ['supervisor']
    renderEditor({ notes: [] })
    fireEvent.click(
      screen.getByRole('button', {
        name: /Agregar una observación el .*10/,
      }),
    )
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Agregar turno' })).toBeNull()
  })

  it('la observación con color se pinta con la paleta de los clientes', () => {
    renderEditor({ notes: [note({ color: 2 })] })
    const cell = screen.getByTestId('observacion')
    expect(cell.style.backgroundColor).not.toBe('')
    expect(cell.style.backgroundColor).not.toBe('rgb(229, 231, 235)')
  })

  it('el «+» abre el alta y guarda con p_note_id nulo, el día, el texto y el color', async () => {
    renderEditor({ notes: [] })
    await addNoteFromPlus()
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Observación'), {
      target: { value: '  Sin turnos esta semana  ' },
    })
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Violeta' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(saveNote).toHaveBeenCalledTimes(1))
    expect(saveNote).toHaveBeenCalledWith({
      noteId: null,
      employeeId: 'p1',
      date: OTHER_DAY,
      body: 'Sin turnos esta semana',
      color: 1,
    })
  })

  it('no deja guardar una observación vacía', async () => {
    renderEditor({ notes: [] })
    await addNoteFromPlus()
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    expect(
      await within(dialog).findByText('Escribí la observación.'),
    ).toBeInTheDocument()
    expect(saveNote).not.toHaveBeenCalled()
  })

  it('muestra el mensaje del servidor si rechaza la observación', async () => {
    const { ApiError } = await import('@/api/errors')
    saveNote.mockRejectedValue(
      new ApiError(
        'El color tiene que ser un número de 0 a 11.',
        'INVALID_COLOR',
      ),
    )
    renderEditor({ notes: [] })
    await addNoteFromPlus()
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Observación'), {
      target: { value: 'Texto' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    expect(
      await within(dialog).findByText(
        'El color tiene que ser un número de 0 a 11.',
      ),
    ).toBeInTheDocument()
  })

  it('el menú de la observación edita el texto con el mismo id', async () => {
    renderEditor({ notes: [note()] })
    await openNoteMenu()
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Editar' }))
    const dialog = await screen.findByRole('dialog')
    const field = within(dialog).getByLabelText('Observación')
    expect(field).toHaveValue('Sin turnos por la obra')
    fireEvent.change(field, { target: { value: 'Ahora sí hay turnos' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(saveNote).toHaveBeenCalledTimes(1))
    expect(saveNote).toHaveBeenCalledWith({
      noteId: 'n1',
      employeeId: 'p1',
      date: OTHER_DAY,
      body: 'Ahora sí hay turnos',
      color: null,
    })
  })

  it('el menú de la observación cambia el color sin tocar el texto', async () => {
    renderEditor({ notes: [note()] })
    await openNoteMenu()
    const main = await screen.findByRole('menu')
    const trigger = within(main).getByRole('menuitem', {
      name: 'Cambiar color',
    })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowRight' })
    await waitFor(() => expect(screen.getAllByRole('menu')).toHaveLength(2))
    const sub = screen
      .getAllByRole('menu')
      .find((menu) => menu !== main) as HTMLElement
    fireEvent.click(within(sub).getByRole('menuitem', { name: /Celeste/ }))
    await waitFor(() => expect(saveNote).toHaveBeenCalledTimes(1))
    expect(saveNote).toHaveBeenCalledWith({
      noteId: 'n1',
      employeeId: 'p1',
      date: OTHER_DAY,
      body: 'Sin turnos por la obra',
      color: 5,
    })
  })

  it('eliminar pide confirmación y borra la observación', async () => {
    renderEditor({ notes: [note()] })
    await openNoteMenu()
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Eliminar' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Sin turnos por la obra')
    expect(deleteNote).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Eliminar' }))
    await waitFor(() => expect(deleteNote).toHaveBeenCalledWith('n1'))
  })
})
