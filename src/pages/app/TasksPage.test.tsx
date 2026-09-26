import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TasksPage from './TasksPage'
import * as queriesModule from '@/features/employee/queries'
import * as onlineModule from '@/features/employee/useOnlineStatus'
import type { MyDayAssignment } from '@/api/myDay'
import type { ShiftTask } from '@/api/tasks'

/**
 * EMP-08 (MOB-EMP-009): solo lectura fuera de la ventana propia (con el
 * aviso correspondiente) y guardado por ítem dentro de la ventana. Mismo
 * patrón de mocks que `MorePage.test.tsx`: se reemplazan los hooks de
 * `src/features/employee/queries.ts` en vez de montar `QueryClientProvider`
 * de verdad.
 */
function assignment(overrides: Partial<MyDayAssignment>): MyDayAssignment {
  return {
    assignmentId: 'a1',
    shiftId: 'sh1',
    shiftDate: '2026-09-26',
    isToday: true,
    clientId: 'c1',
    clientName: 'Limpia Ya',
    siteId: 'si1',
    siteName: 'Sede Centro',
    siteAddress: null,
    siteContactName: null,
    siteContactPhone: null,
    accessInstructions: null,
    buildingHours: null,
    phoneRestricted: false,
    photosNotAllowed: false,
    restrictionsNotes: null,
    startTime: '08:00:00',
    endTime: '12:00:00',
    startsAt: null,
    endsAt: null,
    status: 'present',
    shiftStatus: 'in_progress',
    notes: null,
    tasksTotal: 1,
    tasksDone: 0,
    changedSinceLastSeen: false,
    checkInAt: '2026-09-26T11:00:00Z',
    checkOutAt: null,
    ...overrides,
  }
}

function task(overrides: Partial<ShiftTask>): ShiftTask {
  return {
    id: 't1',
    shiftId: 'sh1',
    position: 0,
    title: 'Barrer el hall',
    description: null,
    isRequired: true,
    status: 'pending',
    notDoneReason: null,
    statusChangedAt: null,
    ...overrides,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

function renderTasksPage() {
  return render(
    <MemoryRouter initialEntries={['/app/en-curso/a1/tareas']}>
      <Routes>
        <Route
          path="/app/en-curso/:assignmentId/tareas"
          element={<TasksPage />}
        />
      </Routes>
    </MemoryRouter>,
  )
}

describe('TasksPage (EMP-08)', () => {
  it('deja marcar tareas cuando la asignación está `present`', () => {
    vi.spyOn(onlineModule, 'useOnlineStatus').mockReturnValue(true)
    vi.spyOn(queriesModule, 'useMyDayQuery').mockReturnValue({
      data: [assignment({ status: 'present' })],
      isLoading: false,
    } as never)
    vi.spyOn(queriesModule, 'useShiftTasksQuery').mockReturnValue({
      data: [task({})],
    } as never)
    const mutateAsync = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(queriesModule, 'useUpdateTaskStatusMutation').mockReturnValue({
      mutateAsync,
    } as never)

    renderTasksPage()

    expect(
      screen.queryByText(/no registraste el inicio/i),
    ).not.toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('checkbox', { name: /marcar "barrer el hall"/i }),
    )
    expect(mutateAsync).toHaveBeenCalledWith({
      taskId: 't1',
      status: 'done',
      reason: undefined,
    })
  })

  it('muestra solo lectura y el aviso cuando la asignación no está `present`', () => {
    vi.spyOn(onlineModule, 'useOnlineStatus').mockReturnValue(true)
    vi.spyOn(queriesModule, 'useMyDayQuery').mockReturnValue({
      data: [
        assignment({ status: 'expected', checkInAt: null, checkOutAt: null }),
      ],
      isLoading: false,
    } as never)
    vi.spyOn(queriesModule, 'useShiftTasksQuery').mockReturnValue({
      data: [task({})],
    } as never)
    vi.spyOn(queriesModule, 'useUpdateTaskStatusMutation').mockReturnValue({
      mutateAsync: vi.fn(),
    } as never)

    renderTasksPage()

    expect(screen.getByText(/no registraste el inicio/i)).toBeInTheDocument()
    expect(
      screen.getByRole('checkbox', { name: /"barrer el hall" pendiente/i }),
    ).toBeDisabled()
  })

  it('sin conexión, avisa y no deja marcar aunque esté dentro de la ventana', () => {
    vi.spyOn(onlineModule, 'useOnlineStatus').mockReturnValue(false)
    vi.spyOn(queriesModule, 'useMyDayQuery').mockReturnValue({
      data: [assignment({ status: 'present' })],
      isLoading: false,
    } as never)
    vi.spyOn(queriesModule, 'useShiftTasksQuery').mockReturnValue({
      data: [task({})],
    } as never)
    vi.spyOn(queriesModule, 'useUpdateTaskStatusMutation').mockReturnValue({
      mutateAsync: vi.fn(),
    } as never)

    renderTasksPage()

    expect(screen.getByText(/sin conexión/i)).toBeInTheDocument()
    expect(
      screen.getByRole('checkbox', { name: /"barrer el hall" pendiente/i }),
    ).toBeDisabled()
  })
})
