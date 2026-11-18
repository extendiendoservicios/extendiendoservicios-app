import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EmployeeLeavesTab } from './EmployeeLeavesTab'

function Ruta() {
  return <p>Ruta: {useLocation().pathname}</p>
}

const { saveMutateAsync } = vi.hoisted(() => ({
  saveMutateAsync: vi.fn(),
}))

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ userId: 'admin-1', roles: ['admin'], capabilities: [] }),
}))

vi.mock('@/features/planning/components/AssignEmployeeSheet', () => ({
  AssignEmployeeSheet: (props: {
    shiftId: string
    onAssigned?: () => void
  }) => (
    <div data-testid="assign-sheet">
      <p>Asignar en {props.shiftId}</p>
      <button type="button" onClick={() => props.onAssigned?.()}>
        Simular asignación
      </button>
    </div>
  ),
}))

vi.mock('@/features/employees/queries', () => ({
  useEmployeeLeavesQuery: () => ({
    isLoading: false,
    data: [
      {
        id: 'l1',
        startsOn: '2026-11-02',
        endsOn: '2026-11-10',
        reason: 'Vacaciones',
        deletedAt: null,
      },
      {
        id: 'l2',
        startsOn: '2026-01-02',
        endsOn: '2026-01-05',
        reason: null,
        deletedAt: '2026-01-03T10:00:00Z',
      },
    ],
  }),
  useSaveEmployeeLeaveMutation: () => ({
    mutateAsync: saveMutateAsync,
    isPending: false,
  }),
  useDeactivateEmployeeLeaveMutation: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}))

function entry(
  id: string,
  date: string,
  extra: Partial<Record<string, unknown>> = {},
) {
  return {
    assignmentId: `as-${id}`,
    shiftId: `sh-${id}`,
    shiftDate: date,
    startTime: '08:00:00',
    endTime: '12:00:00',
    openEnded: false,
    shiftStatus: 'assigned',
    clientId: 'c1',
    clientName: 'Limpia Ya',
    siteId: 'si1',
    siteName: 'Sede Centro',
    serviceId: 'sv1',
    serviceName: 'Limpieza mañana',
    message: null,
    ...extra,
  }
}

function result(
  released: ReturnType<typeof entry>[],
  kept: ReturnType<typeof entry>[],
  preview: boolean,
) {
  return {
    preview,
    leaveId: preview ? null : 'l-new',
    released,
    kept,
    releasedCount: released.length,
    keptCount: kept.length,
  }
}

/** Responde la vista previa y el guardado con la misma lista de turnos. */
function answerWith(
  released: ReturnType<typeof entry>[],
  kept: ReturnType<typeof entry>[] = [],
) {
  saveMutateAsync.mockImplementation(({ preview }: { preview?: boolean }) =>
    Promise.resolve(result(released, kept, Boolean(preview))),
  )
}

beforeEach(() => {
  saveMutateAsync.mockReset()
})

