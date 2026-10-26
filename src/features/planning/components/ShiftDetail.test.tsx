import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ShiftDetail } from './ShiftDetail'

// P19.10 y P24.3: «Cancelar» en las supervisiones del turno. Solo lo ve el dueño
// o el administrador con manage_supervisions, y solo con la supervisión en
// curso. Ya no existe «Asignar supervisión» (CJ-01): el coordinador toma el
// turno desde su celular y un turno puede tener varias supervisiones.

const { auth, shiftState } = vi.hoisted(() => ({
  auth: {
    roles: ['owner'] as string[],
    capabilities: [] as string[],
  },
  shiftState: { data: undefined as object | undefined },
}))

vi.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => auth }))
vi.mock('@/features/planning/queries', () => ({
  useShiftDetailQuery: () => ({
    isLoading: false,
    isError: false,
    data: shiftState.data,
  }),
}))
vi.mock('@/features/attendance/queries', () => ({
  useAssignmentsAttendanceQuery: () => ({ data: [] }),
  useAttendanceTimelineQuery: () => ({ data: new Map() }),
  usePeopleNamesQuery: () => ({ data: new Map() }),
}))
vi.mock('@/features/media/queries', () => ({
  useShiftMediaByShiftQuery: () => ({ data: [], isLoading: false }),
}))
vi.mock('@/features/media/components/ShiftMediaSection', () => ({
  ShiftMediaSection: () => null,
}))
vi.mock('./AssignEmployeeSheet', () => ({ AssignEmployeeSheet: () => null }))
vi.mock('./AssignmentTimeDialog', () => ({ AssignmentTimeDialog: () => null }))
vi.mock('./ReloadTasksDialog', () => ({ ReloadTasksDialog: () => null }))
vi.mock('./RemoveAssignmentDialog', () => ({
  RemoveAssignmentDialog: () => null,
}))
vi.mock('./ShiftDetailsDialog', () => ({ ShiftDetailsDialog: () => null }))
vi.mock('./ShiftRequiresPhotosControl', () => ({
  ShiftRequiresPhotosControl: () => null,
}))
vi.mock('./ShiftObservationSection', () => ({
  ShiftObservationSection: () => null,
}))
vi.mock('./AdminTaskList', () => ({ AdminTaskList: () => null }))
vi.mock('@/features/shifts/components/CancelShiftAction', () => ({
  CancelShiftAction: () => null,
}))
vi.mock('@/features/supervisions/components/CancelSupervisionDialog', () => ({
  CancelSupervisionDialog: (props: { supervisionId: string }) => (
    <div role="dialog" aria-label="Cancelar supervisión">
      {props.supervisionId}
    </div>
  ),
}))

type SupStatus =
  'assigned' | 'in_progress' | 'completed' | 'not_done' | 'cancelled'

function sup(id: string, firstName: string, status: SupStatus) {
  return {
    id,
    supervisorId: `u-${id}`,
    supervisorFirstName: firstName,
    supervisorLastName: 'Test',
    status,
    assignedAt: '2026-10-18T10:00:00Z',
    generalNotes: null,
    notDoneReason: null,
  }
}

function makeShift(
  supervisions: ReturnType<typeof sup>[],
  status = 'scheduled',
) {
  return {
    id: 'shift-1',
    clientId: 'c1',
    clientName: 'e2e-Cliente',
    siteId: 's1',
    siteName: 'e2e-Sede',
    siteCity: null,
    shiftDate: '2026-10-19',
    startTime: '08:00:00',
    endTime: '12:00:00',
    openEnded: false,
    startsAt: '2099-10-19T11:00:00Z',
    requiredStaff: 1,
    status,
    fromService: false,
    notes: null,
    showInPrint: null,
    generated: false,
    requiresPhotos: false,
    assignments: [],
    tasks: [],
    supervisions,
  }
}

function renderDetail() {
  return render(
    <MemoryRouter>
      <ShiftDetail shiftId="shift-1" />
    </MemoryRouter>,
  )
}

function itemOf(name: string): HTMLElement {
  const items = screen
    .getAllByRole('listitem')
    .filter((li) => li.textContent?.includes(`${name} Test`))
  expect(items).toHaveLength(1)
  return items[0] as HTMLElement
}

