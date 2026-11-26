import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ShiftListRow } from '@/api/shifts'
import { ClientCalendarioTab } from './ClientCalendarioTab'

const { state, runCommandMock, toastError } = vi.hoisted(() => ({
  state: {
    shifts: [] as unknown[],
    assignments: [] as unknown[],
    auth: { roles: ['owner'], capabilities: [] as string[] },
  },
  runCommandMock: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: toastError },
}))
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => state.auth,
}))
vi.mock('@/features/planning/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/planning/queries')>()),
  useShiftsBoardRangeQuery: () => ({
    data: state.shifts,
    isLoading: false,
    isError: false,
  }),
  useAssignmentsBoardRangeQuery: () => ({
    data: state.assignments,
    isLoading: false,
    isError: false,
  }),
}))
vi.mock('@/features/clients/queries', () => ({
  useClientSitesQuery: () => ({
    data: [{ id: 'site1', name: 'Sede Norte' }],
  }),
}))
vi.mock('@/features/settings/queries', () => ({
  useHolidaysQuery: () => ({ data: [], isLoading: false, isError: false }),
}))
vi.mock('@/features/employees/cronogramaCommands', () => ({
  runCronogramaCommand: runCommandMock,
}))

function shift(overrides: Partial<ShiftListRow> = {}): ShiftListRow {
  return {
    id: 's1',
    clientId: 'c1',
    clientName: 'Cliente',
    clientCalendarColor: 2,
    siteId: 'site1',
    siteName: 'Sede Norte',
    siteCity: null,
    shiftDate: '2026-11-10',
    startTime: '08:00:00',
    endTime: '12:00:00',
    requiredStaff: 2,
    status: 'scheduled',
    displayStatus: 'scheduled',
    openEnded: false,
    assignedCount: 2,
    presentCount: 0,
    finishedCount: 0,
    absentCount: 0,
    delayedCount: 0,
    noCheckoutCount: 0,
    generated: false,
    notes: null,
    ...overrides,
  }
}

const PEOPLE = [
  {
    id: 'a1',
    shiftId: 's1',
    employeeId: 'e1',
    employeeFirstName: 'Ana',
    employeeLastName: 'Pérez',
  },
  {
    id: 'a2',
    shiftId: 's1',
    employeeId: 'e2',
    employeeFirstName: 'Luis',
    employeeLastName: 'Gómez',
  },
]

/** Abre un menú con el teclado; Radix a veces pierde el primer intento, se repite. */
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

function pointer(x: number, y: number) {
  return { button: 0, pointerType: 'mouse', clientX: x, clientY: y }
}

/** Celdas de 100 x 100 para poder soltar el bloque sobre otro día. */
function layoutCells() {
  document
    .querySelectorAll<HTMLElement>('[data-testid^="dia-"]')
    .forEach((cell, index) => {
      const left = (index % 7) * 100
      const top = Math.floor(index / 7) * 100
      cell.getBoundingClientRect = () =>
        ({ left, right: left + 100, top, bottom: top + 100 }) as DOMRect
    })
}

function dragTo(fromDay: string, toDay: string) {
  layoutCells()
  const from = screen.getByTestId(`dia-${fromDay}`).getBoundingClientRect()
  const to = screen.getByTestId(`dia-${toDay}`).getBoundingClientRect()
  const block = within(screen.getByTestId(`dia-${fromDay}`)).getByTestId(
    'turno',
  )
  fireEvent.pointerDown(block, pointer(from.left + 50, from.top + 50))
  fireEvent.pointerMove(block, pointer(to.left + 50, to.top + 50))
  fireEvent.pointerUp(block, pointer(to.left + 50, to.top + 50))
}

function Nuevo() {
  return <p data-testid="nuevo">{useLocation().search}</p>
}

