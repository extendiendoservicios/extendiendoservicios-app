import { describe, expect, it } from 'vitest'
import type { AssignmentBoardRow } from '@/api/assignments'
import type { ShiftListRow } from '@/api/shifts'
import {
  buildWeekBlocks,
  decideScope,
  filterUncoveredShifts,
  hasScheduleChanged,
  minutesToTime,
  moveBlock,
  previewLabel,
  pxToMinutes,
  resizeBlock,
  shiftDate,
  snapMinutes,
  targetShiftCandidates,
  timeToMinutes,
  uncoveredShifts,
  undoForAssign,
  undoForMove,
  undoForShiftTime,
  visibleHourRange,
  wholeShiftChange,
} from '@/features/employees/cronogramaWeek'

function shift(over: Partial<ShiftListRow>): ShiftListRow {
  return {
    id: 's1',
    clientId: 'c1',
    clientName: 'Cliente',
    clientCalendarColor: 0,
    siteId: 'si1',
    siteName: 'Sede',
    siteCity: null,
    shiftDate: '2026-11-16',
    startTime: '08:00:00',
    endTime: '12:00:00',
    requiredStaff: 2,
    status: 'scheduled',
    displayStatus: 'scheduled',
    assignedCount: 1,
    presentCount: 0,
    finishedCount: 0,
    absentCount: 0,
    delayedCount: 0,
    openEnded: false,
    noCheckoutCount: 0,
    generated: false,
    notes: null,
    ...over,
  }
}

function assignment(over: Partial<AssignmentBoardRow>): AssignmentBoardRow {
  return {
    id: 'a1',
    shiftId: 's1',
    shiftDate: '2026-11-16',
    shiftStatus: 'assigned',
    employeeId: 'e1',
    employeeFirstName: 'Ana',
    employeeLastName: 'Prueba',
    siteId: 'si1',
    siteName: 'Sede',
    clientName: 'Cliente',
    clientId: 'c1',
    clientCalendarColor: 0,
    startTime: '08:00:00',
    endTime: '12:00:00',
    openEnded: false,
    status: 'expected',
    notes: null,
    ...over,
  }
}

describe('horarios y ajuste a 15 minutos', () => {
  it('convierte entre texto y minutos', () => {
    expect(timeToMinutes('08:30:00')).toBe(510)
    expect(minutesToTime(510)).toBe('08:30')
    expect(minutesToTime(1440)).toBe('24:00')
  })

  it('ajusta a múltiplos de 15', () => {
    expect(snapMinutes(488)).toBe(495)
    expect(snapMinutes(481)).toBe(480)
  })

  it('traduce píxeles a minutos', () => {
    expect(pxToMinutes(40, 40)).toBe(60)
    expect(pxToMinutes(10, 40)).toBe(15)
  })

  it('mueve el bloque conservando la duración y ajustando', () => {
    const moved = moveBlock({ startMin: 480, endMin: 720 }, 70, 2)
    expect(moved).toEqual({ dayOffset: 2, startMin: 555, endMin: 795 })
  })

  it('no deja salir el bloque del día', () => {
    expect(moveBlock({ startMin: 480, endMin: 720 }, -9999, 0).startMin).toBe(0)
    const late = moveBlock({ startMin: 480, endMin: 720 }, 9999, 0)
    expect(late.endMin).toBe(1440)
    expect(late.startMin).toBe(1200)
  })

  it('estira los bordes con mínimo de 15 minutos', () => {
    expect(resizeBlock({ startMin: 480, endMin: 720 }, 'end', 60)).toEqual({
      startMin: 480,
      endMin: 780,
    })
    expect(resizeBlock({ startMin: 480, endMin: 720 }, 'end', -9999)).toEqual({
      startMin: 480,
      endMin: 495,
    })
    expect(resizeBlock({ startMin: 480, endMin: 720 }, 'start', 9999)).toEqual({
      startMin: 705,
      endMin: 720,
    })
  })

  it('arma el texto del horario resultante', () => {
    expect(previewLabel({ startMin: 540, endMin: 780 })).toBe('09:00–13:00')
    expect(previewLabel({ startMin: 540, endMin: 600 }, true)).toBe('09:00')
  })
})

