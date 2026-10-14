import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ShiftRequiresPhotosControl } from './ShiftRequiresPhotosControl'

const { mutateAsync, toastSuccess, toastError } = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/features/planning/queries', () => ({
  useUpdateShiftDetailsMutation: () => ({ mutateAsync, isPending: false }),
}))
vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: toastError },
}))

beforeEach(() => {
  mutateAsync.mockReset().mockResolvedValue(undefined)
  toastSuccess.mockReset()
  toastError.mockReset()
})

describe('ShiftRequiresPhotosControl (AJ4-03)', () => {
  it('al tildar guarda reenviando la dotación y la observación actuales', async () => {
    render(
      <ShiftRequiresPhotosControl
        shiftId="s1"
        requiredStaff={3}
        notes="Llevar llaves"
        showInPrint={false}
        requiresPhotos={false}
      />,
    )
    fireEvent.click(screen.getByRole('checkbox', { name: /Pide fotos/ }))
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        shiftId: 's1',
        requiredStaff: 3,
        notes: 'Llevar llaves',
        showInPrint: false,
        requiresPhotos: true,
      }),
    )
    expect(toastSuccess).toHaveBeenCalledWith('Ahora el turno pide fotos.')
  })

  it('al destildar avisa que ya no pide fotos', async () => {
    render(
      <ShiftRequiresPhotosControl
        shiftId="s1"
        requiredStaff={2}
        notes={null}
        showInPrint={null}
        requiresPhotos
      />,
    )
    fireEvent.click(screen.getByRole('checkbox', { name: /Pide fotos/ }))
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('El turno ya no pide fotos.'),
    )
    expect(mutateAsync).toHaveBeenCalledWith({
      shiftId: 's1',
      requiredStaff: 2,
      notes: null,
      showInPrint: undefined,
      requiresPhotos: false,
    })
  })

  it('si falla muestra el error', async () => {
    mutateAsync.mockRejectedValue(new Error('x'))
    render(
      <ShiftRequiresPhotosControl
        shiftId="s1"
        requiredStaff={2}
        notes={null}
        showInPrint={null}
        requiresPhotos={false}
      />,
    )
    fireEvent.click(screen.getByRole('checkbox', { name: /Pide fotos/ }))
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'No pudimos actualizar el turno.',
      ),
    )
  })
})