beforeEach(() => {
  auth.roles = ['owner']
  auth.capabilities = []
})

describe('ShiftDetail: Cancelar supervisión (P19.10)', () => {
  it('muestra «Cancelar» solo en la supervisión en curso, no en completada ni no realizada', () => {
    shiftState.data = makeShift([
      sup('a', 'Asig', 'assigned'),
      sup('b', 'Curso', 'in_progress'),
      sup('c', 'Terminada', 'completed'),
      sup('d', 'Omitida', 'not_done'),
    ])
    renderDetail()
    expect(
      within(itemOf('Asig')).queryByRole('button', {
        name: 'Cancelar supervisión',
      }),
    ).toBeNull()
    expect(
      within(itemOf('Curso')).getByRole('button', {
        name: 'Cancelar supervisión',
      }),
    ).toBeVisible()
    expect(
      within(itemOf('Terminada')).queryByRole('button', {
        name: 'Cancelar supervisión',
      }),
    ).toBeNull()
    expect(
      within(itemOf('Omitida')).queryByRole('button', {
        name: 'Cancelar supervisión',
      }),
    ).toBeNull()
  })

  it('no lista la cancelada y, si era la única, muestra el texto de sin supervisión', () => {
    shiftState.data = makeShift([sup('x', 'Cancelada', 'cancelled')])
    renderDetail()
    expect(screen.queryByText(/Cancelada Test/)).toBeNull()
    expect(
      screen.getByText(
        'Este turno todavía no tuvo supervisión. Los coordinadores eligen qué turno supervisar desde su celular.',
      ),
    ).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Cancelar supervisión' }),
    ).toBeNull()
  })

  it('lista a los dos coordinadores que supervisan el mismo turno (CJ-05)', () => {
    shiftState.data = makeShift([
      sup('uno', 'Ana', 'in_progress'),
      sup('dos', 'Bruno', 'completed'),
    ])
    renderDetail()
    expect(itemOf('Ana')).toBeVisible()
    expect(itemOf('Bruno')).toBeVisible()
    expect(
      screen.getAllByRole('button', { name: 'Cancelar supervisión' }),
    ).toHaveLength(1)
  })

  it('no ofrece «Asignar supervisión» ni siquiera al dueño', () => {
    shiftState.data = makeShift([])
    renderDetail()
    expect(screen.queryByText(/Asignar supervisión/)).toBeNull()
    expect(screen.queryByRole('link', { name: /Asignar/ })).toBeNull()
  })

  it('el administrador sin manage_supervisions no ve «Cancelar»', () => {
    auth.roles = ['admin']
    auth.capabilities = []
    shiftState.data = makeShift([sup('a', 'Asig', 'in_progress')])
    renderDetail()
    expect(itemOf('Asig')).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Cancelar supervisión' }),
    ).toBeNull()
  })

  it('el administrador con manage_supervisions ve «Cancelar»', () => {
    auth.roles = ['admin']
    auth.capabilities = ['manage_supervisions']
    shiftState.data = makeShift([sup('a', 'Asig', 'in_progress')])
    renderDetail()
    expect(
      screen.getByRole('button', { name: 'Cancelar supervisión' }),
    ).toBeVisible()
  })

  it('«Cancelar» abre el diálogo y le pasa el id de esa supervisión', () => {
    shiftState.data = makeShift([
      sup('a', 'Asig', 'completed'),
      sup('b', 'Curso', 'in_progress'),
    ])
    renderDetail()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(
      within(itemOf('Curso')).getByRole('button', {
        name: 'Cancelar supervisión',
      }),
    )
    expect(
      screen.getByRole('dialog', { name: 'Cancelar supervisión' }),
    ).toHaveTextContent('b')
  })

  it('en un turno completado igual ofrece «Cancelar» (el servidor no lo restringe por el turno)', () => {
    shiftState.data = makeShift([sup('a', 'Asig', 'in_progress')], 'completed')
    renderDetail()
    expect(
      screen.getByRole('button', { name: 'Cancelar supervisión' }),
    ).toBeVisible()
  })
})
