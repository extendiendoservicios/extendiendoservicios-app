import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RateEmployeeDialog } from './RateEmployeeDialog'

/**
 * ADM-15 (SUP-011): mismo patrón que `RecordAttendanceSheet.test.tsx` -- se
 * mockea la mutación de `@/features/supervisions/queries`, sin red.
 */
const { rateEmployeeMock } = vi.hoisted(() => ({
  rateEmployeeMock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/features/supervisions/queries', () => ({
  useRateEmployeeMutation: () => ({
    mutateAsync: rateEmployeeMock,
    isPending: false,
  }),
}))

describe('RateEmployeeDialog', () => {
  it('exige un puntaje antes de guardar', () => {
    render(
      <RateEmployeeDialog
        supervisionId="s1"
        assignmentId="a1"
        employeeName="Ana Gómez"
        currentScore={null}
        currentComment={null}
        open
        onOpenChange={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(screen.getByText('Elegí un puntaje de 1 a 5.')).toBeInTheDocument()
    expect(rateEmployeeMock).not.toHaveBeenCalled()
  })

  it('sin calificación previa: título "Calificar" y upsert con el puntaje elegido', async () => {
    render(
      <RateEmployeeDialog
        supervisionId="s1"
        assignmentId="a1"
        employeeName="Ana Gómez"
        currentScore={null}
        currentComment={null}
        open
        onOpenChange={() => {}}
      />,
    )
    expect(
      screen.getByText('Calificar a Ana Gómez', { exact: false }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: '4 de 5 estrellas' }))
    fireEvent.change(screen.getByLabelText('Comentario (opcional)'), {
      target: { value: 'Muy prolija' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    await vi.waitFor(() => {
      expect(rateEmployeeMock).toHaveBeenCalledWith({
        supervisionId: 's1',
        assignmentId: 'a1',
        score: 4,
        comment: 'Muy prolija',
      })
    })
  })

  it('con calificación previa: título "Editar calificación" y empieza con el puntaje actual', () => {
    render(
      <RateEmployeeDialog
        supervisionId="s1"
        assignmentId="a1"
        employeeName="Ana Gómez"
        currentScore={3}
        currentComment="Llegó tarde"
        open
        onOpenChange={() => {}}
      />,
    )
    expect(
      screen.getByText('Editar calificación a Ana Gómez', { exact: false }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: '3 de 5 estrellas' }),
    ).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByLabelText('Comentario (opcional)')).toHaveValue(
      'Llegó tarde',
    )
  })
})
