import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SupervisionDetailPage from './SupervisionDetailPage'
import * as mySupervisionsModule from '@/api/mySupervisions'
import type { MySupervision, SupervisionRating } from '@/api/mySupervisions'
import { ApiError } from '@/api/errors'
import { makeMySupervision } from '@/features/coordinator/fixtures'
import { mockCommonHooks, renderRoute } from '@/features/coordinator/testUtils'

/**
 * El bloque «Fotos y videos» (módulo H, P21.3) tiene sus propios tests en
 * `ShiftMediaSection.test.tsx`: acá se reemplaza por un marcador con las
 * propiedades que recibe.
 */
vi.mock('@/features/employee/components/LazyShiftMediaSection', () => ({
  LazyShiftMediaSection: (props: {
    shiftId: string
    counts: { photos: number; videos: number }
    requiresPhotos: boolean
    photosNotAllowed: boolean
  }) => (
    <div
      data-testid="media-section"
      data-shift={props.shiftId}
      data-photos={props.counts.photos}
      data-videos={props.counts.videos}
      data-requires={String(props.requiresPhotos)}
      data-not-allowed={String(props.photosNotAllowed)}
    />
  ),
}))

/**
 * SUP-04 · Supervisión (P24.2): sede, franja, empleados con su estado e inicio
 * real, tareas en solo lectura y la guía de criterios; «Descartar» (CJ-27) y
 * «Cerrar supervisión» deshabilitado mientras falte calificar a alguien
 * (CJ-10, CJ-28). Por empleado, «Calificar» no se ofrece para el propio
 * coordinador (CB-13) ni fuera del plazo de P-083 (MOB-SUP-011). Mismo patrón
 * de mocks que el resto de la vía: se reemplazan los hooks del módulo de datos.
 */
function setup(
  supervision: MySupervision,
  {
    ratings = [] as SupervisionRating[],
    assignments = [{ assignmentId: 'a1', employeeId: 'e1' }],
    discard = vi.fn().mockResolvedValue({}),
  } = {},
) {
  mockCommonHooks()
  vi.spyOn(
    mySupervisionsModule,
    'useSupervisionShiftTasksQuery',
  ).mockReturnValue({ data: [] } as never)
  vi.spyOn(
    mySupervisionsModule,
    'useVigentRatingCriteriaQuery',
  ).mockReturnValue({ data: [] } as never)
  vi.spyOn(
    mySupervisionsModule,
    'useSupervisionAssignmentsQuery',
  ).mockReturnValue({ data: assignments } as never)
  vi.spyOn(mySupervisionsModule, 'useSupervisionRatingsQuery').mockReturnValue({
    data: ratings,
  } as never)
  vi.spyOn(mySupervisionsModule, 'useMySupervisionQuery').mockReturnValue({
    data: supervision,
    isLoading: false,
    isError: false,
  } as never)
  vi.spyOn(
    mySupervisionsModule,
    'useDiscardSupervisionMutation',
  ).mockReturnValue({ mutateAsync: discard, isPending: false } as never)
  renderRoute(<SupervisionDetailPage />, {
    path: '/sup/supervisiones/:id',
    entry: '/sup/supervisiones/sv1',
  })
  return { discard }
}

const RATING = { id: 'r1', assignmentId: 'a1', score: 4, comment: null }

afterEach(() => vi.restoreAllMocks())