describe('turno entero o solo esta persona', () => {
  it('con una sola persona mueve el turno entero', () => {
    expect(decideScope(1)).toBe('whole')
    expect(decideScope(0)).toBe('whole')
  })

  it('con más personas pregunta', () => {
    expect(decideScope(2)).toBe('ask')
  })

  it('detecta si hubo cambio', () => {
    const block = { date: '2026-11-16', startMin: 480, endMin: 720 }
    expect(hasScheduleChanged(block, { ...block })).toBe(false)
    expect(hasScheduleChanged(block, { ...block, startMin: 495 })).toBe(true)
    expect(hasScheduleChanged(block, { ...block, date: '2026-11-17' })).toBe(
      true,
    )
  })

  it('calcula la fecha de destino', () => {
    expect(shiftDate('2026-11-16', 0)).toBe('2026-11-16')
    expect(shiftDate('2026-11-16', 3)).toBe('2026-11-19')
  })

  it('ofrece como destino los otros turnos de la sede ese día', () => {
    const shifts = [
      shift({ id: 's1' }),
      shift({ id: 's2', startTime: '14:00:00', endTime: '18:00:00' }),
      shift({ id: 's3', siteId: 'otra' }),
      shift({ id: 's4', status: 'cancelled' }),
      shift({ id: 's5', shiftDate: '2026-11-17' }),
    ]
    expect(
      targetShiftCandidates(shifts, 'si1', '2026-11-16', 's1').map((s) => s.id),
    ).toEqual(['s2'])
  })
})

describe('bloques y turnos sin cubrir', () => {
  it('arma los bloques con la dotación del turno y descarta cancelados', () => {
    const blocks = buildWeekBlocks(
      [
        assignment({ id: 'a1' }),
        assignment({ id: 'a2', shiftId: 's2', shiftStatus: 'cancelled' }),
        assignment({
          id: 'a3',
          shiftId: 's3',
          openEnded: true,
          endTime: '23:59:00',
        }),
      ],
      [shift({ id: 's1', assignedCount: 3 }), shift({ id: 's3' })],
    )
    expect(blocks.map((b) => b.assignmentId)).toEqual(['a1', 'a3'])
    expect(blocks[0]?.assignedCount).toBe(3)
    expect(blocks[1]?.endMin).toBe(540)
  })

  it('amplía el rango visible si hay turnos fuera de 06 a 22', () => {
    expect(visibleHourRange([{ startMin: 480, endMin: 720 }])).toEqual({
      startHour: 6,
      endHour: 22,
    })
    expect(visibleHourRange([{ startMin: 300, endMin: 1410 }])).toEqual({
      startHour: 5,
      endHour: 24,
    })
  })

  it('lista los turnos con dotación incompleta donde la persona no está', () => {
    const shifts = [
      shift({ id: 'completo', assignedCount: 2 }),
      shift({ id: 'falta', assignedCount: 0 }),
      shift({ id: 'ya-esta', assignedCount: 1 }),
      shift({ id: 'cancelado', assignedCount: 0, status: 'cancelled' }),
    ]
    expect(
      uncoveredShifts(shifts, new Set(['ya-esta'])).map((s) => s.id),
    ).toEqual(['falta'])
  })
})

describe('armado del deshacer', () => {
  const block = buildWeekBlocks(
    [assignment({ id: 'a1' })],
    [shift({ id: 's1' })],
  )[0]!

  it('cambio de turno entero: vuelve al horario y fecha anteriores', () => {
    expect(undoForShiftTime(block)).toEqual({
      kind: 'shift_time',
      shiftId: 's1',
      date: '2026-11-16',
      start: '08:00',
      end: '12:00',
      openEnded: false,
    })
  })

  it('pasar a otro turno: usa previous de la respuesta', () => {
    expect(
      undoForMove('nueva', {
        assignment_id: 'vieja',
        shift_id: 's1',
        start_time: '08:00:00',
        end_time: null,
      }),
    ).toEqual({
      kind: 'move',
      assignmentId: 'nueva',
      targetShiftId: 's1',
      start: '08:00',
      end: null,
    })
  })

  it('asignar: se deshace quitando', () => {
    expect(undoForAssign('x')).toEqual({ kind: 'unassign', assignmentId: 'x' })
  })
})

