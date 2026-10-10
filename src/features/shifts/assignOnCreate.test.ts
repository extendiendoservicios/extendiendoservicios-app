import { describe, expect, it } from 'vitest'
import type { GenerateShiftsResult } from '@/api/shifts'
import {
  assignedWarningLines,
  clampSelection,
  fixedAssignmentsText,
  fixedEmployeesError,
  formatDayMonth,
  pastWithoutFixedText,
  rejectedLines,
  rejectedTitle,
  selectionLimitMessage,
  summarizeGeneration,
  toggleEmployee,
  unassignedRows,
} from './assignOnCreate'

describe('toggleEmployee (tope de selección)', () => {
  it('suma mientras no llegue al tope', () => {
    expect(toggleEmployee(['a'], 'b', 2)).toEqual({
      ok: true,
      next: ['a', 'b'],
    })
  })

  it('no deja pasar el tope y conserva la selección', () => {
    expect(toggleEmployee(['a', 'b'], 'c', 2)).toEqual({
      ok: false,
      next: ['a', 'b'],
      reason: 'limit',
    })
  })

  it('sacar siempre se puede, aun en el tope', () => {
    expect(toggleEmployee(['a', 'b'], 'a', 2)).toEqual({
      ok: true,
      next: ['b'],
    })
  })

  it('recorta lo elegido de más si baja la dotación', () => {
    expect(clampSelection(['a', 'b', 'c'], 2)).toEqual(['a', 'b'])
    expect(clampSelection(['a'], 2)).toEqual(['a'])
  })

  it('avisa el tope en singular y plural', () => {
    expect(selectionLimitMessage(1)).toBe(
      'La dotación es de 1 persona: no podés elegir más.',
    )
    expect(selectionLimitMessage(3)).toBe(
      'La dotación es de 3 personas: no podés elegir más.',
    )
  })
})

describe('fixedEmployeesError', () => {
  it('no marca error dentro de la dotación', () => {
    expect(fixedEmployeesError(2, 2)).toBeNull()
  })

  it('marca error si los fijos superan la dotación', () => {
    expect(fixedEmployeesError(3, 2)).toBe(
      'Los empleados fijos no pueden ser más que la dotación del servicio (2).',
    )
  })
})

describe('avisos al crear el turno', () => {
  it('arma una línea por rechazado con el message del servidor', () => {
    expect(
      rejectedLines([
        {
          employeeId: 'e1',
          employeeName: 'Beto Gómez',
          code: 'ASSIGNMENT_OVERLAP',
          message: 'Ya tiene otro turno en ese horario.',
        },
      ]),
    ).toEqual(['Beto Gómez: Ya tiene otro turno en ese horario.'])
  })

  it('titula en singular y plural', () => {
    expect(rejectedTitle(1)).toBe(
      'Creamos el turno, pero a una persona no se la pudo asignar:',
    )
    expect(rejectedTitle(2)).toBe(
      'Creamos el turno, pero a 2 personas no se las pudo asignar:',
    )
  })

  it('traduce las advertencias de los asignados con los textos de la asignación manual', () => {
    const lines = assignedWarningLines(
      [
        { employeeId: 'e1', assignmentId: 'a1', warnings: ['ON_LEAVE'] },
        { employeeId: 'e2', assignmentId: 'a2', warnings: [] },
      ],
      { e1: 'Ana Pérez', e2: 'Luis Díaz' },
      { ON_LEAVE: 'Tiene una licencia cargada.' },
    )
    expect(lines).toEqual([
      {
        employeeId: 'e1',
        employeeName: 'Ana Pérez',
        messages: ['Tiene una licencia cargada.'],
      },
    ])
  })
})

describe('resumen de la generación', () => {
  const result: GenerateShiftsResult = {
    created: 10,
    skipped: 2,
    holidaysSkipped: 1,
    assigned: 7,
    pastWithoutFixed: 3,
    unassigned: [
      {
        shiftId: 's2',
        shiftDate: '2026-10-14',
        serviceId: 'sv1',
        employeeId: 'e2',
        employeeName: 'Zoe Ruiz',
        code: 'ON_LEAVE',
        message: 'Tiene licencia.',
      },
      {
        shiftId: 's1',
        shiftDate: '2026-10-13',
        serviceId: 'sv1',
        employeeId: 'e1',
        employeeName: 'Ana Pérez',
        code: 'ASSIGNMENT_OVERLAP',
        message: 'Ya tiene otro turno en ese horario.',
      },
    ],
  }

  it('cuenta asignaciones de fijos y avisa de los días que ya empezaron', () => {
    const summary = summarizeGeneration(result)
    expect(summary.fixedAssignments).toBe('7 asignaciones de empleados fijos')
    expect(summary.pastWithoutFixed).toBe(
      '3 turnos de días que ya empezaron quedaron sin los empleados fijos.',
    )
    expect(summary.hasUnassigned).toBe(true)
  })

  it('no dice nada de días pasados si no hubo', () => {
    expect(pastWithoutFixedText(0)).toBeNull()
    expect(fixedAssignmentsText(1)).toBe('1 asignación de empleados fijos')
  })

  it('ordena los sin asignar por fecha y rotula con servicio y fecha dd/mm', () => {
    const rows = unassignedRows(result.unassigned, {
      sv1: 'Banco Norte · Sede Centro · Mañana',
    })
    expect(rows.map((row) => row.date)).toEqual(['13/10', '14/10'])
    expect(rows[0]).toMatchObject({
      serviceLabel: 'Banco Norte · Sede Centro · Mañana',
      employeeName: 'Ana Pérez',
      reason: 'Ya tiene otro turno en ese horario.',
    })
    expect(formatDayMonth('2026-01-05')).toBe('05/01')
  })
})