function renderTab(canEdit: boolean, search = '?mes=2026-11') {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[`/admin/clientes/c1${search}`]}>
        <Routes>
          <Route
            path="/admin/clientes/:id"
            element={
              <ClientCalendarioTab
                clientId="c1"
                clientName="Limpieza SA"
                canEdit={canEdit}
              />
            }
          />
          <Route path="/admin/turnos/nuevo" element={<Nuevo />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ClientCalendarioTab: edición (P34.2)', () => {
  beforeEach(() => {
    state.shifts = [shift()]
    state.assignments = PEOPLE
    state.auth = { roles: ['owner'], capabilities: [] }
    runCommandMock.mockReset()
    runCommandMock.mockResolvedValue({ warnings: [], undo: null })
    toastError.mockClear()
  })

  it('editar una hora cambia el turno entero (shift_time) y refresca', async () => {
    renderTab(true)
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Hora de fin del turno de Sede Norte',
      }),
    )
    const input = screen.getByRole('textbox', {
      name: 'Hora de fin del turno de Sede Norte',
    })
    fireEvent.change(input, { target: { value: '13:00' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(runCommandMock).toHaveBeenCalledTimes(1))
    expect(runCommandMock.mock.calls[0]?.[0]).toEqual({
      kind: 'shift_time',
      shiftId: 's1',
      date: '2026-11-10',
      start: '08:00',
      end: '13:00',
      openEnded: false,
    })
  })

  it('un error del servidor se muestra tal cual', async () => {
    const { ApiError } = await import('@/api/errors')
    runCommandMock.mockRejectedValue(
      new ApiError('Hay un turno superpuesto.', 'SHIFT_OVERLAP'),
    )
    renderTab(true)
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Hora de inicio del turno de Sede Norte',
      }),
    )
    const input = screen.getByRole('textbox', {
      name: 'Hora de inicio del turno de Sede Norte',
    })
    fireEvent.change(input, { target: { value: '07:00' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(toastError.mock.calls[0]?.[0]).toBe('Hay un turno superpuesto.')
  })

  it('en un turno cancelado las horas no se editan', () => {
    state.shifts = [shift({ status: 'cancelled' })]
    renderTab(true)
    expect(screen.queryByRole('button', { name: /Hora de inicio/ })).toBeNull()
  })

  it('el ⋮ ofrece abrir, mover, asignar, quitar a cada persona, color y eliminar (dirección)', async () => {
    renderTab(true)
    await openMenu(/Opciones del turno de Sede Norte/)
    expect(
      screen.getByRole('menuitem', { name: 'Abrir el turno' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('menuitem', { name: 'Mover o cambiar horario…' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('menuitem', { name: 'Asignar empleado…' }),
    ).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Quitar a…' })).toBeTruthy()
    expect(
      screen.getByRole('menuitem', { name: 'Cambiar color del cliente' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('menuitem', { name: 'Eliminar turno' }),
    ).toBeTruthy()
  })

  it('«Quitar a…» lista una persona por asignación', async () => {
    renderTab(true)
    await openMenu(/Opciones del turno de Sede Norte/)
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Quitar a…' }), {
      key: 'ArrowRight',
    })
    expect(await screen.findByRole('menuitem', { name: 'Ana P.' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Luis G.' })).toBeTruthy()
  })

  it('un administrador no ve «Eliminar turno»', async () => {
    state.auth = { roles: ['admin'], capabilities: [] }
    renderTab(true)
    await openMenu(/Opciones del turno de Sede Norte/)
    expect(
      screen.queryByRole('menuitem', { name: 'Eliminar turno' }),
    ).toBeNull()
  })

  it('en solo lectura no hay ⋮ ni «+» ni horas editables', () => {
    state.auth = { roles: ['supervisor'], capabilities: [] }
    renderTab(false)
    expect(
      screen.queryByRole('button', { name: /Opciones del turno/ }),
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: /Agregar un turno/ }),
    ).toBeNull()
    expect(screen.queryByRole('button', { name: /Hora de inicio/ })).toBeNull()
  })

  it('el «+» del día abre Nuevo turno con cliente, sede, empleado y vuelta', () => {
    renderTab(true, '?mes=2026-11&sede=site1&empleado=e1')
    const day = screen.getByTestId('dia-2026-11-12')
    fireEvent.click(
      within(day).getByRole('button', { name: /Agregar un turno/ }),
    )
    const search = screen.getByTestId('nuevo').textContent ?? ''
    const params = new URLSearchParams(search)
    expect(params.get('fecha')).toBe('2026-11-12')
    expect(params.get('cliente')).toBe('c1')
    expect(params.get('sede')).toBe('site1')
    expect(params.get('empleado')).toBe('e1')
    const back = new URL(params.get('volver') ?? '', 'http://x')
    expect(back.pathname).toBe('/admin/clientes/c1')
    expect(back.searchParams.get('pestana')).toBe('calendario')
    expect(back.searchParams.get('mes')).toBe('2026-11')
  })

  it('sin permiso sobre turnos no hay «+» aunque se pueda editar', () => {
    state.auth = { roles: ['supervisor'], capabilities: [] }
    renderTab(true)
    expect(
      screen.queryByRole('button', { name: /Agregar un turno/ }),
    ).toBeNull()
  })

  it('ignora un sede= o empleado= que no está en las listas', () => {
    renderTab(false, '?mes=2026-11&sede=zzz&empleado=nadie')
    expect(
      within(screen.getByTestId('dia-2026-11-10')).getByTestId('turno'),
    ).toBeTruthy()
    expect(screen.getByLabelText('Sede')).toHaveValue('')
    expect(screen.getByLabelText('Empleado')).toHaveValue('')
  })

  it('arrastrar el turno a otro día lo mueve entero con el mismo horario', async () => {
    renderTab(true)
    dragTo('2026-11-10', '2026-11-12')
    await waitFor(() => expect(runCommandMock).toHaveBeenCalledTimes(1))
    expect(runCommandMock.mock.calls[0]?.[0]).toEqual({
      kind: 'shift_time',
      shiftId: 's1',
      date: '2026-11-12',
      start: '08:00',
      end: '12:00',
      openEnded: false,
    })
  })

  it('un turno finalizado no se arrastra a otro día', () => {
    state.shifts = [shift({ status: 'completed' })]
    renderTab(true)
    dragTo('2026-11-10', '2026-11-12')
    expect(runCommandMock).not.toHaveBeenCalled()
  })

  it('en solo lectura no se arrastra', () => {
    state.auth = { roles: ['supervisor'], capabilities: [] }
    renderTab(false)
    dragTo('2026-11-10', '2026-11-12')
    expect(runCommandMock).not.toHaveBeenCalled()
  })
})
