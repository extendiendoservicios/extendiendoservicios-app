import { describe, expect, it } from 'vitest'
import {
  defaultWeekdayForDate,
  maxSeriesDate,
  shiftFormSchema,
  shiftFormValuesToSeriesRule,
} from './schemas'
import {
  describeSeriesPreview,
  formatSeriesDates,
  seriesIssuesByDate,
  seriesSuccessMessage,
} from './series'

/** AJ3-08: «Repetir este turno», lógica sin React ni red. */

const BASE = {
  clientId: 'c1',
  siteId: 's1',
  date: '2026-10-13',
  startTime: '08:00',
  endTime: '12:00',
  requiredStaff: '1',
  repeat: true,
  weekdays: ['2'],
  weeksMode: 'all' as const,
  weeksOfMonth: [] as string[],
  repeatTo: '2026-11-17',
  worksOnHolidays: false,
}

function issuePaths(values: Record<string, unknown>): string[] {
  const result = shiftFormSchema.safeParse({ ...BASE, ...values })
  return result.success ? [] : result.error.issues.map((i) => String(i.path[0]))
}

describe('esquema con repetición', () => {
  it('acepta una repetición válida', () => {
    expect(issuePaths({})).toEqual([])
  })

  it('sin repetir ignora los campos de la repetición', () => {
    expect(issuePaths({ repeat: false, repeatTo: '', weekdays: [] })).toEqual(
      [],
    )
  })

  it('exige la fecha «hasta»', () => {
    expect(issuePaths({ repeatTo: '' })).toEqual(['repeatTo'])
  })

  it('rechaza un «hasta» anterior al «desde»', () => {
    expect(issuePaths({ repeatTo: '2026-10-01' })).toEqual(['repeatTo'])
  })

  it('acepta justo 3 meses y rechaza un día más', () => {
    expect(issuePaths({ repeatTo: '2027-01-13' })).toEqual([])
    expect(issuePaths({ repeatTo: '2027-01-14' })).toEqual(['repeatTo'])
  })

  it('exige al menos un día de la semana', () => {
    expect(issuePaths({ weekdays: [] })).toEqual(['weekdays'])
  })

  it('exige alguna semana del mes si se eligen algunas', () => {
    expect(issuePaths({ weeksMode: 'some', weeksOfMonth: [] })).toEqual([
      'weeksOfMonth',
    ])
    expect(issuePaths({ weeksMode: 'some', weeksOfMonth: ['1', '5'] })).toEqual(
      [],
    )
  })
})

describe('fechas de la repetición', () => {
  it('el tope es la fecha + 3 meses, ajustado a fin de mes como el servidor', () => {
    expect(maxSeriesDate('2026-10-13')).toBe('2027-01-13')
    expect(maxSeriesDate('2026-01-31')).toBe('2026-04-30')
  })

  it('el día por defecto es el de la fecha elegida', () => {
    expect(defaultWeekdayForDate('2026-10-13')).toEqual(['2']) // martes
    expect(defaultWeekdayForDate('2026-10-18')).toEqual(['0']) // domingo
    expect(defaultWeekdayForDate('')).toEqual([])
  })
})

describe('shiftFormValuesToSeriesRule', () => {
  it('arma la regla con días ordenados y todas las semanas = null', () => {
    expect(
      shiftFormValuesToSeriesRule({ ...BASE, weekdays: ['3', '1'] }),
    ).toEqual({
      from: '2026-10-13',
      to: '2026-11-17',
      weekdays: [1, 3],
      weeksOfMonth: null,
      worksOnHolidays: false,
    })
  })

  it('pasa las semanas elegidas', () => {
    expect(
      shiftFormValuesToSeriesRule({
        ...BASE,
        weeksMode: 'some',
        weeksOfMonth: ['5', '1'],
      })?.weeksOfMonth,
    ).toEqual([1, 5])
  })

  it('devuelve null si no se repite o la regla es inválida (no consulta)', () => {
    expect(shiftFormValuesToSeriesRule({ ...BASE, repeat: false })).toBeNull()
    expect(shiftFormValuesToSeriesRule({ ...BASE, repeatTo: '' })).toBeNull()
    expect(
      shiftFormValuesToSeriesRule({ ...BASE, repeatTo: '2027-02-01' }),
    ).toBeNull()
    expect(shiftFormValuesToSeriesRule({ ...BASE, weekdays: [] })).toBeNull()
    expect(
      shiftFormValuesToSeriesRule({
        ...BASE,
        weeksMode: 'some',
        weeksOfMonth: [],
      }),
    ).toBeNull()
  })
})