describe('turno entero con franja propia (DEF-P28-02)', () => {
  // Turno 08:00–12:00; la persona trabaja de 09:00 a 11:00.
  const propio = buildWeekBlocks(
    [assignment({ startTime: '09:00:00', endTime: '11:00:00' })],
    [shift({ id: 's1' })],
  )[0]!
  const sinPropio = buildWeekBlocks([assignment({})], [shift({ id: 's1' })])[0]!
  const dia = '2026-11-16'

  it('mover solo de día conserva el horario del turno y la franja propia', () => {
    const cambio = wholeShiftChange(propio, {
      startMin: propio.startMin,
      endMin: propio.endMin,
    })
    expect(cambio.startMin).toBe(8 * 60)
    expect(cambio.endMin).toBe(12 * 60)
    expect(cambio.ownTime).toEqual({ startMin: 9 * 60, endMin: 11 * 60 })
  })

  it('mover el bloque 1 hora corre el turno 1 hora y la franja propia acompaña', () => {
    const cambio = wholeShiftChange(propio, {
      startMin: 10 * 60,
      endMin: 12 * 60,
    })
    expect(cambio.startMin).toBe(9 * 60)
    expect(cambio.endMin).toBe(13 * 60)
    expect(cambio.ownTime).toEqual({ startMin: 10 * 60, endMin: 12 * 60 })
  })

  it('estirar el borde final suma el corrimiento al fin del turno', () => {
    const cambio = wholeShiftChange(propio, {
      startMin: 9 * 60,
      endMin: 11 * 60 + 30,
    })
    expect(cambio.startMin).toBe(8 * 60)
    expect(cambio.endMin).toBe(12 * 60 + 30)
    expect(cambio.ownTime).toEqual({ startMin: 9 * 60, endMin: 11 * 60 + 30 })
  })

  it('estirar el borde inicial suma el corrimiento al inicio del turno', () => {
    const cambio = wholeShiftChange(propio, {
      startMin: 8 * 60 + 30,
      endMin: 11 * 60,
    })
    expect(cambio.startMin).toBe(7 * 60 + 30)
    expect(cambio.endMin).toBe(12 * 60)
  })

  it('sin franja propia el bloque es el turno y no hay franja que acompañar', () => {
    const cambio = wholeShiftChange(sinPropio, {
      startMin: 9 * 60,
      endMin: 13 * 60,
    })
    expect(cambio).toEqual({ startMin: 9 * 60, endMin: 13 * 60, ownTime: null })
  })

  it('no se sale del día aunque el turno sea más largo que el bloque', () => {
    const cambio = wholeShiftChange(propio, {
      startMin: 22 * 60,
      endMin: 24 * 60,
    })
    // El turno termina a las 24:00 como mucho: corre 12 horas, no 13.
    expect(cambio.endMin).toBe(24 * 60)
    expect(cambio.startMin).toBe(20 * 60)
    expect(cambio.ownTime).toEqual({ startMin: 21 * 60, endMin: 23 * 60 })
  })

  it('un turno «A terminar» corre solo el inicio y no tiene franja propia', () => {
    const abierto = buildWeekBlocks(
      [
        assignment({
          startTime: '08:00:00',
          endTime: '23:59:00',
          openEnded: true,
        }),
      ],
      [shift({ id: 's1', endTime: '23:59:00', openEnded: true })],
    )[0]!
    const cambio = wholeShiftChange(abierto, {
      startMin: 9 * 60,
      endMin: 10 * 60,
    })
    expect(cambio.startMin).toBe(9 * 60)
    expect(cambio.ownTime).toBeNull()
  })

  it('el deshacer vuelve el turno y también la franja propia', () => {
    expect(undoForShiftTime(propio)).toEqual({
      kind: 'shift_time',
      shiftId: 's1',
      date: dia,
      start: '08:00',
      end: '12:00',
      openEnded: false,
      ownTime: { assignmentId: 'a1', start: '09:00', end: '11:00' },
    })
  })
})

describe('filtro del panel «Turnos sin cubrir»', () => {
  const shifts = [
    shift({
      id: 'a',
      siteName: 'Oficina Central',
      clientName: 'Acme',
      shiftDate: '2026-11-16',
    }),
    shift({
      id: 'b',
      siteName: 'Depósito',
      clientName: 'Ñandú SA',
      shiftDate: '2026-11-17',
    }),
    shift({
      id: 'c',
      siteName: 'Oficina Norte',
      clientName: 'Acme',
      shiftDate: '2026-11-17',
    }),
  ]

  it('sin filtro devuelve todo en el mismo orden', () => {
    expect(
      filterUncoveredShifts(shifts, { text: '', date: null }).map((s) => s.id),
    ).toEqual(['a', 'b', 'c'])
  })

  it('por texto busca en sede y cliente sin distinguir tildes ni mayúsculas', () => {
    expect(
      filterUncoveredShifts(shifts, { text: 'DEPOSITO', date: null }).map(
        (s) => s.id,
      ),
    ).toEqual(['b'])
    expect(
      filterUncoveredShifts(shifts, { text: 'nandu', date: null }).map(
        (s) => s.id,
      ),
    ).toEqual(['b'])
    expect(
      filterUncoveredShifts(shifts, { text: 'acme', date: null }).map(
        (s) => s.id,
      ),
    ).toEqual(['a', 'c'])
  })

  it('por día y texto se combinan', () => {
    expect(
      filterUncoveredShifts(shifts, {
        text: 'oficina',
        date: '2026-11-17',
      }).map((s) => s.id),
    ).toEqual(['c'])
  })
})
