import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OnTheWayAction } from './OnTheWayAction'
import * as queriesModule from '@/features/employee/queries'
import * as onlineModule from '@/features/employee/useOnlineStatus'
import { ApiError } from '@/api/errors'
import type { MyDayAssignment } from '@/api/myDay'

vi.mock('@/features/employee/queries')
vi.mock('@/features/employee/useOnlineStatus')

function assignment(overrides: Partial<MyDayAssignment> = {}): MyDayAssignment {
  return {
    assignmentId: 'a1',
    shiftDate: '2026-10-07',
    startTime: '08:00:00',
    endTime: '12:00:00',
    startsAt: '2026-10-07T11:00:00Z',
    endsAt: '2026-10-07T15:00:00Z',
    status: 'expected',
    shiftStatus: 'scheduled',
    checkInAt: null,
    lastNoticeKind: null,
    ...overrides,
  } as MyDayAssignment
}

const mutateAsync = vi.fn()

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-07T10:00:00Z'))
  mutateAsync.mockReset()
  vi.mocked(queriesModule.useNotifyOnTheWayMutation).mockReturnValue({
    mutateAsync,
    isPending: false,
  } as unknown as ReturnType<typeof queriesModule.useNotifyOnTheWayMutation>)
  vi.mocked(onlineModule.useOnlineStatus).mockReturnValue(true)
})

afterEach(() => {
  vi.useRealTimers()
})

function openSheet() {
  fireEvent.click(screen.getByRole('button', { name: /Estoy en camino/ }))
}

describe('OnTheWayAction', () => {
  it('no muestra nada fuera de la ventana de 3 h', () => {
    vi.setSystemTime(new Date('2026-10-07T07:00:00Z'))
    const { container } = render(<OnTheWayAction assignment={assignment()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('no muestra nada si ya hay inicio registrado', () => {
    const { container } = render(
      <OnTheWayAction
        assignment={assignment({ checkInAt: '2026-10-07T10:30:00Z' })}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('muestra "Estoy en camino" y la hoja con las opciones rápidas', () => {
    render(<OnTheWayAction assignment={assignment()} />)
    openSheet()

    expect(screen.getByText('¿En cuánto llegás?')).toBeInTheDocument()
    for (const label of [
      '10 min',
      '15 min',
      '20 min',
      '30 min',
      '45 min',
      '60 min',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    expect(
      screen.getByRole('button', { name: 'No sé / sin estimar' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled()
  })

  it('confirma con los minutos elegidos', async () => {
    mutateAsync.mockResolvedValue({})
    render(<OnTheWayAction assignment={assignment()} />)
    openSheet()
    fireEvent.click(screen.getByRole('button', { name: '20 min' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        assignmentId: 'a1',
        etaMinutes: 20,
      }),
    )
  })

  it('"No sé / sin estimar" manda null', async () => {
    mutateAsync.mockResolvedValue({})
    render(<OnTheWayAction assignment={assignment()} />)
    openSheet()
    fireEvent.click(screen.getByRole('button', { name: 'No sé / sin estimar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        assignmentId: 'a1',
        etaMinutes: null,
      }),
    )
  })

  it('muestra el error del servidor mapeado', async () => {
    mutateAsync.mockRejectedValue(new ApiError('x', 'ABSENCE_ALREADY_NOTIFIED'))
    render(<OnTheWayAction assignment={assignment()} />)
    openSheet()
    fireEvent.click(screen.getByRole('button', { name: '10 min' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))

    expect(
      await screen.findByText(/Ya avisaste que no vas a ir/),
    ).toBeInTheDocument()
  })

  it('si ya avisó, ofrece "Cambiar hora estimada"', () => {
    render(
      <OnTheWayAction
        assignment={assignment({ lastNoticeKind: 'on_the_way' })}
      />,
    )
    expect(
      screen.getByRole('button', { name: /Cambiar hora estimada/ }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Estoy en camino/ }),
    ).not.toBeInTheDocument()
  })

  it('sin conexión deshabilita el botón', () => {
    vi.mocked(onlineModule.useOnlineStatus).mockReturnValue(false)
    render(<OnTheWayAction assignment={assignment()} />)
    expect(
      screen.getByRole('button', { name: /Estoy en camino/ }),
    ).toBeDisabled()
  })
})
