import { describe, expect, it } from 'vitest'
import {
  buildClientBlock,
  type ClientCalendarBlock,
} from '@/features/clients/clientCalendar'
import type { ShiftListRow } from '@/api/shifts'
import { COMPLETED_DATE_MESSAGE } from '@/features/employees/cronogramaWeek'
import {
  canDragBlock,
  planMoveToDate,
  ownTimeShifts,
  planTimeEdit,
  toWeekBlock,
  validFilter,
} from './clientCalendarEdit'

const CLIENT = { id: 'c1', name: 'Limpieza SA' }

function shift(overrides: Partial<ShiftListRow> = {}): ShiftListRow {
  return {
    id: 's1',
    clientId: 'c1',
    clientName: 'Limpieza SA',
    clientCalendarColor: 2,
    siteId: 'site1',
    siteName: 'Sede Norte',
    siteCity: null,
    shiftDate: '2026-11-10',
    startTime: '08:00:00',
    endTime: '12:00:00',
    requiredStaff: 2,
    status: 'scheduled',
    displayStatus: 'scheduled',
    openEnded: false,
    assignedCount: 0,
    presentCount: 0,
    finishedCount: 0,
    absentCount: 0,
    delayedCount: 0,
    noCheckoutCount: 0,
    generated: false,
    notes: null,
    ...overrides,
  }
}

function block(overrides: Partial<ShiftListRow> = {}): ClientCalendarBlock {
  return buildClientBlock(shift(overrides), [
    {
      assignmentId: 'a1',
      employeeId: 'e1',
      fullName: 'Ana Pérez',
      startTime: '08:00',
      endTime: '12:00',
    },
    {
      assignmentId: 'a2',
      employeeId: 'e2',
      fullName: 'Luis Gómez',
      startTime: '08:00',
      endTime: '12:00',
    },
  ])
}

describe('planTimeEdit (D-08)', () => {
  it('cambia el turno entero con shift_time, sin preguntar alcance ni franja propia', () => {
    const plan = planTimeEdit(block(), CLIENT, 'end', '13:00')
    expect(plan).toMatchObject({
      kind: 'apply',
      command: {
        kind: 'shift_time',
        shiftId: 's1',
        date: '2026-11-10',
        start: '08:00',
        end: '13:00',
        openEnded: false,
      },
    })
    expect(plan.kind === 'apply' && 'ownTime' in plan.command).toBe(false)
  })

  it('una hora igual a la actual no hace nada', () => {
    expect(planTimeEdit(block(), CLIENT, 'start', '08:00')).toEqual({
      kind: 'noop',
    })
  })

  it('rechaza un inicio posterior al fin con el mensaje de las reglas del empleado', () => {
    expect(planTimeEdit(block(), CLIENT, 'start', '13:00')).toEqual({
      kind: 'blocked',
      message: 'La hora de inicio tiene que ser anterior a la de fin.',
    })
  })

  it('un turno finalizado admite cambiar las horas', () => {
    const plan = planTimeEdit(
      block({ status: 'completed' }),
      CLIENT,
      'end',
      '13:00',
    )
    expect(plan.kind).toBe('apply')
  })

  it('un turno «a terminar» cambia solo el inicio y queda a terminar', () => {
    const plan = planTimeEdit(
      block({ openEnded: true, endTime: '23:59:00' }),
      CLIENT,
      'start',
      '09:00',
    )
    expect(plan).toMatchObject({
      kind: 'apply',
      command: { start: '09:00', openEnded: true },
    })
  })
})

describe('planMoveToDate (D-09)', () => {
  it('mueve el turno entero a otro día con el mismo horario', () => {
    expect(planMoveToDate(block(), CLIENT, '2026-11-12')).toMatchObject({
      kind: 'apply',
      command: {
        kind: 'shift_time',
        shiftId: 's1',
        date: '2026-11-12',
        start: '08:00',
        end: '12:00',
      },
    })
  })

  it('soltar en el mismo día no hace nada', () => {
    expect(planMoveToDate(block(), CLIENT, '2026-11-10')).toEqual({
      kind: 'noop',
    })
  })

  it('un turno finalizado no cambia de día', () => {
    expect(
      planMoveToDate(block({ status: 'completed' }), CLIENT, '2026-11-12'),
    ).toEqual({ kind: 'blocked', message: COMPLETED_DATE_MESSAGE })
  })
})

