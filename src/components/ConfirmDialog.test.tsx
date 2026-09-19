import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ConfirmDialog } from './ConfirmDialog'

function Wrapper({ onConfirm }: { onConfirm: (reason: string) => void }) {
  const [open, setOpen] = React.useState(true)
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      title="Cancelar turno"
      description="Esta acción no se puede deshacer."
      onConfirm={onConfirm}
    />
  )
}

describe('ConfirmDialog', () => {
  it('el botón de confirmar arranca deshabilitado sin motivo', () => {
    render(<Wrapper onConfirm={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled()
  })

  it('sigue deshabilitado si el motivo es solo espacios', () => {
    render(<Wrapper onConfirm={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Motivo'), {
      target: { value: '   ' },
    })
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled()
  })

  it('se habilita con un motivo y lo devuelve recortado al confirmar', () => {
    const onConfirm = vi.fn()
    render(<Wrapper onConfirm={onConfirm} />)

    const confirmButton = screen.getByRole('button', { name: 'Confirmar' })
    fireEvent.change(screen.getByLabelText('Motivo'), {
      target: { value: '  Cliente pidió cancelar  ' },
    })
    expect(confirmButton).toBeEnabled()

    fireEvent.click(confirmButton)
    expect(onConfirm).toHaveBeenCalledWith('Cliente pidió cancelar')
  })

  it('cancelar no llama a onConfirm', () => {
    const onConfirm = vi.fn()
    render(<Wrapper onConfirm={onConfirm} />)

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