describe('aviso en vivo', () => {
  const dates = [
    '2026-10-13',
    '2026-10-20',
    '2026-10-27',
    '2026-11-03',
    '2026-11-10',
    '2026-11-17',
    '2026-11-24',
    '2026-12-01',
    '2026-12-08',
    '2026-12-15',
  ]

  it('con N fechas dice cuántos turnos y lista hasta 8', () => {
    const text = describeSeriesPreview({
      dates,
      holidaysSkipped: [],
      count: 10,
    })
    expect(text.kind).toBe('some')
    expect(text.headline).toBe('Se van a crear 10 turnos.')
    expect(text.datesLine).toBe(
      'mar 13 oct, mar 20 oct, mar 27 oct, mar 3 nov, mar 10 nov, mar 17 nov, mar 24 nov, mar 1 dic… y 2 más',
    )
    expect(text.holidaysLine).toBeNull()
  })

  it('con 1 fecha usa el singular', () => {
    expect(
      describeSeriesPreview({
        dates: ['2026-10-13'],
        holidaysSkipped: [],
        count: 1,
      }).headline,
    ).toBe('Se va a crear 1 turno.')
  })

  it('con feriados saltados los informa', () => {
    const text = describeSeriesPreview({
      dates: ['2026-10-13'],
      holidaysSkipped: ['2026-10-20', '2026-10-27'],
      count: 1,
    })
    expect(text.holidaysLine).toBe(
      'Se saltean 2 feriados: mar 20 oct, mar 27 oct.',
    )
  })

  it('con 0 fechas avisa que ninguna cumple la regla', () => {
    const text = describeSeriesPreview({
      dates: [],
      holidaysSkipped: [],
      count: 0,
    })
    expect(text.kind).toBe('none')
    expect(text.headline).toBe('Ninguna fecha cumple la regla elegida.')
  })

  it('formatSeriesDates no agrega «y N más» si entran todas', () => {
    expect(formatSeriesDates(dates.slice(0, 2))).toBe('mar 13 oct, mar 20 oct')
  })
})

describe('resultado de la creación', () => {
  it('el mensaje de éxito cuenta los turnos y los feriados salteados', () => {
    expect(seriesSuccessMessage(5, 0)).toBe('Se crearon 5 turnos.')
    expect(seriesSuccessMessage(1, 0)).toBe('Se creó 1 turno.')
    expect(seriesSuccessMessage(4, 1)).toBe(
      'Se crearon 4 turnos. Se salteó 1 feriado.',
    )
  })

  it('el resumen por fecha incluye solo las fechas con rechazados o advertencias', () => {
    const issues = seriesIssuesByDate(
      [
        {
          shiftId: 'a',
          shiftDate: '2026-10-13',
          warnings: [],
          assigned: [],
          rejected: [],
        },
        {
          shiftId: 'b',
          shiftDate: '2026-10-20',
          warnings: [],
          assigned: [
            { employeeId: 'e1', assignmentId: 'x', warnings: ['ON_LEAVE'] },
          ],
          rejected: [
            {
              employeeId: 'e2',
              employeeName: 'Ana Gómez',
              code: 'ASSIGNMENT_OVERLAP',
              message: 'Ya tiene otro turno en ese horario.',
            },
          ],
        },
      ],
      { e1: 'Luis Pérez' },
      { ON_LEAVE: 'Está de licencia.' },
    )
    expect(issues).toEqual([
      {
        date: '2026-10-20',
        lines: [
          'Ana Gómez: Ya tiene otro turno en ese horario.',
          'Luis Pérez: Está de licencia.',
        ],
      },
    ])
  })
})