describe('canDragBlock', () => {
  it('finalizados y cancelados no se arrastran', () => {
    expect(canDragBlock(block())).toBe(true)
    expect(canDragBlock(block({ status: 'in_progress' }))).toBe(true)
    expect(canDragBlock(block({ status: 'completed' }))).toBe(false)
    expect(canDragBlock(block({ status: 'cancelled' }))).toBe(false)
  })
})

describe('toWeekBlock', () => {
  it('el horario del bloque es el del turno (sin franja propia)', () => {
    const week = toWeekBlock(block(), CLIENT)
    expect(week.startMin).toBe(week.shiftStartMin)
    expect(week.endMin).toBe(week.shiftEndMin)
    expect(week.assignedCount).toBe(2)
    expect(week.clientId).toBe('c1')
  })
})

describe('validFilter', () => {
  it('ignora un id que no está en la lista cargada', () => {
    expect(validFilter('x', ['a', 'b'])).toBeUndefined()
    expect(validFilter('a', ['a', 'b'])).toBe('a')
  })

  it('mientras la lista no cargó respeta el valor; vacío es sin filtro', () => {
    expect(validFilter('x', undefined)).toBe('x')
    expect(validFilter('', ['a'])).toBeUndefined()
    expect(validFilter(undefined, ['a'])).toBeUndefined()
  })
})

describe('franjas propias acompañan al turno (D-16)', () => {
  /** Ana con franja propia 09:00-11:00 dentro del turno 08:00-12:00; Luis sin franja propia. */
  function withOwn(): ClientCalendarBlock {
    const base = block()
    return {
      ...base,
      people: [
        { ...base.people[0]!, startTime: '09:00', endTime: '11:00' },
        base.people[1]!,
      ],
    }
  }

  it('al correr el inicio, la franja propia se corre lo mismo y el resto no cambia', () => {
    const plan = planTimeEdit(withOwn(), CLIENT, 'start', '07:00')
    expect(plan).toMatchObject({
      kind: 'apply',
      command: {
        start: '07:00',
        end: '12:00',
        ownTimes: [{ assignmentId: 'a1', start: '08:00', end: '11:00' }],
        undoOwnTimes: [{ assignmentId: 'a1', start: '09:00', end: '11:00' }],
      },
    })
  })

  it('al recortar el fin, la franja propia se recorta lo mismo', () => {
    const plan = planTimeEdit(withOwn(), CLIENT, 'end', '11:00')
    expect(plan).toMatchObject({
      kind: 'apply',
      command: {
        end: '11:00',
        ownTimes: [{ assignmentId: 'a1', start: '09:00', end: '10:00' }],
      },
    })
  })

  it('el recorte no deja la franja en menos de 15 minutos', () => {
    const { ownTimes } = ownTimeShifts(withOwn(), {
      startMin: 8 * 60,
      endMin: 8 * 60 + 15,
    })
    expect(ownTimes).toEqual([
      { assignmentId: 'a1', start: '09:00', end: '09:15' },
    ])
  })

  it('al cambiar de día el horario del turno no cambia y no hay franjas que mover', () => {
    const plan = planMoveToDate(withOwn(), CLIENT, '2026-11-12')
    expect(plan.kind === 'apply' && 'ownTimes' in plan.command).toBe(false)
  })

  it('sin franjas propias el comando no trae ownTimes', () => {
    const plan = planTimeEdit(block(), CLIENT, 'start', '07:00')
    expect(plan.kind === 'apply' && 'ownTimes' in plan.command).toBe(false)
  })

  it('un turno «a terminar» no mueve franjas', () => {
    const open = withOwn()
    const plan = planTimeEdit(
      { ...open, openEnded: true, end: '—' },
      CLIENT,
      'start',
      '07:00',
    )
    expect(plan.kind === 'apply' && 'ownTimes' in plan.command).toBe(false)
  })
})