describe('SupervisionDetailPage (SUP-04)', () => {
  it('muestra el cliente, la sede, la franja y los empleados con su estado e inicio real', () => {
    setup(makeMySupervision())

    expect(screen.getByText('Limpiadora SRL')).toBeInTheDocument()
    expect(screen.getAllByText('Sede Centro').length).toBeGreaterThan(0)
    expect(screen.getByText('08:00–12:00')).toBeInTheDocument()
    expect(screen.getAllByText('Ana Gómez').length).toBeGreaterThan(0)
    expect(screen.getByText('Inicio: 08:05')).toBeInTheDocument()
  })

  it('ya no ofrece registrar inicio ni fin: eso lo hacen «Supervisar» y «Cerrar»', () => {
    setup(makeMySupervision())

    expect(screen.queryByText(/Registrar (inicio|fin)/)).not.toBeInTheDocument()
  })

  it('«Cerrar supervisión» queda deshabilitado mientras falte calificar y lista a quién (CJ-10)', () => {
    setup(makeMySupervision(), { ratings: [] })

    expect(
      screen.getByRole('button', { name: 'Cerrar supervisión' }),
    ).toBeDisabled()
    expect(screen.getByText(/falta calificar a: Ana Gómez/)).toBeInTheDocument()
  })

  it('con todos calificados, «Cerrar supervisión» lleva a cerrar', () => {
    setup(makeMySupervision(), { ratings: [RATING] })

    const link = screen.getByText('Cerrar supervisión').closest('a')
    expect(link).toHaveAttribute('href', '/sup/supervisiones/sv1/cerrar')
    expect(link).toHaveAttribute('data-size', 'mobile')
  })

  it('un empleado ausente (sin inicio) no se califica ni bloquea el cierre (CJ-28)', () => {
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

    expect(screen.getByText('Cerrar supervisión').closest('a')).toHaveAttribute(
      'href',
      '/sup/supervisiones/sv1/cerrar',
    )
    expect(screen.queryByText('Calificar')).not.toBeInTheDocument()
  })

  it('«Descartar» se ofrece solo si todavía no calificó a nadie (CJ-27)', () => {
    setup(makeMySupervision(), { ratings: [] })

    expect(screen.getByRole('button', { name: 'Descartar' })).toBeEnabled()
  })

  it('con alguien ya calificado no ofrece «Descartar»', () => {
    setup(makeMySupervision(), { ratings: [RATING] })

    expect(
      screen.queryByRole('button', { name: 'Descartar' }),
    ).not.toBeInTheDocument()
  })

  it('«Descartar» pide confirmación, descarta y vuelve a Hoy', async () => {
    const { discard } = setup(makeMySupervision())

    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }))
    expect(discard).not.toHaveBeenCalled()
    fireEvent.click(
      await screen.findByRole('button', { name: 'Descartar supervisión' }),
    )

    await waitFor(() =>
      expect(discard).toHaveBeenCalledWith({ supervisionId: 'sv1' }),
    )
    expect(await screen.findByText('otra pantalla')).toBeInTheDocument()
  })

  it('si la base rechaza el descarte, muestra el motivo claro', async () => {
    setup(makeMySupervision(), {
      discard: vi
        .fn()
        .mockRejectedValue(new ApiError('crudo', 'SUPERVISION_HAS_RATINGS')),
    })

    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Descartar supervisión' }),
    )

    expect(await screen.findByText(/no se puede descartar/)).toBeInTheDocument()
  })

  it('una supervisión completada no ofrece cerrar ni descartar', () => {
    setup(makeMySupervision({ status: 'completed' }))

    expect(screen.queryByText('Cerrar supervisión')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Descartar' }),
    ).not.toBeInTheDocument()
  })

  it('«Sin cerrar» (jornada cerrada sola): avisa y no ofrece cerrar ni descartar (CJ-31)', () => {
    setup(makeMySupervision({ checkOutAt: '2026-10-24T02:55:00Z' }))

    expect(screen.getByText(/quedó sin cerrar/)).toBeInTheDocument()
    expect(screen.queryByText('Cerrar supervisión')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Descartar' }),
    ).not.toBeInTheDocument()
  })

  it('ofrece «Calificar» para un empleado con inicio mientras la supervisión está abierta', () => {
    setup(makeMySupervision())

    const link = screen.getByText('Calificar').closest('a')
    expect(link).toHaveAttribute('href', '/sup/supervisiones/sv1/calificar/a1')
  })

  it('CB-13: no ofrece calificarse a sí mismo cuando el coordinador también es empleado del turno', () => {
    setup(
      makeMySupervision({
        assignedEmployees: [
          {
            employeeId: 'sup-1',
            firstName: 'Marta',
            lastName: 'Ríos',
            status: 'present',
            checkInAt: '2026-10-23T11:05:00Z',
          },
        ],
      }),
      { assignments: [{ assignmentId: 'a1', employeeId: 'sup-1' }] },
    )

    expect(screen.queryByText('Calificar')).not.toBeInTheDocument()
    expect(screen.getByText('Vos')).toBeInTheDocument()
    // Fuera del requisito: nada pendiente, se puede cerrar.
    expect(screen.getByText('Cerrar supervisión').closest('a')).toBeTruthy()
  })

  it('MOB-SUP-011: no ofrece calificar cuando el plazo de P-083 ya cerró', () => {
    setup(
      makeMySupervision({
        status: 'completed',
        checkOutAt: '2026-10-23T12:00:00Z',
        endsAt: '2020-01-01T12:00:00Z',
      }),
    )

    expect(screen.queryByText('Calificar')).not.toBeInTheDocument()
    expect(
      screen.getByText('El plazo para calificar a este turno ya cerró.'),
    ).toBeInTheDocument()
  })
})

describe('SupervisionDetailPage · fotos y videos (módulo H, P21.3)', () => {
  it.each(['in_progress', 'completed'] as const)(
    'con la supervisión %s ofrece el bloque con los datos de la vista',
    (status) => {
      setup(
        makeMySupervision({
          status,
          requiresPhotos: true,
          photosNotAllowed: true,
          myPhotosCount: 2,
          myVideosCount: 0,
        }),
      )

      const section = screen.getByTestId('media-section')
      expect(section).toHaveAttribute('data-shift', 'sh1')
      expect(section).toHaveAttribute('data-photos', '2')
      expect(section).toHaveAttribute('data-requires', 'true')
      expect(section).toHaveAttribute('data-not-allowed', 'true')
    },
  )

  it('con la supervisión cancelada no ofrece el bloque', () => {
    setup(makeMySupervision({ status: 'cancelled' }))

    expect(screen.queryByTestId('media-section')).not.toBeInTheDocument()
  })
})
