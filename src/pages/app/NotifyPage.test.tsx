import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import NotifyPage from './NotifyPage'
import * as queriesModule from '@/features/employee/queries'
import * as onlineModule from '@/features/employee/useOnlineStatus'
import { ApiError } from '@/api/errors'
import type { MyDayAssignment } from '@/api/myDay'

/**
 * EMP-12 (MOB-EMP-020, ABS-004): selector de servicio (solo si hace falta),
 * tipo de aviso, detalle y confirmación. Mismo patrón de mocks que
 * `TasksPage.test.tsx`: se reemplazan los hooks de
 * `src/features/employee/queries.ts` en vez de montar un
 * `QueryClientProvider` de verdad.
 */
function assignment(overrides: Partial<MyDayAssignment>): MyDayAssignment {
  return {
    assignmentId: 'a1',
    shiftId: 'sh1',
    shiftDate: '2026-09-26',
    isToday: true,
    clientId: 'c1',
    clientName: 'Limpia Ya',
    siteId: 'si1',
    siteName: 'Sede Centro',
    siteAddress: null,
    siteContactName: null,
    siteContactPhone: null,
    accessInstructions: null,
    buildingHours: null,
    phoneRestricted: false,
    photosNotAllowed: false,
    restrictionsNotes: null,
    startTime: '08:00:00',
    endTime: '12:00:00',
    startsAt: null,
    endsAt: null,
    status: 'expected',
    shiftStatus: 'scheduled',
    notes: null,
    tasksTotal: 0,
    tasksDone: 0,
    changedSinceLastSeen: false,
    checkInAt: null,
    checkOutAt: null,
    siteCity: null,
    siteLatitude: null,
    siteLongitude: null,
    checkInSource: null,
    checkInRecordedBy: null,
    checkOutSource: null,
    checkOutRecordedBy: null,
    lastNoticeKind: null,
    lastNoticeMinutesLate: null,
    lastNoticeReasonCode: null,
    lastNoticeReasonText: null,
    lastNoticeReportedBy: null,
    lastNoticeSource: null,
    lastNoticeAt: null,
    lastNoticeEstimatedArrivalAt: null,
    ...overrides,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

function renderNotifyPage(initialEntry = '/app/avisar') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/app/avisar" element={<NotifyPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

function mockQueries({
  data,
  notifyDelay = vi.fn().mockResolvedValue(undefined),
  notifyAbsence = vi.fn().mockResolvedValue(undefined),
  online = true,
}: {
  data: MyDayAssignment[]
  notifyDelay?: ReturnType<typeof vi.fn>
  notifyAbsence?: ReturnType<typeof vi.fn>
  online?: boolean
}) {
  vi.spyOn(onlineModule, 'useOnlineStatus').mockReturnValue(online)
  vi.spyOn(queriesModule, 'useMyDayQuery').mockReturnValue({
    data,
    isLoading: false,
  } as never)
  vi.spyOn(queriesModule, 'useNotifyDelayMutation').mockReturnValue({
    mutateAsync: notifyDelay,
    isPending: false,
  } as never)
  vi.spyOn(queriesModule, 'useNotifyAbsenceMutation').mockReturnValue({
    mutateAsync: notifyAbsence,
    isPending: false,
  } as never)
  return { notifyDelay, notifyAbsence }
}

describe('NotifyPage (EMP-12)', () => {
  it('sin servicios para avisar, muestra el estado vacío', () => {
    mockQueries({ data: [assignment({ status: 'present', checkInAt: 'x' })] })

    renderNotifyPage()

    expect(
      screen.getByText('No tenés servicios para avisar'),
    ).toBeInTheDocument()
  })

  it('avisa una demora: elige servicio, tipo, minutos por defecto y confirma', async () => {
    const { notifyDelay } = mockQueries({
      data: [assignment({ assignmentId: 'a1', status: 'expected' })],
    })

    renderNotifyPage()

    // Paso 1: servicio (uno solo, pero igual hay que elegirlo).
    fireEvent.click(
      screen.getByRole('radio', { name: /Limpia Ya · Sede Centro/ }),
    )
    fireEvent.click(screen.getByText('Continuar'))

    // Paso 2: tipo (demora por defecto).
    expect(
      screen.getByRole('radiogroup', { name: 'Tipo de aviso' }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByText('Continuar'))

    // Paso 3: minutos (15 por defecto) — confirma sin tocar el stepper.
    fireEvent.click(screen.getByText('Continuar'))

    // Paso 4: confirmación.
    expect(
      screen.getByText('Vas a avisar una demora de 15 min.'),
    ).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByText('Confirmar aviso'))
      await Promise.resolve()
    })

    expect(notifyDelay).toHaveBeenCalledWith({
      assignmentId: 'a1',
      minutes: 15,
      reasonText: undefined,
    })
    expect(
      await screen.findByText('Avisaste una demora de 15 min.'),
    ).toBeInTheDocument()
  })

  it('con la asignación preseleccionada y ya con una demora avisada, solo ofrece ausencia', async () => {
    const { notifyAbsence } = mockQueries({
      data: [
        assignment({
          assignmentId: 'a1',
          status: 'delay_notified',
          lastNoticeKind: 'delay',
          lastNoticeMinutesLate: 10,
        }),
      ],
    })

    renderNotifyPage('/app/avisar?asignacion=a1')

    // Se saltea el selector de servicio Y el de tipo (una sola opción
    // disponible, `availableNoticeKinds` devuelve solo `absence`): entra
    // directo al paso de motivo.
    fireEvent.click(await screen.findByRole('radio', { name: 'Enfermedad' }))
    fireEvent.click(screen.getByText('Continuar'))

    expect(
      screen.getByText('Vas a avisar que no vas: enfermedad.'),
    ).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByText('Confirmar aviso'))
      await Promise.resolve()
    })

    expect(notifyAbsence).toHaveBeenCalledWith({
      assignmentId: 'a1',
      reasonCode: 'illness',
      reasonText: undefined,
    })
  })

  it('exige texto cuando el motivo de ausencia es "otro"', async () => {
    mockQueries({
      data: [assignment({ assignmentId: 'a1', status: 'expected' })],
    })

    renderNotifyPage('/app/avisar?asignacion=a1')

    fireEvent.click(await screen.findByRole('radio', { name: 'Ausencia' }))
    fireEvent.click(screen.getByText('Continuar'))
    fireEvent.click(screen.getByRole('radio', { name: 'Otro' }))
    fireEvent.click(screen.getByText('Continuar'))

    expect(screen.getByText('Contanos el motivo.')).toBeInTheDocument()
  })

  it('muestra el error del servidor si el aviso llega tarde', async () => {
    const notifyDelay = vi
      .fn()
      .mockRejectedValue(
        new ApiError(
          'El aviso tiene que hacerse antes de la hora de inicio.',
          'TOO_LATE_TO_NOTIFY',
        ),
      )
    mockQueries({
      data: [assignment({ assignmentId: 'a1', status: 'expected' })],
      notifyDelay,
    })

    renderNotifyPage('/app/avisar?asignacion=a1')

    await screen.findByRole('radiogroup', { name: 'Tipo de aviso' })
    fireEvent.click(screen.getByText('Continuar'))
    fireEvent.click(screen.getByText('Continuar'))
    await act(async () => {
      fireEvent.click(screen.getByText('Confirmar aviso'))
      await Promise.resolve()
    })

    expect(
      await screen.findByText(
        'El aviso tiene que hacerse antes de la hora de inicio.',
      ),
    ).toBeInTheDocument()
  })
})
