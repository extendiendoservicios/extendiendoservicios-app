import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SupervisorShiftPage from './SupervisorShiftPage'
import * as mySupervisionsModule from '@/api/mySupervisions'
import * as workdaysModule from '@/api/myWorkdays'
import * as todayModule from '@/api/supervisorToday'
import { ApiError } from '@/api/errors'
import {
  makeTodayShift,
  makeWorkday,
  makeWorkdaySupervision,
} from '@/features/coordinator/fixtures'
import { mockCommonHooks, renderRoute } from '@/features/coordinator/testUtils'

vi.mock('@/features/settings/queries', () => ({
  useCompanySettingsQuery: () => ({
    data: { locationConsentText: 'Texto de consentimiento de la empresa' },
  }),
}))

/**
 * SUP-03 (P24.2): detalle del turno con «Supervisar». Se prueba que el botón
 * respete CJ-07 y CJ-08 con su motivo a la vista, que registre el inicio con
 * la hora del servidor y que funcione sin ubicación (CJ-21).
 */
const SHIFT = makeTodayShift({
  shiftId: 'sh1',
  displayState: 'in_progress',
  assignedEmployees: [
    {
      assignmentId: 'as1',
      employeeId: 'e1',
      firstName: 'Marta',
      lastName: 'Gómez',
      status: 'present',
      checkInAt: '2026-10-23T11:05:00Z',
      checkOutAt: null,
    },
  ],
  supervisors: [
    {
      supervisionId: 's9',
      supervisorId: 'u2',
      firstName: 'Ana',
      lastName: 'Ruiz',
      status: 'in_progress',
      checkInAt: '2026-10-23T11:30:00Z',
      checkOutAt: null,
      isMe: false,
    },
  ],
})

function setup({
  shift = SHIFT,
  workday = makeWorkday(),
  mutateAsync = vi.fn().mockResolvedValue({
    supervisionId: 'sv9',
    checkIn: {
      id: 'sa1',
      supervisionId: 'sv9',
      kind: 'check_in',
      recordedAt: '2026-10-23T12:07:00Z',
      geo: {
        status: 'unvalidated',
        reason: 'no_position',
        distanceM: null,
        radiusM: null,
        overridden: false,
      },
    },
    warnings: [],
  }),
  consent = 'declined',
}: {
  shift?: ReturnType<typeof makeTodayShift> | null
  workday?: ReturnType<typeof makeWorkday> | null | undefined
  mutateAsync?: ReturnType<typeof vi.fn>
  consent?: 'granted' | 'needs-consent' | 'declined'
} = {}) {
  mockCommonHooks({ consent })
  vi.spyOn(todayModule, 'useSupervisorTodayQuery').mockReturnValue({
    data: shift ? [shift] : [],
    isLoading: false,
    isError: false,
  } as never)
  vi.spyOn(workdaysModule, 'useTodayWorkdayQuery').mockReturnValue({
    data: workday,
    isLoading: false,
    isError: false,
    dataUpdatedAt: Date.now(),
  } as never)
  vi.spyOn(mySupervisionsModule, 'useTakeSupervisionMutation').mockReturnValue({
    mutateAsync,
    isPending: false,
  } as never)
  renderRoute(<SupervisorShiftPage />, {
    path: '/sup/turnos/:shiftId',
    entry: '/sup/turnos/sh1',
  })
  return mutateAsync
}

afterEach(() => vi.restoreAllMocks())

describe('SupervisorShiftPage (SUP-03)', () => {
  it('muestra el turno, los empleados y quién más lo supervisa', () => {
    setup()

    expect(screen.getByText('Limpiadora SRL')).toBeInTheDocument()
    expect(screen.getAllByText('Marta Gómez').length).toBeGreaterThan(0)
    expect(screen.getByText('Quién más lo supervisa')).toBeInTheDocument()
    expect(screen.getByText('Supervisando: Ana Ruiz')).toBeInTheDocument()
  })

  it('«Supervisar» registra el inicio sin ubicación y muestra la hora que devolvió el servidor', async () => {
    const mutateAsync = setup()

    fireEvent.click(screen.getByRole('button', { name: 'Supervisar' }))

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        shiftId: 'sh1',
        coords: null,
        outsideReason: null,
      }),
    )
    expect(await screen.findByText('Supervisión iniciada')).toBeInTheDocument()
    // 12:07 UTC = 09:07 en Buenos Aires.
    expect(screen.getByText('09:07')).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: 'Seguir con la supervisión' }),
    )
    expect(await screen.findByText('otra pantalla')).toBeInTheDocument()
  })

  it('sin jornada iniciada deshabilita «Supervisar» y dice por qué (CJ-07)', () => {
    setup({ workday: null })

    expect(screen.getByRole('button', { name: 'Supervisar' })).toBeDisabled()
    expect(
      screen.getByText('Iniciá tu jornada para poder supervisar.'),
    ).toBeInTheDocument()
  })

  it('en pausa lo deshabilita y pide reanudar (CJ-07)', () => {
    setup({ workday: makeWorkday({ state: 'paused' }) })

    expect(screen.getByRole('button', { name: 'Supervisar' })).toBeDisabled()
    expect(screen.getByText(/reanudá tu jornada/)).toBeInTheDocument()
  })

  it('con otra supervisión abierta lo deshabilita (CJ-08)', () => {
    setup({
      workday: makeWorkday({
        supervisions: [makeWorkdaySupervision({ shiftId: 'otro' })],
      }),
    })

    expect(screen.getByRole('button', { name: 'Supervisar' })).toBeDisabled()
    expect(
      screen.getByText(/Cerrá o descartá tu supervisión abierta/),
    ).toBeInTheDocument()
  })

  it('si ya está supervisando este turno ofrece ir a su supervisión', () => {
    setup({
      shift: makeTodayShift({
        shiftId: 'sh1',
        mySupervisionId: 'sv1',
        mySupervisionStatus: 'in_progress',
      }),
      workday: makeWorkday({ supervisions: [makeWorkdaySupervision()] }),
    })

    expect(screen.getByRole('button', { name: 'Supervisar' })).toBeDisabled()
    expect(
      screen.getByRole('link', { name: 'Ir a mi supervisión' }),
    ).toHaveAttribute('href', '/sup/supervisiones/sv1')
  })

  it('traduce el error de la base (por ejemplo, el turno ya fue supervisado por vos)', async () => {
    setup({
      mutateAsync: vi
        .fn()
        .mockRejectedValue(new ApiError('crudo', 'ALREADY_SUPERVISED')),
    })

    fireEvent.click(screen.getByRole('button', { name: 'Supervisar' }))

    expect(
      await screen.findByText('Ya supervisaste este turno.'),
    ).toBeInTheDocument()
  })

  it('si falta el consentimiento, lo muestra antes y no registra todavía', async () => {
    const mutateAsync = setup({ consent: 'needs-consent' })

    fireEvent.click(screen.getByRole('button', { name: 'Supervisar' }))

    expect(
      await screen.findByText('Texto de consentimiento de la empresa'),
    ).toBeInTheDocument()
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('un turno que no está entre los de hoy muestra un aviso', () => {
    setup({ shift: null })
    expect(
      screen.getByText(/No encontramos ese turno entre los de hoy/),
    ).toBeInTheDocument()
  })
})
