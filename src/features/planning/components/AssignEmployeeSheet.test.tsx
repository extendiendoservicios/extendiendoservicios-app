import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AssignEmployeeSheet, WARNING_MESSAGES } from './AssignEmployeeSheet'

/** P19.11d: la licencia bloquea; ya no es una advertencia de `assign_employee`. */
const { assignMock } = vi.hoisted(() => ({ assignMock: vi.fn() }))

function candidate(id: string, name: string, onLeave: boolean) {
  return {
    employeeId: id,
    firstName: name,
    lastName: 'Prueba',
    hasEmployeeRole: true,
    enabledForClient: true,
    availableThatDay: true,
    onLeave,
    conflicts: [],
  }
}

vi.mock('@/features/planning/queries', () => ({
  useAssignCandidatesQuery: () => ({
    isLoading: false,
    data: [candidate('e1', 'Ana', false), candidate('e2', 'Luis', true)],
  }),
  useAssignEmployeeMutation: () => ({
    mutateAsync: assignMock,
    isPending: false,
  }),
}))

describe('AssignEmployeeSheet', () => {
  it('el candidato de licencia queda deshabilitado y marcado; los demás se eligen', () => {
    render(
      <AssignEmployeeSheet
        shiftId="sh1"
        clientId="c1"
        shiftDate="2026-10-21"
        shiftStartTime="08:00:00"
        shiftEndTime="12:00:00"
        excludeEmployeeIds={[]}
        open
        onOpenChange={() => {}}
      />,
    )
    const [ana, luis] = screen.getAllByTestId('assign-candidate') as [
      HTMLElement,
      HTMLElement,
    ]
    expect(luis).toBeDisabled()
    expect(
      screen.getByText('De licencia: no se puede asignar'),
    ).toBeInTheDocument()
    expect(ana).not.toBeDisabled()
    fireEvent.click(ana)
    expect(ana).toHaveAttribute('aria-checked', 'true')
  })

  it('la licencia ya no figura entre las advertencias', () => {
    expect(Object.keys(WARNING_MESSAGES)).not.toContain('ON_LEAVE')
  })
})