describe('EmployeeLeavesTab: editar licencia (AJ2-08)', () => {
  it('solo ofrece Editar en las licencias activas', () => {
    render(<EmployeeLeavesTab profileId="e1" canEdit />)
    expect(
      screen.getAllByRole('button', { name: /editar la licencia/i }),
    ).toHaveLength(1)
  })

  it('no ofrece Editar sin permiso', () => {
    render(<EmployeeLeavesTab profileId="e1" canEdit={false} />)
    expect(
      screen.queryByRole('button', { name: /editar la licencia/i }),
    ).toBeNull()
  })

  it('carga el formulario con los datos y guarda con save_employee_leave sobre la misma licencia', async () => {
    answerWith([])
    render(<EmployeeLeavesTab profileId="e1" canEdit />)
    fireEvent.click(screen.getByRole('button', { name: /editar la licencia/i }))
    expect(screen.getByLabelText('Desde')).toHaveValue('2026-11-02')
    expect(screen.getByLabelText('Hasta (opcional)')).toHaveValue('2026-11-10')
    expect(screen.getByLabelText('Motivo (opcional)')).toHaveValue('Vacaciones')

    fireEvent.change(screen.getByLabelText('Hasta (opcional)'), {
      target: { value: '2026-11-12' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    await waitFor(() => expect(saveMutateAsync).toHaveBeenCalledTimes(2))
    const input = {
      startsOn: '2026-11-02',
      endsOn: '2026-11-12',
      reason: 'Vacaciones',
    }
    expect(saveMutateAsync).toHaveBeenNthCalledWith(1, {
      input,
      leaveId: 'l1',
      preview: true,
    })
    expect(saveMutateAsync).toHaveBeenNthCalledWith(2, {
      input,
      leaveId: 'l1',
    })
  })

  it('cancelar la edición vuelve al formulario de alta vacío', () => {
    render(<EmployeeLeavesTab profileId="e1" canEdit />)
    fireEvent.click(screen.getByRole('button', { name: /editar la licencia/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar edición' }))
    expect(
      screen.getByRole('button', { name: 'Agregar licencia' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Desde')).toHaveValue('')
  })
})

describe('EmployeeLeavesTab: la licencia libera los turnos (OH-08)', () => {
  function fillAndSave() {
    fireEvent.change(screen.getByLabelText('Desde'), {
      target: { value: '2026-11-03' },
    })
    fireEvent.change(screen.getByLabelText('Hasta (opcional)'), {
      target: { value: '2026-11-06' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Agregar licencia' }))
  }

  function renderTab() {
    return render(
      <MemoryRouter>
        <EmployeeLeavesTab
          profileId="e1"
          canEdit
          person={{
            name: 'Ana Gómez',
            employeeNumber: 4,
            roleLabels: ['Empleado'],
            signerLabel: 'x',
          }}
        />
        <Ruta />
      </MemoryRouter>,
    )
  }

  it('sin nada para liberar guarda directo, sin diálogo ni aviso', async () => {
    answerWith([])
    renderTab()
    fillAndSave()
    await waitFor(() => expect(saveMutateAsync).toHaveBeenCalledTimes(2))
    const input = {
      startsOn: '2026-11-03',
      endsOn: '2026-11-06',
      reason: null,
    }
    expect(saveMutateAsync).toHaveBeenNthCalledWith(1, {
      input,
      leaveId: null,
      preview: true,
    })
    expect(saveMutateAsync).toHaveBeenNthCalledWith(2, {
      input,
      leaveId: null,
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText(/sin cubrir/)).toBeNull()
  })

  it('con turnos para liberar pide confirmar: lista los liberados y los que tienen fichajes', async () => {
    answerWith(
      [entry('1', '2026-11-04'), entry('2', '2026-11-05')],
      [entry('3', '2026-11-03', { serviceId: null, serviceName: null })],
    )
    renderTab()
    fillAndSave()
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Se van a liberar 2 turnos de Ana Gómez')
    expect(dialog).toHaveTextContent('Limpia Ya · Sede Centro')
    expect(dialog).toHaveTextContent('08:00–12:00')
    expect(dialog).toHaveTextContent('Limpieza mañana')
    expect(dialog).toHaveTextContent('Este turno tiene fichajes y no se toca')
    expect(dialog).toHaveTextContent('Turno cargado a mano')
    // Solo se hizo la vista previa: nada se guardó todavía.
    expect(saveMutateAsync).toHaveBeenCalledTimes(1)
    expect(saveMutateAsync.mock.calls[0]?.[0]).toMatchObject({ preview: true })
  })

  it('con varios turnos con fichajes lo dice en plural', async () => {
    answerWith([], [entry('3', '2026-11-03'), entry('4', '2026-11-04')])
    renderTab()
    fillAndSave()
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(
      'Estos 2 turnos tienen fichajes y no se tocan',
    )
  })

  it('Cancelar en el diálogo no guarda la licencia', async () => {
    answerWith([entry('1', '2026-11-04')])
    renderTab()
    fillAndSave()
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(saveMutateAsync).toHaveBeenCalledTimes(1)
  })

  it('Confirmar guarda sin vista previa y lista los turnos sin cubrir con «Reemplazar»', async () => {
    answerWith([entry('1', '2026-11-04'), entry('2', '2026-11-05')])
    renderTab()
    fillAndSave()
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(saveMutateAsync).toHaveBeenCalledTimes(2))
    expect(saveMutateAsync.mock.calls[1]?.[0]).not.toHaveProperty('preview')
    expect(
      await screen.findByText(/Quedaron 2 turnos sin cubrir/),
    ).toBeInTheDocument()
    const replaceButtons = screen.getAllByRole('button', {
      name: /Reemplazar en Limpia Ya/,
    })
    expect(replaceButtons).toHaveLength(2)

    // «Reemplazar» abre la asignación del turno; al asignar, sale de la lista.
    fireEvent.click(replaceButtons[0] as HTMLElement)
    expect(screen.getByTestId('assign-sheet')).toHaveTextContent(
      'Asignar en sh-1',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Simular asignación' }))
    await waitFor(() =>
      expect(
        screen.getAllByRole('button', { name: /Reemplazar en Limpia Ya/ }),
      ).toHaveLength(1),
    )
  })

  it('«Ver turno» lleva al turno liberado', async () => {
    answerWith([entry('1', '2026-11-04')])
    renderTab()
    fillAndSave()
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    await screen.findByText(/Quedó 1 turno sin cubrir/)
    fireEvent.click(screen.getByRole('button', { name: 'Ver turno' }))
    expect(
      await screen.findByText('Ruta: /admin/turnos/sh-1'),
    ).toBeInTheDocument()
  })

  it('si la vista previa falla no abre el diálogo ni guarda', async () => {
    saveMutateAsync.mockRejectedValue(new Error('boom'))
    renderTab()
    fillAndSave()
    await waitFor(() => expect(saveMutateAsync).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
