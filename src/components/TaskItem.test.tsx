import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { TaskItem } from './TaskItem'

describe('TaskItem', () => {
  it('tocar la casilla en una tarea pendiente llama a onComplete', () => {
    const onComplete = vi.fn()
    render(
      <TaskItem
        id="t1"
        title="Limpiar sanitarios"
        status="pending"
        onComplete={onComplete}
      />,
    )
    fireEvent.click(screen.getByRole('checkbox'))
    expect(onComplete).toHaveBeenCalledWith('t1')
  })

  it('"No realizada" exige un motivo antes de confirmar', () => {
    const onMarkNotDone = vi.fn()
    render(
      <TaskItem
        id="t1"
        title="Aspirar oficinas"
        status="pending"
        onMarkNotDone={onMarkNotDone}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'No realizada' }))
    const confirmButton = screen.getByRole('button', {
      name: 'Marcar no realizada',
    })
    expect(confirmButton).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Motivo'), {
      target: { value: 'No había insumos' },
    })
    expect(confirmButton).toBeEnabled()

    fireEvent.click(confirmButton)
    expect(onMarkNotDone).toHaveBeenCalledWith('t1', 'No había insumos')
  })

  it('en modo solo lectura no dispara ningún callback', () => {
    const onComplete = vi.fn()
    const onUndo = vi.fn()
    render(
      <TaskItem
        id="t1"
        title="Retirar residuos"
        status="done"
        completedAt="2026-08-13T09:15:00-03:00"
        readOnly
        onComplete={onComplete}
        onUndo={onUndo}
      />,
    )

    // Sin acción "No realizada" visible en modo lectura.
    expect(
      screen.queryByRole('button', { name: 'No realizada' }),
    ).not.toBeInTheDocument()

    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).toBeDisabled()
    fireEvent.click(checkbox)
    expect(onComplete).not.toHaveBeenCalled()
    expect(onUndo).not.toHaveBeenCalled()
  })

  it('muestra la etiqueta "Opcional" cuando is_required es falso', () => {
    render(
      <TaskItem
        id="t1"
        title="Revisar cocina"
        status="pending"
        isRequired={false}
      />,
    )
    expect(screen.getByText('Opcional')).toBeInTheDocument()
  })

  it('una tarea done atenuada muestra "Completada HH:mm"', () => {
    render(
      <TaskItem
        id="t1"
        title="Reponer papel"
        status="done"
        completedAt="2026-08-13T08:41:00-03:00"
      />,
    )
    expect(screen.getByText('Completada 08:41')).toBeInTheDocument()
  })

  it('una tarea not_done muestra el motivo', () => {
    render(
      <TaskItem
        id="t1"
        title="Vaciar cestos"
        status="not_done"
        notDoneReason="Cesto roto"
      />,
    )
    expect(screen.getByText('No realizada · Cesto roto')).toBeInTheDocument()
  })
})
