import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EndWorkdayDialog } from './EndWorkdayDialog'

const { mutateAsync } = vi.hoisted(() => ({ mutateAsync: vi.fn() }))

vi.mock('../queries', () => ({
  useEndWorkdayMutation: () => ({ mutateAsync, isPending: false }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

beforeEach(() => {
  mutateAsync.mockReset().mockResolvedValue(undefined)
})

function renderDialog(overrides = {}) {
  const onOpenChange = vi.fn()
  render(
    <EndWorkdayDialog
      workdayId="w1"
      supervisorName="Ana Gómez"
      workDate="2026-10-21"
      startedAt="2026-10-21T11:00:00Z"
      hasOpenPause
      hasOpenSupervision
      open
      onOpenChange={onOpenChange}
      {...overrides}
    />,
  )
  return onOpenChange
}

describe('EndWorkdayDialog (OD-06)', () => {
  it('explica qué pasa con la pausa y la supervisión abiertas', () => {
    renderDialog()
    expect(screen.getByText(/la pausa se cierra a esa hora/)).toBeVisible()
    expect(screen.getByText(/queda con la marca «Sin cerrar»/)).toBeVisible()
    expect(screen.getByText(/Ahora hay una pausa abierta/)).toBeVisible()
    expect(screen.getByText(/Ahora hay una supervisión abierta/)).toBeVisible()
  })

  it('exige el motivo', async () => {
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar jornada' }))
    expect(await screen.findByText('Escribí el motivo.')).toBeVisible()
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('con la hora por defecto no manda p_at (el servidor usa ahora)', async () => {
    const onOpenChange = renderDialog()
    fireEvent.change(screen.getByLabelText('Motivo'), {
      target: { value: 'Se le trabó la app' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar jornada' }))
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled())
    expect(mutateAsync).toHaveBeenCalledWith({
      workdayId: 'w1',
      at: undefined,
      reason: 'Se le trabó la app',
    })
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('no admite una hora futura', async () => {
    renderDialog()
    fireEvent.change(screen.getByLabelText('Hora de fin'), {
      target: { value: '2999-01-01T10:00' },
    })
    fireEvent.change(screen.getByLabelText('Motivo'), {
      target: { value: 'Motivo' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar jornada' }))
    expect(await screen.findByText(/no puede ser futura/)).toBeVisible()
    expect(mutateAsync).not.toHaveBeenCalled()
  })
})
