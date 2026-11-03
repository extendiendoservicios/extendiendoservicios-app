import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CloseSupervisionPage from './CloseSupervisionPage'
import * as mySupervisionsModule from '@/api/mySupervisions'
import type { MySupervision, SupervisionRating } from '@/api/mySupervisions'
import { makeMySupervision } from '@/features/coordinator/fixtures'
import { mockCommonHooks, renderRoute } from '@/features/coordinator/testUtils'

vi.mock('@/features/settings/queries', () => ({
  useCompanySettingsQuery: () => ({
    data: { locationConsentText: 'Texto de consentimiento de la empresa' },
  }),
}))

/**
 * SUP-06 (P24.2, CJ-28; P27 OD-09): «Cerrar supervisión» no exige calificar:
 * avisa a quién falta y pide confirmación; registra el fin con la posición; sin ubicación el cierre se hace igual (CJ-21).
 */
function setup(
  supervision: MySupervision,
  {
    ratings = [],
    mutateAsync = vi.fn().mockResolvedValue({}),
    consent = 'declined',
    online = true,
  }: {
    ratings?: SupervisionRating[]
    mutateAsync?: ReturnType<typeof vi.fn>
    consent?: 'granted' | 'needs-consent' | 'declined'
    online?: boolean
  } = {},
) {
  mockCommonHooks({ consent, online })
  vi.spyOn(mySupervisionsModule, 'useMySupervisionQuery').mockReturnValue({
    data: supervision,
    isLoading: false,
    isError: false,
  } as never)
  vi.spyOn(
    mySupervisionsModule,
    'useSupervisionAssignmentsQuery',
  ).mockReturnValue({
    data: [{ assignmentId: 'a1', employeeId: 'e1' }],
  } as never)
  vi.spyOn(mySupervisionsModule, 'useSupervisionRatingsQuery').mockReturnValue({
    data: ratings,
  } as never)
  vi.spyOn(
    mySupervisionsModule,
    'useCompleteSupervisionMutation',
  ).mockReturnValue({ mutateAsync, isPending: false } as never)
  renderRoute(<CloseSupervisionPage />, {
    path: '/sup/supervisiones/:id/cerrar',
    entry: '/sup/supervisiones/sv1/cerrar',
  })
  return mutateAsync
}

const RATING = { id: 'r1', assignmentId: 'a1', score: 5, comment: null }

afterEach(() => vi.restoreAllMocks())

describe('CloseSupervisionPage (SUP-06)', () => {
  it('OD-09: con alguien sin calificar avisa «Te falta calificar a» pero deja cerrar, con confirmación', async () => {
    const mutateAsync = setup(makeMySupervision())

    expect(
      screen.getByText('Calificaste a 0 de 1 empleado.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Te falta calificar a:')).toBeInTheDocument()
    const close = screen.getByRole('button', { name: 'Cerrar supervisión' })
    expect(close).toBeEnabled()

    fireEvent.click(close)
    expect(
      await screen.findByText('¿Cerrar sin calificar a todos?'),
    ).toBeInTheDocument()
    expect(mutateAsync).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar igual' }))
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled())
  })

  it('OD-09: en la confirmación, «Volver» no cierra', async () => {
    const mutateAsync = setup(makeMySupervision())

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar supervisión' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Volver' }))

    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('lista a quién falta con acceso a calificar', () => {
    setup(makeMySupervision())

    const link = screen.getByRole('link', { name: 'Ana Gómez' })
    expect(link).toHaveAttribute('href', '/sup/supervisiones/sv1/calificar/a1')
  })

  it('con todos calificados cierra con la nota, sin ubicación si no hay consentimiento, y vuelve a Hoy', async () => {
    const mutateAsync = setup(makeMySupervision(), { ratings: [RATING] })

    expect(
      screen.getByText('Calificaste a 1 de 1 empleado.'),
    ).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Nota general (opcional)…'), {
      target: { value: 'Todo en orden' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar supervisión' }))

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        supervisionId: 'sv1',
        generalNotes: 'Todo en orden',
        coords: null,
        outsideReason: null,
      }),
    )
    expect(await screen.findByText('otra pantalla')).toBeInTheDocument()
  })

  it('los ausentes no se califican y no bloquean el cierre (CJ-28)', () => {
    setup(
      makeMySupervision({
        assignedEmployees: [
          {
            employeeId: 'e1',
            firstName: 'Ana',
            lastName: 'Gómez',
            status: 'absence_notified',
            checkInAt: null,
          },
        ],
      }),
    )

    expect(
      screen.getByRole('button', { name: 'Cerrar supervisión' }),
    ).toBeEnabled()
    expect(
      screen.getByText('Calificaste a 0 de 0 empleados.'),
    ).toBeInTheDocument()
  })

  it('si falta el consentimiento, lo muestra antes de cerrar', async () => {
    const mutateAsync = setup(makeMySupervision(), {
      ratings: [RATING],
      consent: 'needs-consent',
    })

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar supervisión' }))

    expect(
      await screen.findByText('Texto de consentimiento de la empresa'),
    ).toBeInTheDocument()
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('sin conexión no se puede cerrar', () => {
    setup(makeMySupervision(), { ratings: [RATING], online: false })

    expect(screen.getByText(/Estás sin conexión/)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Cerrar supervisión' }),
    ).toBeDisabled()
  })

  it('ya no existe «No se pudo realizar» (mark_supervision_not_done está revocada)', () => {
    setup(makeMySupervision(), { ratings: [RATING] })

    expect(screen.queryByText(/No se pudo realizar/)).not.toBeInTheDocument()
    expect(screen.queryByText(/no realizada/)).not.toBeInTheDocument()
  })

  it('no ofrece nada para cerrar cuando la supervisión ya está completada', () => {
    setup(makeMySupervision({ status: 'completed' }), { ratings: [RATING] })

    expect(
      screen.queryByRole('button', { name: 'Cerrar supervisión' }),
    ).not.toBeInTheDocument()
  })
})
