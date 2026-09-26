import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import NotesPage from './NotesPage'
import * as queriesModule from '@/features/employee/queries'
import * as onlineModule from '@/features/employee/useOnlineStatus'
import type { MyDayAssignment } from '@/api/myDay'

/** EMP-09 (MOB-EMP-010): contador, guardado explícito y bloqueo sin conexión. */
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
    tasksTotal: 0,
    tasksDone: 0,
    changedSinceLastSeen: false,
    checkInAt: '2026-09-26T11:00:00Z',
    checkOutAt: null,
    ...overrides,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

function renderNotesPage() {
  return render(
    <MemoryRouter initialEntries={['/app/en-curso/a1/observaciones']}>
      <Routes>
        <Route
          path="/app/en-curso/:assignmentId/observaciones"
          element={<NotesPage />}
        />
      </Routes>
    </MemoryRouter>,
  )
}

describe('NotesPage (EMP-09)', () => {
  it('guarda el texto escrito al tocar "Guardar"', () => {
    vi.spyOn(onlineModule, 'useOnlineStatus').mockReturnValue(true)
    vi.spyOn(queriesModule, 'useMyDayQuery').mockReturnValue({
      data: [assignment({})],
      isLoading: false,
    } as never)
    const mutateAsync = vi
      .fn()
      .mockResolvedValue({ id: 'a1', notes: 'Todo bien' })
    vi.spyOn(queriesModule, 'useSetAssignmentNotesMutation').mockReturnValue({
      mutateAsync,
      isPending: false,
    } as never)

    renderNotesPage()

    fireEvent.change(screen.getByPlaceholderText(/observación/i), {
      target: { value: 'Todo bien' },
    })
    expect(screen.getByText('9/2000')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(mutateAsync).toHaveBeenCalledWith({
      assignmentId: 'a1',
      notes: 'Todo bien',
    })
  })

  it('deshabilita todo sin conexión', () => {
    vi.spyOn(onlineModule, 'useOnlineStatus').mockReturnValue(false)
    vi.spyOn(queriesModule, 'useMyDayQuery').mockReturnValue({
      data: [assignment({})],
      isLoading: false,
    } as never)
    vi.spyOn(queriesModule, 'useSetAssignmentNotesMutation').mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as never)

    renderNotesPage()

    expect(screen.getByPlaceholderText(/observación/i)).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()
    expect(screen.getByText(/sin conexión/i)).toBeInTheDocument()
  })
})
