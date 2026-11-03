import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GenerateServiceShiftsDialog } from './GenerateServiceShiftsDialog'

const { generateMock } = vi.hoisted(() => ({ generateMock: vi.fn() }))

vi.mock('@/api/shifts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/shifts')>()),
  generateShifts: generateMock,
}))

function renderDialog(onFinish = vi.fn(), validFrom: string | null = null) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <GenerateServiceShiftsDialog
        serviceId="svc-1"
        validFrom={validFrom}
        onFinish={onFinish}
      />
    </QueryClientProvider>,
  )
  return onFinish
}

describe('GenerateServiceShiftsDialog (OD-27)', () => {
  beforeEach(() => {
    generateMock.mockReset()
  })

  it('pregunta si generar los turnos de este mes', () => {
    renderDialog()
    expect(
      screen.getByText('¿Generar los turnos de este mes ahora?'),
    ).toBeInTheDocument()
  })

  it('«Ahora no» cierra sin generar', () => {
    const onFinish = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Ahora no' }))
    expect(onFinish).toHaveBeenCalled()
    expect(generateMock).not.toHaveBeenCalled()
  })

  it('genera solo ese servicio e informa cuántos turnos se crearon', async () => {
    generateMock.mockResolvedValue({
      created: 12,
      skipped: 0,
      holidaysSkipped: 0,
      assigned: 0,
      unassigned: [],
      pastWithoutFixed: 0,
    })
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Generar turnos' }))
    await waitFor(() =>
      expect(screen.getByText(/Creamos 12 turnos/)).toBeInTheDocument(),
    )
    expect(generateMock).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number),
      'svc-1',
    )
  })

  it('muestra el mensaje del servidor si falla', async () => {
    generateMock.mockRejectedValue(
      Object.assign(new Error('No encontramos el servicio.'), {
        hint: 'SERVICE_NOT_FOUND',
      }),
    )
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Generar turnos' }))
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
  })
})
